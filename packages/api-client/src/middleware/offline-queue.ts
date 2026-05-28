/**
 * Offline-queue middleware (ADR-0044) — failure mode (A): wifi drops
 * mid-transaction. For a German precious-metals / antiques retailer a lost
 * mutation is not just bad UX, it is a GoBD §146 breach: a sale, Ankauf, or
 * Storno the cashier believes was tendered MUST be persistable regardless of
 * network state at the moment of tender.
 *
 * Position in the production chain (ADR-0044 §3), directly after step-up and
 * above retry:
 *
 *   step-up → [offline-queue] → retry → telemetry → circuit → dedup → terminal
 *
 * Why above retry: it must catch BOTH `ApiNetworkError` AND
 * `ApiCircuitOpenError` before retry burns its budget on infrastructure that
 * is unreachable. To the cashier who pressed "Ankauf bestätigen", a circuit
 * being open is indistinguishable from the network being down — both must
 * enqueue. Why below step-up: a `STEP_UP_REQUIRED` while online means the
 * operator must re-PIN now; queueing it would defer the modal to next
 * connectivity, which is meaningless.
 *
 * Pure module — no Tauri, no SQLite, no React. The durable store is injected
 * (`OutboxStore`), exactly like the sink for telemetry and `requestStepUp`
 * for step-up. The Tauri-SQLite implementation lives in the app layer.
 *
 * SCOPE (ADR-0044 action items 1–3): this middleware ENQUEUES. The replay
 * loop, conflict resolution, and the Compliance Inbox (ADR-0045) are separate
 * action items and intentionally not implemented here.
 */

import { ApiCircuitOpenError, ApiNetworkError, ApiOfflineQueuedError } from '../errors.js';
import { uuidv7 } from '../internal/uuidv7.js';
import type { HttpMethod, Middleware, MiddlewareResponse } from '../middleware.js';

/**
 * Lifecycle of an outbox row. The terminal resolution states
 * (`succeeded` / `failed_terminal` / `conflict` / `deferred`) are written by
 * the replay loop + Compliance Inbox; this middleware only ever creates rows
 * in `pending`.
 */
export type OutboxStatus =
  | 'pending'
  | 'in_flight'
  | 'succeeded'
  | 'failed_terminal'
  | 'conflict'
  | 'deferred';

/**
 * A mutation captured for durable replay. Headers and body are SEALED at
 * enqueue time — the replay loop sends these exact bytes; the server
 * validates them at original-intent time via the `Idempotency-Key` cache
 * (ADR-0044 §5). Mirrors the `outbox_mutations` table columns.
 */
export interface OutboxRecord {
  /** Stable across every replay attempt — server-side dedup depends on it. */
  readonly idempotencyKey: string;
  /** Client trace id if telemetry already stamped one; else null. */
  readonly traceId: string | null;
  readonly method: HttpMethod;
  readonly path: string;
  readonly url: string;
  /** Sealed at enqueue. Do NOT recompose from current state on replay. */
  readonly headers: Record<string, string>;
  /** Not yet stringified — the store serializes (and may compress) it. */
  readonly body: unknown;
  /** ms epoch, device clock, captured at enqueue. */
  readonly enqueuedAt: number;
  /** Drives retention: 10y when true (GoBD §147), 30d otherwise. */
  readonly gobdRelevant: boolean;
  /** Forensic provenance: true ⇒ a fiscal call site supplied the key. */
  readonly callerSuppliedKey: boolean;
  readonly deviceId: string;
}

/**
 * The durable outbox. `enqueue` and `markSucceeded` are the write path used
 * by the middleware + replay loop; `listPending` is the read path the replay
 * loop drains in FIFO order. Implementations MUST treat `idempotencyKey` as
 * unique (insert-or-ignore) so a crash-recovery resubmit can't double-row.
 */
export interface OutboxStore {
  enqueue(record: OutboxRecord): Promise<void>;
  markSucceeded(idempotencyKey: string, response: unknown): Promise<void>;
  /**
   * Mark a row as halted on an unresolved divergence. Conflict rows are NEVER
   * auto-pruned (ADR-0044 §7) — they await human resolution in the Compliance
   * Inbox (ADR-0045).
   */
  markConflict(idempotencyKey: string, error: unknown): Promise<void>;
  /** Pending rows in FIFO (enqueue) order — drained by the replay loop. */
  listPending(): Promise<readonly OutboxRecord[]>;
}

/**
 * Fiscal route prefixes (ADR-0044 §5). A mutation on any of these carries
 * GoBD §147 weight → 10-year outbox retention. Exported so the app-layer
 * middleware wiring and any server-side mirror share ONE source of truth and
 * cannot drift (ADR-0044 action item 7).
 */
export const FISCAL_PATH_PREFIXES: readonly string[] = [
  '/ankauf',
  '/sales',
  '/storno',
  '/cash-movements',
  '/shifts/close',
  '/transactions/finalize',
];

/** True when `path` is a fiscal route (exact match or a sub-path). */
export function isGobdRelevantPath(path: string): boolean {
  return FISCAL_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export interface OfflineQueueDependencies {
  /** Durable outbox (Tauri-SQLite in production). */
  store: OutboxStore;
  /** Current connectivity. Production: `() => navigator.onLine`. */
  isOnline: () => boolean;
  /** Stable per-till identifier, embedded in every outbox row. */
  deviceId: string;
  /**
   * Idempotency-key generator for NON-fiscal mutations. Defaults to UUID v7.
   * Fiscal call sites supply their own key via `meta.custom.idempotencyKey`
   * (see ownership model below) and never hit this.
   */
  generateKey?: () => string;
  /**
   * Classifies a request as fiscally relevant (10y retention, GoBD §147).
   * A caller may also force it via `meta.custom.gobdRelevant === true`.
   * Defaults to non-fiscal.
   */
  classifyGobdRelevant?: (path: string, method: HttpMethod) => boolean;
}

const HEADER = 'idempotency-key';

/**
 * Idempotency-key ownership (ADR-0044 §4), the single hardest correctness
 * concern in Phase 3:
 *
 *   • FISCAL paths (ankauf / sales / storno / cash-movement / shift-close):
 *     the CALLER generates the key and persists its intent BEFORE invoking
 *     `client.request`, passing it via `meta.custom.idempotencyKey`. We must
 *     NOT generate it here — by the time the middleware runs, a crash would
 *     already have lost the intent↔key linkage on disk.
 *
 *   • NON-FISCAL mutations: the MIDDLEWARE auto-generates a UUID v7 for
 *     ergonomics, and tags `meta.custom.idempotencyKeyAutoGenerated = true`
 *     so an auditor can tell at a glance that loss-on-crash was acceptable
 *     for that row.
 */
export function offlineQueueMiddleware(deps: OfflineQueueDependencies): Middleware {
  const generateKey = deps.generateKey ?? uuidv7;
  const classifyGobd = deps.classifyGobdRelevant ?? ((path: string) => isGobdRelevantPath(path));

  return async (req, next): Promise<MiddlewareResponse> => {
    // Reads are never enqueued — only mutations have durable intent.
    if (req.method === 'GET' || req.method === 'HEAD') return next(req);
    // The replay loop sets this to prevent recursive re-enqueueing.
    if (req.meta.custom?.skipOfflineQueue === true) return next(req);

    const callerKey = req.meta.custom?.idempotencyKey;
    const callerSupplied = typeof callerKey === 'string' && callerKey.length > 0;
    const idempotencyKey = callerSupplied ? (callerKey as string) : generateKey();

    // Seal the key onto the outbound request + record the forensic flag.
    req.headers[HEADER] = idempotencyKey;
    req.meta.custom = {
      ...(req.meta.custom ?? {}),
      idempotencyKey,
      idempotencyKeyAutoGenerated: !callerSupplied,
    };

    const gobdRelevant =
      req.meta.custom?.gobdRelevant === true || classifyGobd(req.path, req.method);

    const enqueue = async (cause?: unknown): Promise<never> => {
      const enqueuedAt = Date.now();
      await deps.store.enqueue({
        idempotencyKey,
        traceId: req.meta.traceId ?? null,
        method: req.method,
        path: req.path,
        url: req.url,
        headers: { ...req.headers },
        body: req.body,
        enqueuedAt,
        gobdRelevant,
        callerSuppliedKey: callerSupplied,
        deviceId: deps.deviceId,
      });
      throw new ApiOfflineQueuedError(idempotencyKey, enqueuedAt, cause);
    };

    // Known-offline: don't waste a network attempt — enqueue immediately.
    if (!deps.isOnline()) return enqueue();

    try {
      return await next(req);
    } catch (err) {
      // Only transport-level unreachability enqueues. A real 4xx/5xx from a
      // reachable server (validation, conflict, sanctions, …) is a genuine
      // outcome and must surface to the caller unchanged.
      if (err instanceof ApiNetworkError || err instanceof ApiCircuitOpenError) {
        return enqueue(err);
      }
      throw err;
    }
  };
}
