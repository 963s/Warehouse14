/**
 * Storefront reserve-and-pickup.
 *
 *   POST /api/storefront/cart/reserve
 *       — turn the ACTIVE cart into a RESERVED pickup request.
 *
 * The storefront's first commerce phase moves NO money online: a customer
 * reserves items, then completes the purchase IN THE SHOP via the POS (identity
 * for thresholded gold, payment, and the TSE-signed receipt all happen at the
 * till). A reservation is therefore NOT a fiscal sale and never becomes a
 * `transactions` row.
 *
 * Each item is held via inventory-lock channel=WEB_RESERVATION (a 3-day soft
 * hold the existing autoReleaseExpired sweeper frees). The cart then flips
 * ACTIVE → RESERVED + reserved_at, which fires the 0068 `on_cart_reserved`
 * trigger → a `web_order.reserved` ledger event → the POS / Owner Desktop see the
 * new order LIVE over /api/sse/ledger.
 *
 * Partial-failure safety: if any item can no longer be reserved, every hold this
 * request already took is released before we fail, so nothing is stranded.
 */

import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { cartItems, carts } from '@warehouse14/db/schema';
import {
  release as inventoryRelease,
  reserve as inventoryReserve,
} from '@warehouse14/inventory-lock';

import { requireShopper } from '../lib/shopper.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class CartNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class ReserveValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}
class ProductNotReservableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const ReserveResponse = Type.Object({
  cartId: Type.String({ format: 'uuid' }),
  status: Type.Literal('RESERVED'),
  reservedAt: Type.String({ format: 'date-time' }),
  itemCount: Type.Integer(),
});

const storefrontReserveRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/storefront/cart/reserve',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Reserve the active cart for in-shop pickup (no payment).',
        description:
          'Holds every item (inventory-lock channel=WEB_RESERVATION, 3-day TTL) and ' +
          'flips the cart ACTIVE → RESERVED. Emits a web_order.reserved ledger event so ' +
          'staff see it live. No payment and no fiscal transaction — the sale is completed ' +
          'in the shop via the POS.',
        response: {
          200: ReserveResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireShopper(req);

      const [cart] = await app.db
        .select({ id: carts.id })
        .from(carts)
        .where(and(eq(carts.shopperId, req.shopper.id), eq(carts.status, 'ACTIVE')))
        .limit(1);
      if (!cart) {
        throw new CartNotFoundError('No active cart to reserve.');
      }

      const items = await app.db
        .select({ id: cartItems.id, productId: cartItems.productId })
        .from(cartItems)
        .where(eq(cartItems.cartId, cart.id));
      if (items.length === 0) {
        throw new ReserveValidationError('Cart is empty.', { itemsCount: 0 });
      }

      // Hold every item under one reservation session. Track successes so a later
      // failure can release them — nothing is left stranded.
      const reservationSessionId = randomUUID();
      const held: string[] = [];
      try {
        for (const item of items) {
          const reservation = await inventoryReserve(app.db, {
            productId: item.productId,
            channel: 'WEB_RESERVATION',
            sessionId: reservationSessionId,
            userId: null,
          });
          if (reservation === null) {
            throw new ProductNotReservableError(
              `Product ${item.productId} is no longer available — reservation aborted.`,
            );
          }
          held.push(item.productId);
        }
      } catch (err) {
        await Promise.all(
          held.map((productId) =>
            inventoryRelease(app.db, {
              productId,
              sessionId: reservationSessionId,
              userId: null,
              reason: 'storefront_checkout_abandoned',
            }).catch(() => {
              /* best-effort rollback */
            }),
          ),
        );
        throw err;
      }

      // Flip the cart to RESERVED — the 0068 trigger emits the live staff event.
      const reservedAt = new Date();
      await app.db
        .update(carts)
        .set({ status: 'RESERVED', reservedAt, reservationSessionId })
        .where(eq(carts.id, cart.id));

      return reply.status(200).send({
        cartId: cart.id,
        status: 'RESERVED' as const,
        reservedAt: reservedAt.toISOString(),
        itemCount: items.length,
      });
    },
  );
};

export default storefrontReserveRoutes;
