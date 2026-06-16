/**
 * pos_reservation_sweeper — the durable backstop for abandoned POS holds (P1.4).
 *
 * POS reservations are TTL-less, so `reservation_sweeper` (which only releases
 * rows with a non-null `reservation_expires_at`) never touches them. A POS hold
 * whose release never reached the server (Tauri SIGKILL / power loss before the
 * `beforeunload` beacon flushed) would otherwise leak forever. This sweep
 * reclaims any POS hold abandoned past a conservative window (default 12h ≫ a
 * shift, so a parked cart is never yanked mid-sale).
 *
 * Mirrors reservation-sweeper.ts: idempotent, emits one ledger event per row.
 */

import { emit } from '@warehouse14/audit';
import type { AppDb } from '@warehouse14/db/client';
import { autoReleaseStalePos } from '@warehouse14/inventory-lock';

import type { JobDefinition } from '../lib/job-runner.js';

/** Reclaim POS holds older than this. 12h — longer than any single shift. */
const POS_STALE_HOLD_MINUTES = 720;

export const posReservationSweeperJob: JobDefinition = {
  name: 'pos_reservation_sweeper',
  schedule: '*/10 * * * *', // every 10 minutes — these holds are not time-critical
  timeoutMs: 30_000,
  async run({ db, log }) {
    const releasedIds = await autoReleaseStalePos(db, {
      staleAfterMinutes: POS_STALE_HOLD_MINUTES,
    });
    if (releasedIds.length === 0) {
      return { rowsReleased: 0 };
    }

    let emitted = 0;
    for (const productId of releasedIds) {
      try {
        await emit(db as unknown as AppDb, {
          eventType: 'inventory.reservation_auto_released',
          entityTable: 'products',
          entityId: productId,
          payload: { reason: 'pos_stale_hold_reclaimed' },
        });
        emitted++;
      } catch (err) {
        log.warn('failed to emit ledger event for reclaimed POS hold', {
          productId,
          err: String(err),
        });
      }
    }
    log.info('pos sweeper reclaimed stale POS holds', {
      released: releasedIds.length,
      emitted,
    });
    return { rowsReleased: releasedIds.length, ledgerEventsEmitted: emitted };
  },
};
