/**
 * reservation_sweeper — releases STOREFRONT/EBAY reservations past their TTL.
 *
 * Runs every minute. `autoReleaseExpired` is idempotent — a sweep that finds
 * nothing returns []. We emit one ledger event per released row so SSE
 * subscribers (Bridge UX live feed) see the activity in real time.
 *
 * Scope: only `reservation_expires_at IS NOT NULL` rows. POS reservations
 * have `reservation_expires_at = NULL` (indefinite) and are released by the
 * cashier, never the sweeper.
 */

import { emit } from '@warehouse14/audit';
import { autoReleaseExpired } from '@warehouse14/inventory-lock';
import type { JobDefinition } from '../lib/job-runner.js';

export const reservationSweeperJob: JobDefinition = {
  name: 'reservation_sweeper',
  schedule: '*/1 * * * *', // every minute
  timeoutMs: 30_000,
  async run({ db, log }) {
    // P1.5 — release + the per-row ledger events in ONE transaction. Previously
    // the release UPDATE committed, then each `emit` ran as a SEPARATE statement
    // whose failure was only logged → a product could go AVAILABLE with NO audit
    // trail of why (a GoBD hash-chain gap). Now they commit together; a ledger
    // failure rolls the release back and the next idempotent tick retries.
    // (autoReleaseExpired + emit both accept AnyDb, so the tx handle passes
    // directly — no AppDb cast needed.)
    const releasedIds = await db.transaction(async (tx) => {
      const ids = await autoReleaseExpired(tx);
      for (const productId of ids) {
        await emit(tx, {
          eventType: 'inventory.reservation_auto_released',
          entityTable: 'products',
          entityId: productId,
          payload: { reason: 'reservation_expires_at_lapsed' },
        });
      }
      return ids;
    });

    if (releasedIds.length === 0) {
      return { rowsReleased: 0 };
    }
    log.info('sweeper released expired reservations', { released: releasedIds.length });
    return { rowsReleased: releasedIds.length, ledgerEventsEmitted: releasedIds.length };
  },
};
