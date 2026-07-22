/**
 * Storefront orders + account (read + light account edit).
 *
 *   GET   /api/storefront/orders        — the shopper's reservations/orders.
 *   GET   /api/storefront/orders/:id    — one order with its line items.
 *   GET   /api/storefront/account       — account profile (decrypted PII).
 *   PATCH /api/storefront/account       — update language / consent / name / address.
 *
 * In the reserve-and-pickup phase an "order" is a cart in status RESERVED (a
 * pickup request) or CONVERTED (completed in-shop). There is NO separate orders
 * table — a web order rides the cart + transactions model from migration 0018.
 *
 * Shapes mirror the storefront's storefront-data.ts contracts exactly
 * (OrderSummary / OrderDetail / Address / account) so flipping the storefront to
 * live data needs no backend reshape.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { release as inventoryRelease } from '@warehouse14/inventory-lock';

import { composeReservationCancelled, enqueueEmail } from '../lib/email-outbox.js';
import { localeFromAcceptLanguage } from '../lib/email-copy.js';
import { requireShopper } from '../lib/shopper.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class OrderNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class OrderConflictError extends DomainError {
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

const Address = Type.Object({
  recipientName: Type.String(),
  line1: Type.String(),
  line2: Type.Optional(Type.String()),
  postalCode: Type.String(),
  city: Type.String(),
  country: Type.String(),
});

const OrderSummary = Type.Object({
  id: Type.String(),
  /** BST-2026-000001, the same reference the confirmation letter carried. */
  orderNumber: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  totalEur: Type.String(),
  status: Type.String(),
  shippingStatus: Type.String(),
  itemCount: Type.Integer(),
});

const OrderDetail = Type.Intersect([
  OrderSummary,
  Type.Object({
    items: Type.Array(
      Type.Object({
        productId: Type.String(),
        name: Type.String(),
        unitPriceEur: Type.String(),
        quantity: Type.Integer(),
      }),
    ),
    shippingAddress: Type.Union([Address, Type.Null()]),
  }),
]);

const AccountResponse = Type.Union([
  Type.Object({
    fullName: Type.String(),
    emailMasked: Type.String(),
    preferredLanguage: Type.String(),
    marketingConsent: Type.Boolean(),
    address: Type.Union([Address, Type.Null()]),
  }),
  Type.Null(),
]);

const UpdateAccountBody = Type.Object({
  fullName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  preferredLanguage: Type.Optional(
    Type.Union([Type.Literal('de'), Type.Literal('en'), Type.Literal('ar')]),
  ),
  marketingConsent: Type.Optional(Type.Boolean()),
  address: Type.Optional(Address),
  /** Empty string clears the phone. Mirrored onto the customers row. */
  phone: Type.Optional(Type.String({ maxLength: 40 })),
});
type TUpdateAccountBody = (typeof UpdateAccountBody)['static'];

/** Map a cart status to the storefront-facing shipping status. */
function shippingStatusOf(status: string): string {
  if (status === 'CONVERTED') return 'COMPLETED';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'PICKUP';
}

/** Mask an email like b****l@gmail.com for display. */
function maskEmail(email: string | null): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0] ?? ''}*${domain}`;
  return `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local[local.length - 1]}${domain}`;
}

function buildAddress(r: {
  ship_name: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_postal: string | null;
  ship_city: string | null;
  shipping_country: string | null;
}): typeof Address.static | null {
  if (!r.ship_line1 || !r.ship_postal || !r.ship_city) return null;
  return {
    recipientName: r.ship_name ?? '',
    line1: r.ship_line1,
    ...(r.ship_line2 ? { line2: r.ship_line2 } : {}),
    postalCode: r.ship_postal,
    city: r.ship_city,
    country: r.shipping_country ?? 'DE',
  };
}

const storefrontOrdersRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/storefront/orders ───────────────────────────────────────
  app.get(
    '/api/storefront/orders',
    {
      schema: {
        tags: ['storefront'],
        summary: "The shopper's orders (reservations + completed).",
        response: { 200: Type.Array(OrderSummary), 401: ErrorResponse },
      },
    },
    async (req) => {
      requireShopper(req);
      const rows = await app.db.execute<{
        id: string;
        order_number: string | null;
        created_at: string;
        status: string;
        item_count: number;
        total_eur: string;
      }>(drizzleSql`
        SELECT c.id,
               c.order_number,
               to_char(COALESCE(c.reserved_at, c.created_at) AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
               c.status::text                            AS status,
               COUNT(ci.id)::int                          AS item_count,
               COALESCE(SUM(ci.unit_price_eur * ci.quantity), 0)::text AS total_eur
          FROM carts c
          LEFT JOIN cart_items ci ON ci.cart_id = c.id
         WHERE c.shopper_id = ${req.shopper.id}
           AND c.status IN ('RESERVED', 'CONVERTED', 'CANCELLED')
         GROUP BY c.id, c.order_number, c.reserved_at, c.created_at, c.status
         ORDER BY COALESCE(c.reserved_at, c.created_at) DESC
         LIMIT 100`);
      return rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        createdAt: r.created_at,
        totalEur: r.total_eur,
        status: r.status,
        shippingStatus: shippingStatusOf(r.status),
        itemCount: r.item_count,
      }));
    },
  );

  // ── GET /api/storefront/orders/:id ───────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/storefront/orders/:id',
    {
      schema: {
        tags: ['storefront'],
        summary: 'One order with its line items.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: OrderDetail, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      requireShopper(req);
      const id = req.params.id;

      const head = await app.db.execute<{
        id: string;
        order_number: string | null;
        created_at: string;
        status: string;
      }>(drizzleSql`
        SELECT c.id,
               c.order_number,
               to_char(COALESCE(c.reserved_at, c.created_at) AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
               c.status::text AS status
          FROM carts c
         WHERE c.id = ${id} AND c.shopper_id = ${req.shopper.id}
           AND c.status IN ('RESERVED', 'CONVERTED', 'CANCELLED')
         LIMIT 1`);
      const cart = head[0];
      if (!cart) throw new OrderNotFoundError('Order not found.');

      const lines = await app.db.execute<{
        product_id: string;
        name: string;
        unit_price_eur: string;
        quantity: number;
      }>(drizzleSql`
        SELECT ci.product_id AS product_id, p.name AS name, ci.unit_price_eur::text AS unit_price_eur, ci.quantity AS quantity
          FROM cart_items ci
          JOIN products p ON p.id = ci.product_id
         WHERE ci.cart_id = ${id}
         ORDER BY ci.added_at ASC`);

      // Decrypt the shopper's shipping address (PII) for the order detail.
      const addrRows = await app.withPii(async (tx) =>
        tx.execute<{
          ship_name: string | null;
          ship_line1: string | null;
          ship_line2: string | null;
          ship_postal: string | null;
          ship_city: string | null;
          shipping_country: string | null;
        }>(drizzleSql`
          SELECT decrypt_pii(shipping_recipient_name_encrypted) AS ship_name,
                 decrypt_pii(shipping_address_line1_encrypted)  AS ship_line1,
                 decrypt_pii(shipping_address_line2_encrypted)  AS ship_line2,
                 decrypt_pii(shipping_postal_code_encrypted)    AS ship_postal,
                 decrypt_pii(shipping_city_encrypted)           AS ship_city,
                 shipping_country
            FROM shoppers WHERE id = ${req.shopper.id} LIMIT 1`),
      );

      let totalCents = 0n;
      for (const l of lines) {
        const [whole, frac = '00'] = String(l.unit_price_eur).split('.') as [string, string?];
        totalCents +=
          (BigInt(whole) * 100n + BigInt((frac ?? '00').padEnd(2, '0').slice(0, 2))) *
          BigInt(l.quantity);
      }
      const totalEur = `${totalCents / 100n}.${String(totalCents % 100n).padStart(2, '0')}`;

      return {
        id: cart.id,
        orderNumber: cart.order_number,
        createdAt: cart.created_at,
        totalEur,
        status: cart.status,
        shippingStatus: shippingStatusOf(cart.status),
        itemCount: lines.length,
        items: lines.map((l) => ({
          productId: l.product_id,
          name: l.name,
          unitPriceEur: l.unit_price_eur,
          quantity: l.quantity,
        })),
        shippingAddress: addrRows[0] ? buildAddress(addrRows[0]) : null,
      };
    },
  );

  // ── GET /api/storefront/account ──────────────────────────────────────
  app.get(
    '/api/storefront/account',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Account profile (decrypted PII).',
        response: { 200: AccountResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      requireShopper(req);
      const rows = await app.withPii(async (tx) =>
        tx.execute<{
          full_name: string | null;
          email: string | null;
          preferred_language: string;
          marketing_consent: boolean;
          ship_name: string | null;
          ship_line1: string | null;
          ship_line2: string | null;
          ship_postal: string | null;
          ship_city: string | null;
          shipping_country: string | null;
        }>(drizzleSql`
          SELECT decrypt_pii(c.full_name_encrypted) AS full_name,
                 decrypt_pii(s.email_encrypted)      AS email,
                 s.preferred_language,
                 s.marketing_consent,
                 decrypt_pii(s.shipping_recipient_name_encrypted) AS ship_name,
                 decrypt_pii(s.shipping_address_line1_encrypted)  AS ship_line1,
                 decrypt_pii(s.shipping_address_line2_encrypted)  AS ship_line2,
                 decrypt_pii(s.shipping_postal_code_encrypted)    AS ship_postal,
                 decrypt_pii(s.shipping_city_encrypted)           AS ship_city,
                 s.shipping_country
            FROM shoppers s
            JOIN customers c ON c.id = s.customer_id
           WHERE s.id = ${req.shopper.id} LIMIT 1`),
      );
      const r = rows[0];
      if (!r) return null;
      return {
        fullName: r.full_name ?? '',
        emailMasked: maskEmail(r.email),
        preferredLanguage: r.preferred_language ?? 'de',
        marketingConsent: !!r.marketing_consent,
        address: buildAddress(r),
      };
    },
  );

  // ── PATCH /api/storefront/account ────────────────────────────────────
  app.patch<{ Body: TUpdateAccountBody }>(
    '/api/storefront/account',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Update language / marketing consent / name / shipping address.',
        body: UpdateAccountBody,
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      const b = req.body;
      await app.withPii(async (tx) => {
        if (b.preferredLanguage !== undefined || b.marketingConsent !== undefined) {
          await tx.execute(drizzleSql`
            UPDATE shoppers SET
              preferred_language   = COALESCE(${b.preferredLanguage ?? null}, preferred_language),
              marketing_consent    = COALESCE(${b.marketingConsent ?? null}, marketing_consent),
              marketing_consent_at = CASE WHEN ${b.marketingConsent ?? null} = TRUE THEN now()
                                          ELSE marketing_consent_at END,
              updated_at           = now()
            WHERE id = ${req.shopper.id}`);
        }
        if (b.fullName !== undefined) {
          await tx.execute(drizzleSql`
            UPDATE customers SET full_name_encrypted = encrypt_pii(${b.fullName})
             WHERE id = (SELECT customer_id FROM shoppers WHERE id = ${req.shopper.id})`);
        }
        if (b.address) {
          const a = b.address;
          await tx.execute(drizzleSql`
            UPDATE shoppers SET
              shipping_recipient_name_encrypted = encrypt_pii(${a.recipientName}),
              shipping_address_line1_encrypted  = encrypt_pii(${a.line1}),
              shipping_address_line2_encrypted  = ${a.line2 ? drizzleSql`encrypt_pii(${a.line2})` : drizzleSql`NULL`},
              shipping_postal_code_encrypted    = encrypt_pii(${a.postalCode}),
              shipping_city_encrypted           = encrypt_pii(${a.city}),
              shipping_country                  = ${a.country},
              updated_at                        = now()
            WHERE id = ${req.shopper.id}`);
          // Mirror onto the customers row — the record staff actually read
          // at the POS and in the owner apps. One human, one address.
          const line2Part = a.line2 ? `, ${a.line2}` : '';
          const addressText = `${a.recipientName}, ${a.line1}${line2Part}, ${a.postalCode} ${a.city}, ${a.country}`;
          await tx.execute(drizzleSql`
            UPDATE customers SET address_encrypted = encrypt_pii(${addressText}), updated_at = now()
             WHERE id = ${req.shopper.customerId}`);
        }
        if (b.phone !== undefined) {
          await tx.execute(drizzleSql`
            UPDATE shoppers SET
              phone_encrypted   = ${b.phone ? drizzleSql`encrypt_pii(${b.phone})` : drizzleSql`NULL`},
              phone_blind_index = ${b.phone ? drizzleSql`blind_index(${b.phone})` : drizzleSql`NULL`},
              updated_at        = now()
            WHERE id = ${req.shopper.id}`);
          await tx.execute(drizzleSql`
            UPDATE customers SET
              phone_encrypted   = ${b.phone ? drizzleSql`encrypt_pii(${b.phone})` : drizzleSql`NULL`},
              phone_blind_index = ${b.phone ? drizzleSql`blind_index(${b.phone})` : drizzleSql`NULL`},
              updated_at        = now()
             WHERE id = ${req.shopper.customerId}`);
        }
      });
      return reply.status(200).send({ ok: true });
    },
  );

  // ── POST /api/storefront/orders/:id/cancel ───────────────────────────
  // Customer-initiated cancellation of a RESERVED pickup order. Releases
  // every inventory hold IMMEDIATELY (the pieces go straight back on sale),
  // flips the cart to CANCELLED (0087) — the 0088 trigger emits
  // web_order.cancelled so staff see it live — and queues the cancellation
  // email. Only the owning shopper, only from RESERVED.
  app.post<{ Params: { id: string } }>(
    '/api/storefront/orders/:id/cancel',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Cancel my reserved pickup order (releases the pieces).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: Type.Object({ ok: Type.Boolean(), status: Type.Literal('CANCELLED') }),
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireShopper(req);

      const rows = await app.db.execute<{
        id: string;
        status: string;
        reservation_session_id: string | null;
        order_number: string | null;
      }>(drizzleSql`
        SELECT id, status::text AS status, reservation_session_id, order_number
          FROM carts
         WHERE id = ${req.params.id} AND shopper_id = ${req.shopper.id}
         LIMIT 1
      `);
      const cart = rows[0];
      if (!cart) throw new OrderNotFoundError('Order not found.');
      if (cart.status !== 'RESERVED') {
        throw new OrderConflictError('Only a reserved order can be cancelled.');
      }

      // Release every hold. Best-effort per item — a hold the sweeper already
      // freed must not block the cancellation of the rest.
      const items = await app.db.execute<{ product_id: string }>(drizzleSql`
        SELECT product_id FROM cart_items WHERE cart_id = ${cart.id}
      `);
      if (cart.reservation_session_id) {
        for (const it of items) {
          await inventoryRelease(app.db, {
            productId: it.product_id,
            sessionId: cart.reservation_session_id,
            userId: null,
            reason: 'storefront_cancelled_by_customer',
          }).catch(() => {
            /* hold already released (3-day sweeper) — cancellation proceeds */
          });
        }
      }

      // Flip to CANCELLED — the 0088 trigger emits the live staff event.
      await app.db.execute(drizzleSql`
        UPDATE carts SET status = 'CANCELLED', updated_at = now() WHERE id = ${cart.id}
      `);

      // Cancellation email — best-effort, never blocks the cancellation.
      try {
        await app.withPii(async (tx) => {
          const who = await tx.execute<{
            email: string | null;
            full_name: string | null;
            preferred_language: string | null;
            is_guest: boolean;
            customer_id: string;
          }>(drizzleSql`
            SELECT CASE WHEN s.is_guest THEN decrypt_pii(c.email_encrypted)
                        ELSE decrypt_pii(s.email_encrypted) END AS email,
                   decrypt_pii(c.full_name_encrypted) AS full_name,
                   s.preferred_language,
                   s.is_guest,
                   c.id AS customer_id
              FROM shoppers s JOIN customers c ON c.id = s.customer_id
             WHERE s.id = ${req.shopper.id}
          `);
          const locale =
            who[0] && !who[0].is_guest
              ? who[0].preferred_language
              : localeFromAcceptLanguage(req.headers['accept-language']);
          const email = who[0]?.email;
          if (email && !email.endsWith('@gast.invalid')) {
            await enqueueEmail(
              tx,
              email,
              // The customer knows this reservation as BST-2026-000009, so the
              // cancellation must name the same thing the confirmation did.
              composeReservationCancelled(
                who[0]?.full_name ?? null,
                cart.order_number ?? cart.id,
                locale,
              ),
              who[0]?.customer_id ?? null,
            );
          }
        });
      } catch (err) {
        req.log.warn({ err }, 'cancel email enqueue failed (non-blocking)');
      }

      return reply.status(200).send({ ok: true, status: 'CANCELLED' as const });
    },
  );
};

export default storefrontOrdersRoutes;
