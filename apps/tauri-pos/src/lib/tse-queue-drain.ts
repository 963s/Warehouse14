/**
 * tse-queue-drain — one FIFO pass over the durable TSE replay queue (Phase 1.3,
 * Step 5a). The pure engine, mirroring `drainOutbox` in the api-client: no
 * timers, no listeners, never throws. The single-flight `running` flag + 5s
 * heartbeat + online-listener + startup sweep live in the `useTseQueueDrain`
 * hook (Step 5b), exactly as `drainOutbox` is driven by `useOfflineReplay`.
 *
 * Two replay paths per row (keyed on `signature`):
 *   (a) finish-failed (signature NULL) → re-invoke Fiskaly FINISH, PERSIST the
 *       signature onto the row BEFORE the record leg (so a crash in between can
 *       only ever leave a record-only row — never a re-FINISH of an already-
 *       finished intention), then POST it to the server.
 *   (b) record-failed (signature populated) → POST only; NEVER re-FINISH.
 *
 * The record leg is server-idempotent (`transactionsApi.recordTseSignature`,
 * "Idempotent — safe to retry"), so re-running it is safe.
 *
 * The one irreducible hole (B1): if FINISH itself reports the intention is
 * ALREADY finished, the signature is unreconstructable — we mark the row
 * `failed_terminal` and surface it (Gerätemanager badge) rather than looping
 * forever. This is a bounded, visible dead-end, not a silent drop.
 *
 * Rows are independent fiscal records (distinct transactions), so a failure on
 * one row does NOT abort the sweep — unlike the outbox, whose FIFO mutations can
 * depend on each other. Each failure is per-row: increment, or at the cap go
 * terminal, then continue to the next row.
 */

import { MAX_ATTEMPTS } from './tse-queue-store.js';
import type { DrainableTseEntry, TseQueueStore } from './tse-queue-store.js';
import type { TseSignature } from './hardware-client.js';

export interface TseDrainDeps {
  store: TseQueueStore;
  /**
   * Path (a): re-invoke Fiskaly FINISH for a finish-failed row. Resolves with
   * the signature; rejects with the underlying error (which `isAlreadyFinished`
   * classifies).
   */
  finish: (entry: DrainableTseEntry) => Promise<TseSignature>;
  /**
   * The server-record leg (idempotent). Records `signature` against the row's
   * server transaction. Rejects on any non-2xx.
   */
  record: (entry: DrainableTseEntry, signature: TseSignature) => Promise<void>;
  /**
   * True when a FINISH rejection means the intention was already finished
   * server-side (Fiskaly "already finished") — the signature can no longer be
   * obtained, so the row is a terminal dead-end rather than a retry.
   */
  isAlreadyFinished: (error: unknown) => boolean;
  /** Injected clock (testability); Step 5b passes `Date.now`. */
  now: () => number;
}

export interface TseDrainOutcome {
  /** Rows examined this pass. */
  attempted: number;
  /** Fully replayed (finished if needed + recorded). */
  succeeded: number;
  /** Moved to `failed_terminal` this pass (cap hit or unreconstructable FINISH). */
  terminal: number;
  /** Failed transiently, left `pending` for the next sweep. */
  retryable: number;
}

/**
 * Drain the TSE queue once, FIFO. Never throws: a store-write failure while
 * handling a row is swallowed (best-effort) so one bad row can't wedge the
 * sweep or crash the driving hook. A rejection from `store.listDrainable`
 * itself propagates — the hook's try/finally owns that.
 */
export async function drainTseQueue(deps: TseDrainDeps): Promise<TseDrainOutcome> {
  const { store, finish, record, isAlreadyFinished, now } = deps;
  const outcome: TseDrainOutcome = { attempted: 0, succeeded: 0, terminal: 0, retryable: 0 };

  const drainable = await store.listDrainable(now());
  for (const entry of drainable) {
    outcome.attempted += 1;
    try {
      await store.markInFlight(entry.id, now());

      let signature = entry.signature;
      if (signature === null) {
        // Path (a): finish-failed — re-invoke FINISH.
        try {
          signature = await finish(entry);
        } catch (finishErr) {
          if (isAlreadyFinished(finishErr)) {
            // FINISH already consumed the intention; the signature is gone. Bounded
            // dead-end, surfaced — not an infinite re-FINISH loop (B1).
            await store.markFailedTerminal(entry.id, finishErr, now());
            outcome.terminal += 1;
            continue;
          }
          throw finishErr; // transient / other → the retry/cap path below
        }
        // Persist BEFORE the record leg so a crash here degrades to record-only.
        await store.persistSignature(entry.id, signature);
      }

      // Record leg (idempotent), for BOTH paths.
      await record(entry, signature);
      await store.markSucceeded(entry.id, now());
      outcome.succeeded += 1;
    } catch (err) {
      // Per-row failure. At the cap the row becomes a surfaced dead-end; else it
      // is re-armed to pending for the next heartbeat. Swallow a store-write
      // failure so it can't wedge the remaining rows.
      try {
        if (entry.attemptCount + 1 >= MAX_ATTEMPTS) {
          await store.markFailedTerminal(entry.id, err, now());
          outcome.terminal += 1;
        } else {
          await store.incrementAttempt(entry.id, err, now());
          outcome.retryable += 1;
        }
      } catch {
        // best-effort; the row stays in_flight and the stale re-selection recovers it.
      }
    }
  }

  return outcome;
}
