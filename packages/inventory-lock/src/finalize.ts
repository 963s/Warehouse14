/**
 * Finalize a reservation — RESERVED → SOLD.
 *
 * Called after the payment is confirmed:
 *   • POS card sale completed via ZVT
 *   • Storefront Mollie payment.succeeded webhook
 *   • eBay order paid
 *
 * Ownership guards (memory.md §19.2 C-1 fix):
 *   • `status = 'RESERVED'`                                   — must be reserved
 *   • `reserved_by_session_id = ${sessionId}`                 — same checkout session
 *   • `reserved_by_user_id IS NOT DISTINCT FROM ${userId}`    — same operator
 *
 * The `IS NOT DISTINCT FROM` operator treats NULL = NULL — required so a
 * STOREFRONT guest reservation (user_id NULL) can be finalized by the
 * webhook passing `userId: null`. A logged-in cashier always passes their
 * actor id; the row's user_id was populated at reserve() time from the
 * same source, so a different operator cannot finalize a reservation that
 * wasn't theirs (closes the cross-cashier stale-cart exploit).
 *
 * Throws ReservationOwnershipError on mismatch — the caller should re-fetch
 * state. If the row is already SOLD (a rare duplicate webhook), the UPDATE
 * affects zero rows and the error surfaces so the caller can decide whether
 * to ignore (idempotent finalize) or alert.
 */

import type { AnyDb } from '@warehouse14/db/client';
import { sql } from 'drizzle-orm';

import { ReservationOwnershipError } from './errors.js';
import type { FinalizeInput } from './types.js';

export async function finalize(db: AnyDb, input: FinalizeInput): Promise<void> {
  const { productId, sessionId, userId } = input;

  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    UPDATE products
       SET status  = 'SOLD',
           sold_at = now()
     WHERE id                     = ${productId}::uuid
       AND status                 = 'RESERVED'
       AND reserved_by_session_id = ${sessionId}::uuid
       AND reserved_by_user_id    IS NOT DISTINCT FROM ${userId}::uuid
   RETURNING id
  `);

  if (result.length === 0) {
    throw new ReservationOwnershipError(productId);
  }
}
