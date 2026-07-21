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

import { sql } from 'drizzle-orm';

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
    const { releasedIds, expiredCartIds } = await db.transaction(async (tx) => {
      const ids = await autoReleaseExpired(tx);
      for (const productId of ids) {
        await emit(tx, {
          eventType: 'inventory.reservation_auto_released',
          entityTable: 'products',
          entityId: productId,
          payload: { reason: 'reservation_expires_at_lapsed' },
        });
      }

      // Cart reconciliation (security review 2026-07-21): releasing a product
      // nulls its reserved_by_session_id, so a WEB_RESERVATION cart was left
      // stranded in status='RESERVED' with its stock already freed — a stale
      // "reserved" order in the customer + staff views. Flip any RESERVED cart
      // whose reservation session holds NO more RESERVED product to ABANDONED —
      // the terminal "timed out" state the checkout sweeper also lands on.
      // (cart_status has NO 'EXPIRED' member; ABANDONED is the correct terminal
      // and is already handled everywhere the checkout sweeper's carts surface.)
      // Runs every tick (not gated on this tick's releases) so a cart stranded
      // by an earlier sweep is still reconciled. The on_cart_reserved trigger
      // fires web_order.reserved only on ENTRY to RESERVED, so we emit
      // web_order.expired here for the staff/customer live feed. Enum labels are
      // cast explicitly (::cart_status / ::product_status) so an invalid label
      // fails loudly at review, never silently every tick at runtime.
      const expiredCarts = (await tx.execute(sql`
        UPDATE carts
           SET status = 'ABANDONED'::cart_status, updated_at = now()
         WHERE status = 'RESERVED'::cart_status
           AND reservation_session_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM products p
              WHERE p.reserved_by_session_id = carts.reservation_session_id
                AND p.status = 'RESERVED'::product_status
           )
        RETURNING id
      `)) as unknown as { id: string }[];
      const cartIds = expiredCarts.map((c) => c.id);
      for (const cartId of cartIds) {
        await emit(tx, {
          eventType: 'web_order.expired',
          entityTable: 'carts',
          entityId: cartId,
          payload: { reason: 'reservation_expires_at_lapsed' },
        });
      }
      return { releasedIds: ids, expiredCartIds: cartIds };
    });

    if (releasedIds.length === 0 && expiredCartIds.length === 0) {
      return { rowsReleased: 0, cartsExpired: 0 };
    }
    log.info('sweeper released expired reservations', {
      released: releasedIds.length,
      cartsExpired: expiredCartIds.length,
    });
    return {
      rowsReleased: releasedIds.length,
      ledgerEventsEmitted: releasedIds.length + expiredCartIds.length,
      cartsExpired: expiredCartIds.length,
    };
  },
};
