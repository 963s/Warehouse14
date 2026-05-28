/**
 * Outbox replay engine (ADR-0044 §6 — action items 4 & 5). Pure orchestration:
 * given a durable `OutboxStore` and an injected `replay` function (which the
 * app layer backs with `client.request(...)`), this drains pending mutations
 * in strict FIFO order and applies the conflict-resolution policy.
 *
 * No Tauri, no React, no network — fully unit-testable. The app layer
 * (`apps/tauri-pos/src/lib/offline-replay.ts`) wires the network-status
 * listeners, the real client, and the single-flight lock around `drainOutbox`.
 *
 * Policy (ADR-0044 §6):
 *   • success            → `markSucceeded`, advance to next row.
 *   • transient failure  → ABORT the run, leave the row `pending`. Retry on
 *     the next connectivity event. (ApiNetworkError, ApiCircuitOpenError, and
 *     5xx/429 — infrastructure, not intent, is at fault.)
 *   • auth gap           → ABORT the run, leave `pending`. A replayed request
 *     hitting UNAUTHORIZED / STEP_UP_REQUIRED means there is no session to
 *     replay under; it is not a divergence. (Step-up is skipped during replay,
 *     so it cannot be answered in the background.)
 *   • anything else      → HALT: mark the row `conflict`, emit `onConflict`,
 *     and STOP. Subsequent rows stay `pending` behind it. Strict FIFO halt is
 *     the safe default for a fiscal ledger — applying mutation N+1 while N is
 *     unresolved can produce nonsensical states (a Storno before its parent
 *     sale reconciles, a cash-movement across a closed Tagesabschluss).
 */

import {
  ApiCircuitOpenError,
  ApiError,
  ApiNetworkError,
  ApiOutboxConflictError,
} from '../errors.js';
import type { OutboxRecord, OutboxStore } from './offline-queue.js';

/** Outcome of one drain pass. */
export type ReplayOutcome =
  | { readonly kind: 'drained'; readonly succeeded: number }
  | {
      readonly kind: 'aborted';
      readonly succeeded: number;
      readonly record: OutboxRecord;
      readonly error: unknown;
    }
  | {
      readonly kind: 'halted';
      readonly succeeded: number;
      readonly record: OutboxRecord;
      readonly error: ApiOutboxConflictError;
    };

export interface ReplayDependencies {
  store: OutboxStore;
  /**
   * Replay a single sealed mutation against the server. Resolves with the
   * server response on 2xx; throws `ApiError` / `ApiNetworkError` /
   * `ApiCircuitOpenError` otherwise. The app backs this with
   * `client.request(record.method, record.path, record.body, { headers, custom: { skipOfflineQueue: true, skipStepUp: true, idempotencyKey } })`.
   */
  replay: (record: OutboxRecord) => Promise<unknown>;
  /** Fired once when a conflict halts the queue — UI surfaces the Compliance Inbox. */
  onConflict?: (record: OutboxRecord, error: ApiOutboxConflictError) => void;
}

/** Auth-shaped codes: no session to replay under — leave pending, don't halt. */
const AUTH_GAP_CODES = new Set(['UNAUTHORIZED', 'STEP_UP_REQUIRED', 'DEVICE_NOT_AUTHORIZED']);

/** Transient = infrastructure unreachability, retry later; never a conflict. */
function isTransient(err: unknown): boolean {
  if (err instanceof ApiNetworkError || err instanceof ApiCircuitOpenError) return true;
  if (err instanceof ApiError) {
    if (AUTH_GAP_CODES.has(err.code)) return true;
    return err.httpStatus === 429 || err.httpStatus >= 500;
  }
  return false;
}

function toConflictError(err: unknown, idempotencyKey: string): ApiOutboxConflictError {
  if (err instanceof ApiError) {
    return new ApiOutboxConflictError({
      idempotencyKey,
      serverCode: err.code,
      serverDetails: err.details,
      message: err.message,
    });
  }
  return new ApiOutboxConflictError({
    idempotencyKey,
    serverCode: 'UNKNOWN',
    serverDetails: err,
    message: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Drain the outbox once, FIFO. Single-flight is the caller's responsibility
 * (the app-layer controller guards against overlapping runs).
 */
export async function drainOutbox(deps: ReplayDependencies): Promise<ReplayOutcome> {
  const pending = await deps.store.listPending();
  let succeeded = 0;

  for (const record of pending) {
    try {
      const response = await deps.replay(record);
      await deps.store.markSucceeded(record.idempotencyKey, response);
      succeeded += 1;
    } catch (err) {
      if (isTransient(err)) {
        return { kind: 'aborted', succeeded, record, error: err };
      }
      const conflict = toConflictError(err, record.idempotencyKey);
      await deps.store.markConflict(record.idempotencyKey, conflict);
      deps.onConflict?.(record, conflict);
      return { kind: 'halted', succeeded, record, error: conflict };
    }
  }

  return { kind: 'drained', succeeded };
}
