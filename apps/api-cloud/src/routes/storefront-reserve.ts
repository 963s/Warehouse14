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
import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { cartItems, carts } from '@warehouse14/db/schema';
import {
  release as inventoryRelease,
  reserve as inventoryReserve,
} from '@warehouse14/inventory-lock';

import { composeReservationConfirmed, enqueueEmail } from '../lib/email-outbox.js';
import { localeFromAcceptLanguage } from '../lib/email-copy.js';
import { requireShopper } from '../lib/shopper.js';
import {
  MAX_ITEMS_PER_RESERVATION,
  deriveReservationAllowance,
  valueCeilingApplies,
} from '../lib/storefront-reservation-policy.js';
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
/**
 * A reservation cap was hit (security review 2026-07-21). 409 with a machine
 * `details.limit` so the storefront can render the exact honest German line
 * ("hold a smaller number of pieces" vs "you already hold the maximum").
 */
class ReservationLimitError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
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
  /**
   * BST-2026-000001. The confirmation screen is the FIRST place the customer
   * meets this number, before the letter reaches them, so it has to come back
   * from the reserve call itself and not only from a later read.
   */
  orderNumber: Type.Union([Type.String(), Type.Null()]),
  status: Type.Literal('RESERVED'),
  reservedAt: Type.String({ format: 'date-time' }),
  itemCount: Type.Integer(),
});

/**
 * Pickup contact. REQUIRED for guest shoppers (their customer row is the
 * synthetic "Gast" — without this, staff would see an anonymous reservation
 * and could not hold or hand over the goods). Optional for registered
 * shoppers, whose account identity already covers it; when a registered
 * shopper sends it anyway we still refresh their customer contact.
 */
const ReserveBody = Type.Object({
  contact: Type.Optional(
    Type.Object({
      fullName: Type.String({ minLength: 2, maxLength: 200 }),
      email: Type.Optional(Type.String({ format: 'email', maxLength: 320 })),
      phone: Type.Optional(Type.String({ minLength: 5, maxLength: 40 })),
    }),
  ),
});
type TReserveBody = { contact?: { fullName: string; email?: string; phone?: string } };

const storefrontReserveRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TReserveBody }>(
    '/api/storefront/cart/reserve',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Reserve the active cart for in-shop pickup (no payment).',
        description:
          'Holds every item (inventory-lock channel=WEB_RESERVATION, 3-day TTL) and ' +
          'flips the cart ACTIVE → RESERVED. Emits a web_order.reserved ledger event so ' +
          'staff see it live. No payment and no fiscal transaction — the sale is completed ' +
          'in the shop via the POS. Guests MUST send the pickup contact; it is written ' +
          'onto their customers row so staff see a real name.',
        body: ReserveBody,
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

      // Guests reserve with a REAL pickup contact or not at all.
      const contact = req.body?.contact;
      if (req.shopper.isGuest && !contact) {
        throw new ReserveValidationError(
          'Guest reservations require a pickup contact (fullName, email or phone).',
          { missing: 'contact' },
        );
      }
      if (req.shopper.isGuest && contact && !contact.email && !contact.phone) {
        throw new ReserveValidationError(
          'Guest reservations need at least one way to reach you (email or phone).',
          { missing: 'contact.email|contact.phone' },
        );
      }

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

      // ── Abuse ceilings (security review 2026-07-21) ────────────────────────
      // Rule 1: one reservation may hold at most MAX_ITEMS_PER_RESERVATION
      // distinct pieces. A pickup of more is hoarding, not a customer.
      if (items.length > MAX_ITEMS_PER_RESERVATION) {
        throw new ReservationLimitError(
          `A reservation may hold at most ${MAX_ITEMS_PER_RESERVATION} items.`,
          { limit: 'perReservation', max: MAX_ITEMS_PER_RESERVATION, requested: items.length },
        );
      }
      // Rule 2: the EARNED allowance. What this shopper may hold at once is
      // computed from what they have actually done — collected pickups raise
      // it, failures to collect lower it — rather than from one flat number
      // that treats a ninety-second-old account like a regular.
      //
      // Every fact comes from `carts`; the reservation sweeper already flips
      // an expired hold to ABANDONED, so "reserved and never collected" is
      // recorded without any new table.
      const [facts] = await app.db.execute<{
        collected: number;
        no_shows: number;
        last_no_show_at: string | null;
        trust_level: string | null;
        email_verified: boolean;
        held_count: number;
        held_value: string | null;
      }>(drizzleSql`
        SELECT
          (SELECT COUNT(*)::int FROM carts c
            WHERE c.shopper_id = ${req.shopper.id} AND c.status = 'CONVERTED') AS collected,
          (SELECT COUNT(*)::int FROM carts c
            WHERE c.shopper_id = ${req.shopper.id}
              AND c.status = 'ABANDONED' AND c.reserved_at IS NOT NULL) AS no_shows,
          (SELECT MAX(c.updated_at) FROM carts c
            WHERE c.shopper_id = ${req.shopper.id}
              AND c.status = 'ABANDONED' AND c.reserved_at IS NOT NULL) AS last_no_show_at,
          cu.trust_level::text AS trust_level,
          (s.email_verified_at IS NOT NULL) AS email_verified,
          -- What is live right now, in count AND in money.
          (SELECT COUNT(*)::int FROM products p
             JOIN carts c ON c.reservation_session_id = p.reserved_by_session_id
            WHERE c.shopper_id = ${req.shopper.id}
              AND p.status = 'RESERVED'
              AND p.reserved_by_channel = 'WEB_RESERVATION'
              AND (p.reservation_expires_at IS NULL OR p.reservation_expires_at > now())
          ) AS held_count,
          (SELECT COALESCE(SUM(p.price_eur), 0)::text FROM products p
             JOIN carts c ON c.reservation_session_id = p.reserved_by_session_id
            WHERE c.shopper_id = ${req.shopper.id}
              AND p.status = 'RESERVED'
              AND p.reserved_by_channel = 'WEB_RESERVATION'
              AND (p.reservation_expires_at IS NULL OR p.reservation_expires_at > now())
          ) AS held_value
        FROM shoppers s
        JOIN customers cu ON cu.id = s.customer_id
       WHERE s.id = ${req.shopper.id}
      `);

      const allowance = deriveReservationAllowance(
        {
          collected: facts?.collected ?? 0,
          noShows: facts?.no_shows ?? 0,
          lastNoShowAt: facts?.last_no_show_at ? new Date(facts.last_no_show_at) : null,
          trustLevel: facts?.trust_level ?? null,
          emailVerified: Boolean(facts?.email_verified),
          isGuest: req.shopper.isGuest,
        },
        new Date(),
      );

      if (allowance.blockedReason) {
        throw new ReservationLimitError('Reservations are not available on this account.', {
          limit: 'blocked',
          reason: allowance.blockedReason,
          ...(allowance.cooldownUntil ? { until: allowance.cooldownUntil.toISOString() } : {}),
        });
      }

      const heldCount = facts?.held_count ?? 0;
      if (heldCount + items.length > allowance.maxItems) {
        throw new ReservationLimitError(
          `You may hold at most ${allowance.maxItems} reserved items at once.`,
          {
            limit: 'perShopper',
            tier: allowance.tier,
            max: allowance.maxItems,
            alreadyHeld: heldCount,
            requested: items.length,
          },
        );
      }

      // The value ceiling, which is what actually protects the window: three
      // pieces at forty Euro is a browsing customer, three at four thousand is
      // a fifth of the stock locked for three days.
      const heldValue = Number(facts?.held_value ?? 0);
      const [{ incoming = '0' } = {}] = await app.db.execute<{ incoming: string }>(drizzleSql`
        SELECT COALESCE(SUM(price_eur), 0)::text AS incoming
          FROM products WHERE id = ANY(${items.map((i) => i.productId)}::uuid[])
      `);
      const totalValue = heldValue + Number(incoming);
      if (
        valueCeilingApplies(heldCount + items.length) &&
        totalValue > allowance.maxValueEur
      ) {
        throw new ReservationLimitError(
          `You may hold at most ${allowance.maxValueEur} Euro of reserved stock at once.`,
          {
            limit: 'perShopperValue',
            tier: allowance.tier,
            maxValueEur: allowance.maxValueEur,
            currentValueEur: Math.round(totalValue),
          },
        );
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

      // Write the pickup contact onto the linked customers row BEFORE flipping
      // the cart, so the staff ledger event already points at a real name.
      // For guests this replaces the synthetic "Gast"; for registered shoppers
      // it refreshes their contact. customers.email has no uniqueness
      // constraint, so this can never collide with an existing account.
      if (contact) {
        await app.withPii(async (tx) => {
          await tx.execute(drizzleSql`
          UPDATE customers
             SET full_name_encrypted = encrypt_pii(${contact.fullName}),
                 email_encrypted     = ${contact.email ? drizzleSql`encrypt_pii(${contact.email})` : drizzleSql`email_encrypted`},
                 phone_encrypted     = ${contact.phone ? drizzleSql`encrypt_pii(${contact.phone})` : drizzleSql`phone_encrypted`},
                 updated_at          = now()
           WHERE id = ${req.shopper.customerId}
        `);
        });
      }

      // Flip the cart to RESERVED — the 0068 trigger emits the live staff event.
      // The 0097 trigger mints the order number in the same statement, so it
      // has to be read back rather than computed: BST-2026-000009 exists only
      // after this UPDATE, and the letter below is the first thing that shows
      // it to the customer.
      const reservedAt = new Date();
      const [reservedCart] = await app.db
        .update(carts)
        .set({ status: 'RESERVED', reservedAt, reservationSessionId })
        .where(eq(carts.id, cart.id))
        .returning({ orderNumber: carts.orderNumber });

      // Confirmation letter with the reservation number — best-effort, never
      // blocks the reservation. Recipient: the pickup contact's email when
      // given, else the account email (guests without an email get none —
      // they left a phone instead).
      try {
        const totals = await app.db.execute<{ total: string | null }>(drizzleSql`
          SELECT to_char(SUM(unit_price_eur), 'FM999999990.00') AS total
            FROM cart_items WHERE cart_id = ${cart.id}
        `);
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
          // A registered shopper CHOSE their language, so the stored value
          // wins. A guest never chose one, so the request header is the only
          // honest signal about what they can read.
          const locale =
            who[0] && !who[0].is_guest
              ? who[0].preferred_language
              : localeFromAcceptLanguage(req.headers['accept-language']);
          const email = contact?.email ?? who[0]?.email ?? null;
          if (email && !email.endsWith('@gast.invalid')) {
            await enqueueEmail(
              tx,
              email,
              composeReservationConfirmed(
                contact?.fullName ?? who[0]?.full_name ?? null,
                // Falling back to the raw id would put a UUID in front of the
                // customer again, which is the whole thing 0097 removed. The
                // trigger cannot fail to fire here, so this is belt only.
                reservedCart?.orderNumber ?? cart.id,
                items.length,
                totals[0]?.total ?? null,
                locale,
              ),
              who[0]?.customer_id ?? null,
            );
          }
        });
      } catch (err) {
        req.log.warn({ err }, 'reservation email enqueue failed (non-blocking)');
      }

      return reply.status(200).send({
        cartId: cart.id,
        orderNumber: reservedCart?.orderNumber ?? null,
        status: 'RESERVED' as const,
        reservedAt: reservedAt.toISOString(),
        itemCount: items.length,
      });
    },
  );
};

export default storefrontReserveRoutes;
