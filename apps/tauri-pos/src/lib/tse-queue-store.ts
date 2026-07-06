/**
 * tse-queue-store — the DURABLE TSE signature replay queue (Phase 1.3).
 *
 * Replaces the volatile `localStorage['warehouse14.tse-queue.v1']` queue in
 * `tse-service.ts`, which was wiped on sign-out and silently rolled off at 200
 * rows — both fatal for fiscal records (KassenSichV §146a signatures the till
 * could not finish or record online). This store persists to the same
 * `sqlite:warehouse14.db` the outbox uses (table `tse_signature_queue`, created
 * by the `0003_tse_queue.sql` migration on startup), so an entry survives crash
 * + refresh + sign-out and is NEVER dropped.
 *
 * Modeled on `outbox-store.ts`: lazy `db()` (the SQLite open is paid only on the
 * failure/offline path that enqueues), a monotonic per-device sequence for a
 * deterministic FIFO drain order, and `$N` placeholders (tauri-plugin-sql /
 * sqlx). Outside a Tauri webview `Database.load` rejects — same contract as
 * `kyc-store.ts`: the store propagates and the callers (the drain hook + the
 * Gerätemanager badge) degrade to "no local records". Enqueue only ever runs
 * from the Tauri-gated fiscal finalize path, so its reject can only surface on a
 * real till, where it is a genuine problem that must not be swallowed.
 *
 * Two replay paths, distinguished by `signature`:
 *   (a) finish-failed  → `signature: null`  → replay re-invokes Fiskaly FINISH,
 *                          then POSTs the result to the server.
 *   (b) record-failed  → `signature: <TseSignature>` → the FINISH already
 *                          consumed the intention; replay MUST NOT re-finish,
 *                          only re-POST the stored signature to the server.
 */

import type Database from '@tauri-apps/plugin-sql';

import type { TseSignature } from './hardware-client.js';
import type { VatAmount } from './tse-vat.js';

const DB_PATH = 'sqlite:warehouse14.db';
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * A crash mid-drain leaves an `in_flight` row. After this window the next sweep
 * re-selects it so it is never stranded. Must exceed a single drain's realistic
 * wall time (one Fiskaly FINISH + one server POST) with margin.
 */
export const STALE_MS = 60_000;

/**
 * Outbound retry cap per row. Bounds hammering a recovering Fiskaly (the real
 * DoS direction is outbound). On the Nth failure the drain moves the row to
 * `failed_terminal` — surfaced in the Gerätemanager badge, never deleted.
 */
export const MAX_ATTEMPTS = 8;

export type TseQueueStatus = 'pending' | 'in_flight' | 'succeeded' | 'failed_terminal';

/**
 * What an enqueue supplies — the complete, self-contained fiscal context needed
 * to replay a FINISH + server-POST with a byte-identical signed body. Integer
 * cents throughout (`amountCents`, every `amountsPerVatId` bucket); the STRICT
 * table rejects a non-integer, so a lossy float can never slip in.
 */
export interface EnrichedTseQueueEntry {
  intentionId: string;
  fiskalyTransactionId: string;
  tssId: string;
  clientId: string;
  /** result.id (Verkauf) / result.transactionId (Ankauf) — the `:id` in the POST route. */
  serverTransactionId: string;
  amountCents: number;
  paymentKind: 'Bar' | 'Unbar';
  amountsPerVatId: VatAmount[];
  processType: string;
  receiptLocator: string | null;
  /** NULL = finish-failed (path a); populated = record-failed (path b, never re-finish). */
  signature: TseSignature | null;
  /** ms epoch, device clock — the failure timestamp. */
  createdAt: number;
  /** The originating failure, for the honest surface. */
  lastError?: unknown;
}

/** Raw columns read back from `tse_signature_queue`. */
export interface TseQueueRow {
  id: number;
  monotonic_seq: number;
  intention_id: string;
  fiskaly_transaction_id: string;
  tss_id: string;
  client_id: string;
  server_transaction_id: string;
  amount_cents: number;
  payment_kind: string;
  amounts_per_vat_id_json: string;
  process_type: string;
  receipt_locator: string | null;
  signature_json: string | null;
  status: TseQueueStatus;
  attempt_count: number;
  last_attempt_at: number | null;
  last_error_json: string | null;
  created_at: number;
  retention_until: number;
}

/** A parsed, drain-ready entry (row + decoded JSON columns). */
export interface DrainableTseEntry {
  id: number;
  monotonicSeq: number;
  intentionId: string;
  fiskalyTransactionId: string;
  tssId: string;
  clientId: string;
  serverTransactionId: string;
  amountCents: number;
  paymentKind: 'Bar' | 'Unbar';
  amountsPerVatId: VatAmount[];
  processType: string;
  receiptLocator: string | null;
  signature: TseSignature | null;
  status: TseQueueStatus;
  attemptCount: number;
}

export interface TseQueueStats {
  pending: number;
  inFlight: number;
  failedTerminal: number;
}

/** The store contract — the drain (Step 5) and the badge (Step 6) depend on this. */
export interface TseQueueStore {
  enqueue(entry: EnrichedTseQueueEntry): Promise<void>;
  listDrainable(now: number): Promise<DrainableTseEntry[]>;
  markInFlight(id: number, now: number): Promise<void>;
  incrementAttempt(id: number, error: unknown, now: number): Promise<void>;
  markSucceeded(id: number, now: number): Promise<void>;
  markFailedTerminal(id: number, error: unknown, now: number): Promise<void>;
  getStats(): Promise<TseQueueStats>;
}

export class TauriSqlTseQueueStore implements TseQueueStore {
  private dbPromise: Promise<Database> | null = null;

  private db(): Promise<Database> {
    if (!this.dbPromise) {
      this.dbPromise = import('@tauri-apps/plugin-sql').then(({ default: Db }) => Db.load(DB_PATH));
    }
    return this.dbPromise;
  }

  async enqueue(entry: EnrichedTseQueueEntry): Promise<void> {
    const db = await this.db();
    const retentionUntil = entry.createdAt + TEN_YEARS_MS; // fiscal-only table: always +10y

    // UPSERT that PROMOTES (D2a). Two enqueue paths can fire for one intention:
    // a finish-failed row (signature NULL) may already exist when the later
    // record-failed path enqueues the signed one. `COALESCE(excluded, existing)`
    // promotes NULL→signed and NEVER overwrites a real signature with NULL, while
    // re-arming status='pending'. A pure duplicate collapses to a no-op UPDATE.
    // `INSERT OR IGNORE` would silently DROP the signature — fiscal-signature loss.
    await db.execute(
      `INSERT INTO tse_signature_queue (
         monotonic_seq, intention_id, fiskaly_transaction_id, tss_id, client_id,
         server_transaction_id, amount_cents, payment_kind, amounts_per_vat_id_json,
         process_type, receipt_locator, signature_json, status, attempt_count,
         last_attempt_at, last_error_json, created_at, retention_until
       ) VALUES (
         (SELECT COALESCE(MAX(monotonic_seq), 0) + 1 FROM tse_signature_queue),
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 0, $12, $13, $14, $15
       )
       ON CONFLICT(intention_id) DO UPDATE SET
         signature_json  = COALESCE(excluded.signature_json, tse_signature_queue.signature_json),
         status          = 'pending',
         last_error_json = excluded.last_error_json,
         last_attempt_at = excluded.last_attempt_at`,
      [
        entry.intentionId,
        entry.fiskalyTransactionId,
        entry.tssId,
        entry.clientId,
        entry.serverTransactionId,
        entry.amountCents,
        entry.paymentKind,
        JSON.stringify(entry.amountsPerVatId),
        entry.processType,
        entry.receiptLocator,
        entry.signature ? JSON.stringify(entry.signature) : null,
        entry.createdAt, // last_attempt_at ← failure time
        entry.lastError !== undefined ? JSON.stringify(serializeError(entry.lastError)) : null,
        entry.createdAt,
        retentionUntil,
      ],
    );
  }

  async listDrainable(now: number): Promise<DrainableTseEntry[]> {
    const db = await this.db();
    const staleThreshold = now - STALE_MS;
    // pending, OR an in_flight row whose drain crashed (last_attempt older than
    // STALE_MS, or never stamped). succeeded/failed_terminal are excluded.
    const rows = await db.select<TseQueueRow[]>(
      `SELECT * FROM tse_signature_queue
        WHERE status = 'pending'
           OR (status = 'in_flight' AND (last_attempt_at IS NULL OR last_attempt_at < $1))
        ORDER BY monotonic_seq ASC`,
      [staleThreshold],
    );
    return rows.map(rowToDrainable);
  }

  async markInFlight(id: number, now: number): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE tse_signature_queue SET status = 'in_flight', last_attempt_at = $1 WHERE id = $2`,
      [now, id],
    );
  }

  async incrementAttempt(id: number, error: unknown, now: number): Promise<void> {
    const db = await this.db();
    // Re-arm to 'pending' so the next sweep re-selects it; bump the attempt count
    // (the drain caps it, then calls markFailedTerminal instead — never here).
    await db.execute(
      `UPDATE tse_signature_queue
          SET attempt_count = attempt_count + 1,
              status = 'pending',
              last_error_json = $1,
              last_attempt_at = $2
        WHERE id = $3`,
      [JSON.stringify(serializeError(error)), now, id],
    );
  }

  async markSucceeded(id: number, now: number): Promise<void> {
    const db = await this.db();
    // Retained, not deleted (D6): the signed fiscal record stays for the +10y
    // retention. getStats() excludes 'succeeded' so the badge clears.
    await db.execute(
      `UPDATE tse_signature_queue SET status = 'succeeded', last_attempt_at = $1 WHERE id = $2`,
      [now, id],
    );
  }

  async markFailedTerminal(id: number, error: unknown, now: number): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE tse_signature_queue
          SET status = 'failed_terminal', last_error_json = $1, last_attempt_at = $2
        WHERE id = $3`,
      [JSON.stringify(serializeError(error)), now, id],
    );
  }

  async getStats(): Promise<TseQueueStats> {
    const db = await this.db();
    // 'succeeded' is intentionally excluded (D6) so the Gerätemanager badge shows
    // only the live backlog (pending + in_flight) plus anything stuck terminal.
    const rows = await db.select<Array<{ status: TseQueueStatus; count: number }>>(
      `SELECT status, COUNT(*) AS count
         FROM tse_signature_queue
        WHERE status IN ('pending', 'in_flight', 'failed_terminal')
        GROUP BY status`,
    );
    const stats: TseQueueStats = { pending: 0, inFlight: 0, failedTerminal: 0 };
    for (const row of rows) {
      if (row.status === 'pending') stats.pending = row.count;
      else if (row.status === 'in_flight') stats.inFlight = row.count;
      else if (row.status === 'failed_terminal') stats.failedTerminal = row.count;
    }
    return stats;
  }
}

function rowToDrainable(row: TseQueueRow): DrainableTseEntry {
  return {
    id: row.id,
    monotonicSeq: row.monotonic_seq,
    intentionId: row.intention_id,
    fiskalyTransactionId: row.fiskaly_transaction_id,
    tssId: row.tss_id,
    clientId: row.client_id,
    serverTransactionId: row.server_transaction_id,
    amountCents: row.amount_cents,
    paymentKind: row.payment_kind === 'Unbar' ? 'Unbar' : 'Bar',
    amountsPerVatId: safeParse<VatAmount[]>(row.amounts_per_vat_id_json) ?? [],
    processType: row.process_type,
    receiptLocator: row.receipt_locator,
    signature: row.signature_json ? (safeParse<TseSignature>(row.signature_json) ?? null) : null,
    status: row.status,
    attemptCount: row.attempt_count,
  };
}

function safeParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Reduce an arbitrary thrown value to an audit-stable JSON shape (mirrors outbox-store). */
function serializeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const e = error as {
      name?: unknown;
      message?: unknown;
      serverCode?: unknown;
      serverDetails?: unknown;
    };
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      message: typeof e.message === 'string' ? e.message : String(error),
      ...(e.serverCode !== undefined ? { serverCode: e.serverCode } : {}),
      ...(e.serverDetails !== undefined ? { serverDetails: e.serverDetails } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}

/** Process-wide singleton — one durable queue per till. */
export const tseQueueStore: TseQueueStore = new TauriSqlTseQueueStore();
