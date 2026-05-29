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
import type { AppDb } from '@warehouse14/db/client';
import { autoReleaseExpired } from '@warehouse14/inventory-lock';
import type { JobDefinition } from '../lib/job-runner.js';

export const reservationSweeperJob: JobDefinition = {
  name: 'reservation_sweeper',
  schedule: '*/1 * * * *', // every minute
  timeoutMs: 30_000,
  async run({ db, log }) {
    // The package is typed against AppDb but the Drizzle surface is identical
    // for our purposes — the cross-cast is safe at this boundary.
    const releasedIds = await autoReleaseExpired(db as unknown as AppDb);

    if (releasedIds.length === 0) {
      return { rowsReleased: 0 };
    }

    // Emit one ledger event per released row so the SSE stream shows it.
    let emitted = 0;
    for (const productId of releasedIds) {
      try {
        await emit(db as unknown as AppDb, {
          eventType: 'inventory.reservation_auto_released',
          entityTable: 'products',
          entityId: productId,
          payload: { reason: 'reservation_expires_at_lapsed' },
        });
        emitted++;
      } catch (err) {
        log.warn('failed to emit ledger event for released product', {
          productId,
          err: String(err),
        });
      }
    }
    log.info('sweeper released expired reservations', { released: releasedIds.length, emitted });
    return { rowsReleased: releasedIds.length, ledgerEventsEmitted: emitted };
  },
};
