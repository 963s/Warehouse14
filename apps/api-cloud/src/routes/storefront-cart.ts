/**
 * Storefront cart routes (Day 19).
 *
 *   GET    /api/storefront/cart                 — get my active cart
 *   POST   /api/storefront/cart/items           — add product to cart
 *   DELETE /api/storefront/cart/items/:id       — remove cart line
 *   POST   /api/storefront/cart/checkout        — ACTIVE → CHECKOUT + Stripe PaymentIntent
 *
 * The 15-minute soft-lock (memory.md #64) is created by inventory-lock during
 * checkout — channel='STOREFRONT' triggers the auto 15-min TTL set in
 * @warehouse14/inventory-lock's reserve().
 */

import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { and, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { cartItems, carts, paymentIntents, products } from '@warehouse14/db/schema';
import { reserve as inventoryReserve } from '@warehouse14/inventory-lock';

import type { Env } from '../config/env.js';
import { requireShopper } from '../lib/shopper.js';
import { MAX_ITEMS_PER_CART } from '../lib/storefront-reservation-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  AddCartItemBody,
  CartView,
  CheckoutBody,
  CheckoutResponse,
  type AddCartItemBody as TAddCartItemBody,
  type CheckoutBody as TCheckoutBody,
} from '../schemas/storefront.js';

class CartNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class CartConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class ProductNotReservableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'PRODUCT_NOT_RESERVABLE';
}
class CheckoutValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}
class StripeNotConfiguredError extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'SERVICE_UNAVAILABLE';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const CART_CHECKOUT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PAYMENT_METHOD_TYPES: ReadonlyArray<
  'card' | 'sepa_debit' | 'klarna' | 'ideal' | 'giropay'
> = ['card', 'sepa_debit', 'klarna', 'ideal', 'giropay'];

/** Build the response view of a cart given its id. */
async function buildCartView(
  app: import('fastify').FastifyInstance,
  cartId: string,
): Promise<import('../schemas/storefront.js').CartView> {
  const [cart] = await app.db
    .select({
      id: carts.id,
      status: carts.status,
      checkoutExpiresAt: carts.checkoutExpiresAt,
      createdAt: carts.createdAt,
    })
    .from(carts)
    .where(eq(carts.id, cartId))
    .limit(1);
  if (!cart) throw new CartNotFoundError(`Cart ${cartId} no longer exists.`);

  const items = await app.db
    .select({
      id: cartItems.id,
      productId: cartItems.productId,
      unitPriceEur: cartItems.unitPriceEur,
      quantity: cartItems.quantity,
      addedAt: cartItems.addedAt,
    })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));

  // Total = Σ unit_price × quantity. Decimal-safe via integer cents math.
  let totalCents = 0n;
  for (const it of items) {
    const [whole, frac = '00'] = String(it.unitPriceEur).split('.') as [string, string?];
    const cents = BigInt(whole) * 100n + BigInt((frac ?? '00').padEnd(2, '0').slice(0, 2));
    totalCents += cents * BigInt(it.quantity);
  }
  const totalEur = `${totalCents / 100n}.${String(totalCents % 100n).padStart(2, '0')}`;

  return {
    id: cart.id,
    status: cart.status,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      unitPriceEur: it.unitPriceEur,
      quantity: it.quantity,
      addedAt: it.addedAt.toISOString(),
    })),
    totalEur,
    checkoutExpiresAt: cart.checkoutExpiresAt ? cart.checkoutExpiresAt.toISOString() : null,
    createdAt: cart.createdAt.toISOString(),
  };
}

/** Find or create the ACTIVE cart for a shopper. */
async function ensureActiveCart(
  app: import('fastify').FastifyInstance,
  shopperId: string,
): Promise<string> {
  const existing = await app.db
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.shopperId, shopperId), eq(carts.status, 'ACTIVE')))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await app.db.insert(carts).values({ shopperId }).returning({ id: carts.id });
  if (!created) throw new Error('cart insert returned no row');
  return created.id;
}

export interface StorefrontCartOpts {
  env: Env;
}

const storefrontCartRoutes: FastifyPluginAsync<StorefrontCartOpts> = async (app, opts) => {
  // ════════════════════════════════════════════════════════════════════
  // GET /api/storefront/cart — my active cart
  // ════════════════════════════════════════════════════════════════════

  app.get(
    '/api/storefront/cart',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Get my active cart (created on first call).',
        response: { 200: CartView, 401: ErrorResponse, 423: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      const cartId = await ensureActiveCart(app, req.shopper.id);
      return reply.status(200).send(await buildCartView(app, cartId));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/storefront/cart/items — add product
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Body: TAddCartItemBody }>(
    '/api/storefront/cart/items',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Add a product to my active cart.',
        description:
          'No reservation is taken here — the soft-lock happens at /checkout. ' +
          'Refuses if the product is not AVAILABLE or not is_published_to_web, ' +
          'or if the product is already in the cart.',
        body: AddCartItemBody,
        response: { 200: CartView, 401: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      const cartId = await ensureActiveCart(app, req.shopper.id);

      // Snapshot the product's current list_price_eur, and gate on the SAME flag
      // the public catalog + the POS publish toggle use — `is_published_to_web`.
      // (The catalog showed `is_published_to_web` items but the cart used to gate
      // on the separate `listed_on_storefront`, which the publish flow never set
      // → every "published" product was silently un-buyable.)
      const [product] = await app.db
        .select({
          id: products.id,
          status: products.status,
          listPriceEur: products.listPriceEur,
          isPublishedToWeb: products.isPublishedToWeb,
          archivedAt: products.archivedAt,
        })
        .from(products)
        .where(eq(products.id, req.body.productId))
        .limit(1);
      if (!product) {
        throw new CartNotFoundError(`Product ${req.body.productId} does not exist.`);
      }
      if (
        product.status !== 'AVAILABLE' ||
        !product.isPublishedToWeb ||
        product.archivedAt !== null
      ) {
        throw new ProductNotReservableError(
          `Product ${req.body.productId} is not available for online purchase.`,
        );
      }

      // Cart-size ceiling (security review 2026-07-21): a cart may not grow past
      // the reservation cap, so the shopper meets an honest "cart full" here
      // instead of a surprise rejection at reserve time. Count BEFORE inserting.
      const [{ itemCount = 0 } = {}] = await app.db
        .select({ itemCount: drizzleSql<number>`count(*)::int` })
        .from(cartItems)
        .where(eq(cartItems.cartId, cartId));
      if (itemCount >= MAX_ITEMS_PER_CART) {
        throw new CartConflictError(
          `A cart may hold at most ${MAX_ITEMS_PER_CART} items.`,
        );
      }

      try {
        await app.db.insert(cartItems).values({
          cartId,
          productId: product.id,
          unitPriceEur: product.listPriceEur,
          quantity: 1,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('cart_items_one_product_per_cart')) {
          throw new CartConflictError('Product is already in your cart.');
        }
        throw err;
      }

      return reply.status(200).send(await buildCartView(app, cartId));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // DELETE /api/storefront/cart/items/:id
  // ════════════════════════════════════════════════════════════════════

  app.delete<{ Params: { id: string } }>(
    '/api/storefront/cart/items/:id',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Remove a product line from my active cart.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: CartView, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      const cartId = await ensureActiveCart(app, req.shopper.id);

      // Defensive: scope DELETE to this shopper's cart so we can't delete
      // anyone else's line by id.
      const result = await app.db.execute<{ id: string }>(drizzleSql`
      DELETE FROM cart_items
       WHERE id = ${req.params.id}
         AND cart_id = ${cartId}
       RETURNING id
    `);
      if (result.length === 0) {
        throw new CartNotFoundError('Cart item not found in your active cart.');
      }
      return reply.status(200).send(await buildCartView(app, cartId));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/storefront/cart/checkout
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Body: TCheckoutBody }>(
    '/api/storefront/cart/checkout',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Begin checkout — reserve items + create Stripe PaymentIntent.',
        description:
          'Transitions the cart ACTIVE → CHECKOUT. Reserves every item via ' +
          'inventory-lock (channel=STOREFRONT, 15-min TTL — matches checkout_expires_at). ' +
          'Creates a Stripe PaymentIntent with the configured payment-method types ' +
          '(default: card + sepa_debit + klarna + ideal + giropay).',
        body: CheckoutBody,
        response: {
          200: CheckoutResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireShopper(req);

      // Stripe must be configured before we can issue a payment intent.
      if (!opts.env.STRIPE_SECRET_KEY) {
        throw new StripeNotConfiguredError('Stripe is not configured for this environment.');
      }

      // Load active cart + items.
      const [cart] = await app.db
        .select({ id: carts.id, status: carts.status })
        .from(carts)
        .where(and(eq(carts.shopperId, req.shopper.id), eq(carts.status, 'ACTIVE')))
        .limit(1);
      if (!cart) {
        throw new CartNotFoundError('No active cart to check out.');
      }
      const items = await app.db
        .select({
          id: cartItems.id,
          productId: cartItems.productId,
          unitPriceEur: cartItems.unitPriceEur,
        })
        .from(cartItems)
        .where(eq(cartItems.cartId, cart.id));
      if (items.length === 0) {
        throw new CheckoutValidationError('Cart is empty.', { itemsCount: 0 });
      }

      // Total in EUR — integer cents.
      let totalCents = 0n;
      for (const it of items) {
        const [whole, frac = '00'] = String(it.unitPriceEur).split('.') as [string, string?];
        totalCents += BigInt(whole) * 100n + BigInt((frac ?? '00').padEnd(2, '0').slice(0, 2));
      }

      // Generate the cart's reservation_session_id — passed to inventory-lock for each item.
      const reservationSessionId = randomUUID();
      const checkoutStartedAt = new Date();
      const checkoutExpiresAt = new Date(checkoutStartedAt.getTime() + CART_CHECKOUT_TTL_MS);

      // Persist the shopper's shipping + billing addresses (latest wins) so the
      // webhook can snapshot them onto the transaction. We use withPii because
      // these columns are pgcrypto-encrypted (memory.md #64).
      {
        const ship = req.body.shippingAddress;
        const bill = req.body.billingAddress ?? ship;
        await app.withPii(async (tx) => {
          await tx.execute(drizzleSql`
          UPDATE shoppers
             SET shipping_recipient_name_encrypted = encrypt_pii(${ship.recipientName}),
                 shipping_address_line1_encrypted  = encrypt_pii(${ship.line1}),
                 shipping_address_line2_encrypted  = ${ship.line2 ? drizzleSql`encrypt_pii(${ship.line2})` : drizzleSql`NULL`},
                 shipping_postal_code_encrypted    = encrypt_pii(${ship.postalCode}),
                 shipping_city_encrypted           = encrypt_pii(${ship.city}),
                 shipping_country                  = ${ship.country},
                 billing_recipient_name_encrypted  = encrypt_pii(${bill.recipientName}),
                 billing_address_line1_encrypted   = encrypt_pii(${bill.line1}),
                 billing_address_line2_encrypted   = ${bill.line2 ? drizzleSql`encrypt_pii(${bill.line2})` : drizzleSql`NULL`},
                 billing_postal_code_encrypted     = encrypt_pii(${bill.postalCode}),
                 billing_city_encrypted            = encrypt_pii(${bill.city}),
                 billing_country                   = ${bill.country}
           WHERE id = ${req.shopper.id}
        `);
        });
      }

      // Reserve every item. If ANY fails, throw — the request rolls back implicitly
      // because nothing else has committed yet (cart status not flipped, no PI created).
      for (const item of items) {
        const reservation = await inventoryReserve(app.db, {
          productId: item.productId,
          channel: 'STOREFRONT',
          sessionId: reservationSessionId,
          userId: null,
        });
        if (reservation === null) {
          throw new ProductNotReservableError(
            `Product ${item.productId} is no longer available — checkout aborted.`,
          );
        }
      }

      // Call Stripe to create a PaymentIntent. We use the REST API directly
      // (no Stripe SDK) so the request stays a tiny dependency footprint.
      const methodTypes = req.body.paymentMethodTypes ?? DEFAULT_PAYMENT_METHOD_TYPES;
      const amountCents = Number(totalCents); // safe for ≤ 9 quadrillion cents.
      const stripeBody = new URLSearchParams();
      stripeBody.set('amount', String(amountCents));
      stripeBody.set('currency', 'eur');
      for (const [i, m] of methodTypes.entries()) {
        stripeBody.set(`payment_method_types[${i}]`, m);
      }
      stripeBody.set('metadata[cart_id]', cart.id);
      stripeBody.set('metadata[shopper_id]', req.shopper.id);
      stripeBody.set('metadata[reservation_session_id]', reservationSessionId);

      const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Stripe-Version': opts.env.STRIPE_API_VERSION,
        },
        body: stripeBody.toString(),
      });
      if (!stripeRes.ok) {
        const text = await stripeRes.text().catch(() => '');
        req.log.error(
          { status: stripeRes.status, body: text.slice(0, 1024) },
          'stripe.create_payment_intent failed',
        );
        throw new CheckoutValidationError(
          `Stripe rejected the PaymentIntent creation: ${stripeRes.status}`,
          { stripeStatus: stripeRes.status },
        );
      }
      const stripeJson = (await stripeRes.json()) as {
        id: string;
        client_secret: string;
        amount: number;
      };

      // Persist cart + payment_intent atomically. If this fails we want to NOT
      // leave a Stripe intent dangling — but we can tolerate the small leak
      // because Stripe auto-cancels intents after 24h of no confirmation.
      await app.db.transaction(async (tx) => {
        await tx
          .update(carts)
          .set({
            status: 'CHECKOUT',
            reservationSessionId,
            checkoutStartedAt,
            checkoutExpiresAt,
          })
          .where(eq(carts.id, cart.id));

        await tx.insert(paymentIntents).values({
          cartId: cart.id,
          provider: 'STRIPE',
          providerIntentId: stripeJson.id,
          status: 'PENDING',
          amountEur: `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`,
          clientSecret: stripeJson.client_secret,
        });
      });

      const [pi] = await app.db
        .select({ id: paymentIntents.id })
        .from(paymentIntents)
        .where(eq(paymentIntents.cartId, cart.id))
        .limit(1);
      if (!pi) throw new Error('payment_intent missing post-INSERT');

      return reply.status(200).send({
        cartId: cart.id,
        paymentIntentId: pi.id,
        provider: 'STRIPE',
        providerIntentId: stripeJson.id,
        amountEur: `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`,
        clientSecret: stripeJson.client_secret,
        expiresAt: checkoutExpiresAt.toISOString(),
      });
    },
  );
};

export default storefrontCartRoutes;
