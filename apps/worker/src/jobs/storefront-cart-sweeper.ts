/**
 * storefront_cart_sweeper — releases expired CHECKOUT carts (Day 20).
 *
 * Runs every minute. Independent of `reservation_sweeper` because the scope
 * is different:
 *   • `reservation_sweeper` operates on `products.reserved_by_session_id`
 *     and is triggered by `reservation_expires_at < now()`.
 *   • This sweeper operates on `carts.status = 'CHECKOUT'` and is triggered
 *     by `carts.checkout_expires_at < now()` (the 15-min B2C window).
 *
 * Lifecycle:
 *   For each expired CHECKOUT cart:
 *     1. Open ONE DB transaction.
 *     2. For each cart_item:
 *          inventory-lock.release({productId, sessionId: cart.reservation_session_id,
 *                                  reason: 'storefront_checkout_abandoned'})
 *        If release throws ReservationOwnershipError, that item was already
 *        finalized (concurrent webhook success) — log + continue, don't fail
 *        the whole cart.
 *     3. UPDATE carts SET status = 'ABANDONED'.
 *     4. UPDATE payment_intents SET status = 'EXPIRED' for any non-terminal row.
 *     5. INSERT audit_log ('cart.abandoned_by_sweeper') with the cart id.
 *
 * The advisory lock (`storefront_cart_sweeper`) prevents two worker processes
 * from racing — `reservation_sweeper` and this one DON'T share a lock (they
 * touch disjoint state, so they're independent).
 *
 * Batch: up to 50 carts per tick to bound the transaction time. The next
 * tick (60s later) picks up whatever's left.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import {
  ReservationOwnershipError,
  release as inventoryRelease,
} from '@warehouse14/inventory-lock';

import type { JobDefinition } from '../lib/job-runner.js';

const MAX_CARTS_PER_TICK = 50;

export const storefrontCartSweeperJob: JobDefinition = {
  name: 'storefront_cart_sweeper',
  schedule: '*/1 * * * *', // every minute
  timeoutMs: 60_000,
  async run({ db, log }) {
    // Find expired CHECKOUT carts. We cap the batch to bound transaction time;
    // anything left over rolls forward to the next tick.
    const expired = await db.execute<{
      id: string;
      reservation_session_id: string;
    }>(drizzleSql`
      SELECT id, reservation_session_id
        FROM carts
       WHERE status = 'CHECKOUT'::cart_status
         AND checkout_expires_at < now()
       ORDER BY checkout_expires_at ASC
       LIMIT ${MAX_CARTS_PER_TICK}
    `);

    if (expired.length === 0) {
      return { rowsAbandoned: 0, itemsReleased: 0 };
    }

    let abandonedCarts = 0;
    let releasedItems = 0;
    let releaseFailures = 0;

    for (const cart of expired) {
      try {
        await db.transaction(async (tx) => {
          // Re-read the cart inside the transaction WITH FOR UPDATE to
          // serialise vs a racing webhook conversion. If the webhook handler
          // already converted this cart between SELECT and tx start, status
          // is 'CONVERTED' and we skip the rest.
          const stillCheckout = await tx.execute<{
            id: string;
            reservation_session_id: string;
          }>(drizzleSql`
            SELECT id, reservation_session_id
              FROM carts
             WHERE id = ${cart.id}
               AND status = 'CHECKOUT'::cart_status
               FOR UPDATE
          `);
          if (stillCheckout.length === 0) {
            log.debug('cart_sweeper: cart no longer CHECKOUT, skipped', { cartId: cart.id });
            return;
          }

          const items = await tx.execute<{ product_id: string }>(drizzleSql`
            SELECT product_id FROM cart_items WHERE cart_id = ${cart.id}
          `);

          for (const item of items) {
            try {
              await inventoryRelease(tx, {
                productId: item.product_id,
                sessionId: cart.reservation_session_id,
                // Worker has no actor; storefront guests reserved with
                // userId=null, so NULL=NULL via IS NOT DISTINCT FROM.
                userId: null,
                reason: 'storefront_checkout_abandoned',
              });
              releasedItems++;
            } catch (err) {
              if (err instanceof ReservationOwnershipError) {
                // Product was finalized by a concurrent webhook (the success
                // raced with our expiry sweep) OR another sweep already
                // released it. Either way: log + continue.
                log.debug(
                  'cart_sweeper: item release ownership mismatch — likely concurrent finalize',
                  { cartId: cart.id, productId: item.product_id, err: (err as Error).message },
                );
                releaseFailures++;
              } else {
                throw err;
              }
            }
          }

          // Flip the cart to ABANDONED.
          await tx.execute(drizzleSql`
            UPDATE carts SET status = 'ABANDONED'::cart_status WHERE id = ${cart.id}
          `);

          // Expire any open payment intent on this cart.
          await tx.execute(drizzleSql`
            UPDATE payment_intents
               SET status = 'EXPIRED'::payment_intent_status
             WHERE cart_id = ${cart.id}
               AND status IN ('CREATED'::payment_intent_status, 'PENDING'::payment_intent_status)
          `);

          // Audit-log the abandonment for ops visibility.
          await tx.execute(drizzleSql`
            INSERT INTO audit_log (event_type, payload)
            VALUES (
              'cart.abandoned_by_sweeper',
              ${drizzleSql.raw(`'${JSON.stringify({ cartId: cart.id, itemsReleased: items.length }).replace(/'/g, "''")}'`)}::jsonb
            )
          `);

          abandonedCarts++;
        });
      } catch (err) {
        log.error('cart_sweeper: cart abandonment transaction failed', { err, cartId: cart.id });
        // The runner will record this as FAILED if EVERY iteration throws;
        // here we let one cart's failure NOT take down the batch.
      }
    }

    return {
      rowsAbandoned: abandonedCarts,
      itemsReleased: releasedItems,
      itemsReleaseRaced: releaseFailures,
    };
  },
};
