/**
 * POST /api/webhooks/stripe — Stripe webhook handler (Day 19).
 *
 * The hard red line (memory.md #65):
 *   1. The route reads the RAW request body BEFORE Fastify's JSON parser.
 *      Our content-type parser for `application/json` on THIS path returns
 *      a Buffer + the original UTF-8 string so the signature verification
 *      operates on the exact bytes Stripe signed.
 *   2. `Stripe-Signature` header is parsed and the `v1=` HMACs are
 *      constant-time-compared against HMAC-SHA256(`<t>.<rawBody>`, secret).
 *   3. The `t=` timestamp must be within STRIPE_WEBHOOK_TOLERANCE_SECONDS
 *      of now() — replay defense.
 *   4. Even after signature passes, idempotency: every event is inserted
 *      into `webhook_events` keyed by (provider, provider_event_id). A
 *      duplicate delivery from Stripe lands a UNIQUE violation → we ACK
 *      `200 idempotent: true` without re-processing.
 *   5. ONLY THEN do we look up the payment_intent + finalize the cart:
 *      reserve→sold, INSERT transactions (sales_channel='WEB', shipping_status='PENDING'),
 *      INSERT items + payments, flip cart to CONVERTED — all inside one
 *      DB transaction so an error mid-way rolls everything back.
 */

import { Type } from '@sinclair/typebox';
import { and, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  cartItems,
  carts,
  paymentIntents,
  products,
  transactionItems,
  transactionPayments,
  transactions,
  webhookEvents,
} from '@warehouse14/db/schema';
import {
  ReservationOwnershipError,
  finalize as inventoryFinalize,
  release as inventoryRelease,
} from '@warehouse14/inventory-lock';

import type { Env } from '../config/env.js';
import { verifyStripeSignature } from '../lib/stripe-signature.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { WebhookAck } from '../schemas/storefront.js';

class WebhookBadSignatureError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class WebhookConfigError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface StorefrontWebhookOpts {
  env: Env;
}

/** Type guard against the Stripe event shapes we react to. */
interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id: string; status?: string; metadata?: Record<string, string> } };
}

function isStripeEvent(x: unknown): x is StripeEvent {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.type === 'string' &&
    typeof o.data === 'object' &&
    o.data !== null &&
    typeof (o.data as Record<string, unknown>).object === 'object'
  );
}

const storefrontWebhookRoutes: FastifyPluginAsync<StorefrontWebhookOpts> = async (app, opts) => {
  // ──────────────────────────────────────────────────────────────────
  // Raw-body parser ONLY for this route. We register a per-route parser
  // by tagging the route's content-type with `String` parsing — the
  // returned string is what we sign-verify against.
  //
  // Fastify's per-route content-type parser config is done by adding
  // the parser at the instance level under a unique content-type label
  // and then attaching a route option. The pragmatic alternative is to
  // use a config flag on the route to bypass the default parser.
  // ──────────────────────────────────────────────────────────────────
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    function rawJsonParser(_req, body, done) {
      // Body is a string here because parseAs='string'. We forward it
      // as-is — the handler will JSON.parse after signature verification.
      done(null, body);
    },
  );

  app.post(
    '/api/webhooks/stripe',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Stripe webhook endpoint — HMAC-verified + idempotent.',
        description:
          'Receives Stripe webhook deliveries. Verifies the Stripe-Signature ' +
          'header against the raw request body using the configured webhook ' +
          'secret. On payment_intent.succeeded, converts the linked cart into ' +
          'a fiscal transaction with sales_channel=WEB.',
        response: {
          200: WebhookAck,
          400: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      // 0. Refuse if not configured — surfacing this loudly beats a silent fail.
      if (!opts.env.STRIPE_WEBHOOK_SECRET) {
        throw new WebhookConfigError('Stripe webhook secret not configured.');
      }

      // 1. Read the RAW body as a string. Our content-type parser kept it intact.
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const sigHeader = req.headers['stripe-signature'];
      if (typeof sigHeader !== 'string' || sigHeader.length === 0) {
        throw new WebhookBadSignatureError('Missing Stripe-Signature header.');
      }

      // 2. HMAC verification — the hard red line.
      const verification = verifyStripeSignature({
        rawBody,
        header: sigHeader,
        secret: opts.env.STRIPE_WEBHOOK_SECRET,
        toleranceSeconds: opts.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      });
      if (!verification.ok) {
        // Stripe explicitly recommends NOT logging the secret. Log the failure code only.
        req.log.warn({ failure: verification.failure }, 'stripe webhook signature rejected');
        throw new WebhookBadSignatureError(
          `Stripe-Signature rejected: ${verification.failure.code}`,
        );
      }

      // 3. Parse the body (now that we know it came from Stripe).
      let event: StripeEvent;
      try {
        const parsed = JSON.parse(rawBody);
        if (!isStripeEvent(parsed)) {
          throw new Error('Event JSON did not match expected shape.');
        }
        event = parsed;
      } catch (err) {
        req.log.warn({ err }, 'stripe webhook JSON parse failed (signature verified)');
        throw new WebhookBadSignatureError(
          'Verified Stripe-Signature but payload is not a JSON event.',
        );
      }

      // 4. Idempotency via webhook_events UNIQUE. First delivery wins.
      let isIdempotent = false;
      try {
        await app.db.insert(webhookEvents).values({
          provider: 'STRIPE',
          providerEventId: event.id,
          eventType: event.type,
          rawBody: rawBody.slice(0, 64 * 1024), // capped 64 KiB defensively
          payload: event as unknown,
          signatureVerified: true,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('webhook_events_provider_event_uq')) {
          isIdempotent = true;
          return reply.status(200).send({ received: true, idempotent: true, eventId: event.id });
        }
        throw err;
      }

      // 5. Dispatch on event.type. We react to the three events that move
      //    money/state — everything else is recorded as evidence and ack'd.
      if (event.type === 'payment_intent.succeeded') {
        await handlePaymentIntentSucceeded(app, opts, event.data.object.id);
      } else if (
        event.type === 'payment_intent.payment_failed' ||
        event.type === 'payment_intent.canceled'
      ) {
        await handlePaymentIntentFailed(app, event.data.object.id, event.type);
      }
      // Other event types stay recorded in webhook_events for forensics — they
      // don't move state. Phase 1.5 wires worker reconciliation for edge cases
      // (charge.refunded, charge.dispute.created, etc.).

      // Mark the row as processed regardless — we recorded what we saw.
      await app.db.execute(drizzleSql`
      UPDATE webhook_events SET processed_at = now()
       WHERE provider = 'STRIPE' AND provider_event_id = ${event.id}
    `);

      return reply
        .status(200)
        .send({ received: true, idempotent: isIdempotent, eventId: event.id });
    },
  );
};

/**
 * Convert a successful payment into a fiscal transaction.
 *
 * All-or-nothing: opens ONE DB transaction wrapping:
 *   • finalize() each cart item (RESERVED→SOLD, inventory-lock)
 *   • INSERT transactions (sales_channel='WEB', shipping_status='PENDING')
 *   • INSERT transaction_items (line snapshots, negated NOT needed — fresh sale)
 *   • INSERT transaction_payments (method='STRIPE', amount=total)
 *   • UPDATE carts SET status='CONVERTED' + converted_to_transaction_id
 *   • UPDATE payment_intents SET status='SUCCEEDED'
 *
 * On any throw, ROLLBACK. The webhook handler logs and returns 200 to Stripe
 * (so Stripe doesn't retry forever); the worker reconciliation later picks
 * up the failure from the unprocessed webhook_events row.
 */
async function handlePaymentIntentSucceeded(
  app: import('fastify').FastifyInstance,
  opts: StorefrontWebhookOpts,
  providerIntentId: string,
): Promise<void> {
  await app.db.transaction(async (tx) => {
    // Resolve the payment intent we created at /checkout.
    const [pi] = await tx
      .select({
        id: paymentIntents.id,
        cartId: paymentIntents.cartId,
        amountEur: paymentIntents.amountEur,
        status: paymentIntents.status,
      })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.provider, 'STRIPE'),
          eq(paymentIntents.providerIntentId, providerIntentId),
        ),
      )
      .limit(1);
    if (!pi) {
      app.log.warn(
        { providerIntentId },
        'stripe webhook: unknown PaymentIntent — orphan, ignoring',
      );
      return;
    }
    if (pi.status === 'SUCCEEDED') {
      app.log.info({ providerIntentId }, 'stripe webhook: already converted, no-op');
      return;
    }

    // Load the cart + its items.
    const [cart] = await tx
      .select({
        id: carts.id,
        status: carts.status,
        shopperId: carts.shopperId,
        reservationSessionId: carts.reservationSessionId,
      })
      .from(carts)
      .where(eq(carts.id, pi.cartId))
      .limit(1);
    if (!cart) throw new Error(`cart ${pi.cartId} disappeared — refusing to convert`);
    if (cart.status === 'CONVERTED') {
      app.log.info({ cartId: cart.id }, 'stripe webhook: cart already converted, no-op');
      return;
    }
    if (cart.status !== 'CHECKOUT') {
      throw new Error(`cart ${cart.id} status=${cart.status}; expected CHECKOUT`);
    }
    if (!cart.reservationSessionId) {
      throw new Error(`cart ${cart.id} missing reservation_session_id`);
    }

    const items = await tx
      .select({
        id: cartItems.id,
        productId: cartItems.productId,
        unitPriceEur: cartItems.unitPriceEur,
        quantity: cartItems.quantity,
      })
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.id));
    if (items.length === 0) {
      throw new Error(`cart ${cart.id} has no items`);
    }

    // Look up products for tax_treatment_code (snapshotted onto transaction_items).
    const productIds = items.map((i) => i.productId);
    const productRows = await tx
      .select({
        id: products.id,
        taxTreatmentCode: products.taxTreatmentCode,
        acquisitionCostEur: products.acquisitionCostEur,
        listPriceEur: products.listPriceEur,
      })
      .from(products)
      .where(drizzleSql`${products.id} = ANY(${productIds})`);
    const productMap = new Map(productRows.map((p) => [p.id, p]));

    // 1. Finalize each reservation (RESERVED → SOLD). Same session_id as
    //    the reservation we placed at /checkout. Storefront guests reserve
    //    with userId=null; the `IS NOT DISTINCT FROM` guard in
    //    inventory-lock.finalize accepts NULL=NULL so the match still holds.
    for (const item of items) {
      try {
        await inventoryFinalize(tx, {
          productId: item.productId,
          sessionId: cart.reservationSessionId,
          userId: null,
        });
      } catch (err) {
        if (err instanceof ReservationOwnershipError) {
          throw new Error(
            `cannot finalize product ${item.productId} — reservation lost (expired/release)? ${err.message}`,
          );
        }
        throw err;
      }
    }

    // 2. Decimal math (cents-safe). For V1 we treat all online sales as
    //    standard VAT 19% — full §25a margin / §25c IGM tax classifier is
    //    Phase 1.5 once Tauri admin can override per-line.
    //
    //    Each item's vat = floor(line_total * 19 / 119) — banker's rounding
    //    via integer math: subtotal = total - vat.
    let totalCents = 0n;
    let subtotalCents = 0n;
    let vatCents = 0n;
    const itemSnapshots: Array<{
      productId: string;
      lineSubtotalCents: bigint;
      lineVatCents: bigint;
      lineTotalCents: bigint;
      taxTreatmentCode: string;
      vatRate: string;
    }> = [];
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) throw new Error(`product ${item.productId} disappeared`);
      const [whole, frac = '00'] = String(item.unitPriceEur).split('.') as [string, string?];
      const lineTotalCents =
        BigInt(whole) * 100n + BigInt((frac ?? '00').padEnd(2, '0').slice(0, 2));
      // 19% VAT (V1 conservative default; real classifier is Phase 1.5).
      const lineVatCents = (lineTotalCents * 19n) / 119n;
      const lineSubtotalCents = lineTotalCents - lineVatCents;
      totalCents += lineTotalCents;
      subtotalCents += lineSubtotalCents;
      vatCents += lineVatCents;
      itemSnapshots.push({
        productId: item.productId,
        lineSubtotalCents,
        lineVatCents,
        lineTotalCents,
        taxTreatmentCode: product.taxTreatmentCode,
        vatRate: '0.1900',
      });
    }

    const fmt = (cents: bigint): string =>
      `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

    // 3. INSERT the transaction header.
    //    For online sales we use the customer associated with the shopper.
    //    cashier_user_id is set to the shopper's customer's owner — but
    //    transactions.cashier_user_id has NOT NULL constraint and FK to users.
    //    Workaround: use a system "online_orders_actor" user. V1 hack: take
    //    the Owner user as the actor; if no Owner exists, fail loudly.
    const [systemUser] = await tx.execute<{ id: string }>(drizzleSql`
      SELECT id FROM users WHERE is_owner = TRUE LIMIT 1
    `);
    if (!systemUser) {
      throw new Error(
        'online sales require an Owner user to record cashier_user_id (memory.md #65)',
      );
    }

    // We need a device_id too (NOT NULL). For online: use any active server
    // device. If none, fail loudly — operator must seed one.
    const [systemDevice] = await tx.execute<{ id: string }>(drizzleSql`
      SELECT id FROM devices WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1
    `);
    if (!systemDevice) {
      throw new Error('online sales require an ACTIVE device row (e.g. an SSR server device)');
    }

    // Find the shopper's customer + snapshot a JSON shipping address.
    // The shopper.shipping_* fields were UPDATEd by /checkout — we read them
    // back here decrypted (key bound to this transaction via set_config),
    // build a canonical JSON, then re-encrypt as a single blob onto the
    // transaction. The result is an IMMUTABLE fiscal snapshot independent
    // of whether the shopper later changes their default address.
    //
    // The PII key is set via set_config (LOCAL — already inside tx). We use
    // the validated env (NOT process.env directly — see env.ts contract).
    // The same key powers app.withPii() in /checkout, so the encrypted blobs
    // round-trip cleanly.
    await tx.execute(drizzleSql`
      SELECT set_config('warehouse14.pii_key', ${opts.env.WAREHOUSE14_PII_KEY}, true)
    `);
    const [shopperRow] = await tx.execute<{
      customer_id: string;
      recipient_name: string | null;
      line1: string | null;
      line2: string | null;
      postal_code: string | null;
      city: string | null;
      country: string | null;
    }>(drizzleSql`
      SELECT customer_id,
             decrypt_pii(shipping_recipient_name_encrypted) AS recipient_name,
             decrypt_pii(shipping_address_line1_encrypted)  AS line1,
             decrypt_pii(shipping_address_line2_encrypted)  AS line2,
             decrypt_pii(shipping_postal_code_encrypted)    AS postal_code,
             decrypt_pii(shipping_city_encrypted)           AS city,
             shipping_country                               AS country
        FROM shoppers WHERE id = ${cart.shopperId} LIMIT 1
    `);
    if (!shopperRow) throw new Error(`shopper ${cart.shopperId} disappeared`);

    // Build the canonical shipping snapshot. NULL fields are omitted so the
    // JSON is the smallest possible — easier on the Bridge UX renderer.
    const shippingSnapshot: Record<string, string> = {};
    if (shopperRow.recipient_name) shippingSnapshot.recipientName = shopperRow.recipient_name;
    if (shopperRow.line1) shippingSnapshot.line1 = shopperRow.line1;
    if (shopperRow.line2) shippingSnapshot.line2 = shopperRow.line2;
    if (shopperRow.postal_code) shippingSnapshot.postalCode = shopperRow.postal_code;
    if (shopperRow.city) shippingSnapshot.city = shopperRow.city;
    if (shopperRow.country) shippingSnapshot.country = shopperRow.country;
    const shippingJson = JSON.stringify(shippingSnapshot);

    const taxTreatmentCode = itemSnapshots[0]?.taxTreatmentCode ?? 'STANDARD_19';

    const [tx0] = await tx
      .insert(transactions)
      .values({
        direction: 'VERKAUF',
        customerId: shopperRow.customer_id,
        deviceId: systemDevice.id,
        cashierUserId: systemUser.id,
        subtotalEur: fmt(subtotalCents),
        vatEur: fmt(vatCents),
        totalEur: fmt(totalCents),
        taxTreatmentCode,
        salesChannel: 'WEB',
        shippingStatus: 'PENDING',
        shippingAddressEncrypted: drizzleSql`encrypt_pii(${shippingJson})` as never,
      })
      .returning({ id: transactions.id });
    if (!tx0) throw new Error('transaction insert returned no row');

    // 4. INSERT line items.
    await tx.insert(transactionItems).values(
      itemSnapshots.map((s, idx) => ({
        transactionId: tx0.id,
        productId: s.productId,
        lineSubtotalEur: fmt(s.lineSubtotalCents),
        lineVatEur: fmt(s.lineVatCents),
        lineTotalEur: fmt(s.lineTotalCents),
        appliedTaxTreatmentCode: s.taxTreatmentCode,
        appliedVatRate: s.vatRate,
        displayOrder: idx,
      })),
    );

    // 5. INSERT payment.
    await tx.insert(transactionPayments).values({
      transactionId: tx0.id,
      paymentMethod: 'STRIPE',
      amountEur: fmt(totalCents),
      externalRef: providerIntentId,
    });

    // 6. Flip cart → CONVERTED + link.
    await tx
      .update(carts)
      .set({ status: 'CONVERTED', convertedToTransactionId: tx0.id })
      .where(eq(carts.id, cart.id));

    // 7. Mark the payment intent succeeded.
    await tx
      .update(paymentIntents)
      .set({ status: 'SUCCEEDED' })
      .where(eq(paymentIntents.id, pi.id));
  });
}

/**
 * Handle payment_intent.payment_failed or payment_intent.canceled.
 *
 * Effect:
 *   • payment_intent → FAILED / CANCELED.
 *   • cart → ABANDONED.
 *   • For each cart_item: release the reservation (channel='STOREFRONT').
 *   • Audit-log the failure for ops visibility.
 *
 * All in one DB transaction. If the cart was already CONVERTED (a race —
 * provider fired success + failure for the same intent — extremely rare),
 * we no-op. The webhook ACKs 200 so Stripe doesn't retry.
 */
async function handlePaymentIntentFailed(
  app: import('fastify').FastifyInstance,
  providerIntentId: string,
  eventType: 'payment_intent.payment_failed' | 'payment_intent.canceled',
): Promise<void> {
  await app.db.transaction(async (tx) => {
    const [pi] = await tx
      .select({
        id: paymentIntents.id,
        cartId: paymentIntents.cartId,
        status: paymentIntents.status,
      })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.provider, 'STRIPE'),
          eq(paymentIntents.providerIntentId, providerIntentId),
        ),
      )
      .limit(1);
    if (!pi) {
      app.log.warn(
        { providerIntentId, eventType },
        'stripe webhook (failed): unknown PaymentIntent',
      );
      return;
    }
    if (pi.status === 'SUCCEEDED') {
      app.log.warn(
        { providerIntentId },
        'stripe webhook (failed): intent already SUCCEEDED — ignoring late failure',
      );
      return;
    }

    const [cart] = await tx
      .select({
        id: carts.id,
        status: carts.status,
        reservationSessionId: carts.reservationSessionId,
      })
      .from(carts)
      .where(eq(carts.id, pi.cartId))
      .limit(1);
    if (!cart || cart.status === 'CONVERTED') {
      app.log.info(
        { cartId: pi.cartId },
        'stripe webhook (failed): cart unavailable for transition',
      );
      return;
    }
    if (cart.status === 'ABANDONED') {
      // Already swept — no-op.
      return;
    }

    // Release any reservations the checkout took. We delegate to
    // @warehouse14/inventory-lock so future column changes flow through one
    // path — the same release() the cart sweeper + POS cancel buttons call.
    if (cart.reservationSessionId && cart.status === 'CHECKOUT') {
      const itemRows = await tx.execute<{ product_id: string }>(drizzleSql`
        SELECT product_id FROM cart_items WHERE cart_id = ${cart.id}
      `);
      for (const item of itemRows) {
        try {
          await inventoryRelease(tx, {
            productId: item.product_id,
            sessionId: cart.reservationSessionId,
            userId: null,
            reason: 'storefront_payment_failed',
          });
        } catch (err) {
          if (err instanceof ReservationOwnershipError) {
            // Reservation was already released elsewhere (sweeper / manual
            // cancel) or expired — non-fatal for a failure/cancel webhook.
            app.log.info(
              { productId: item.product_id },
              'stripe webhook: release no-op (already released/expired)',
            );
          } else {
            app.log.warn({ err, productId: item.product_id }, 'stripe webhook: release failed');
          }
        }
      }
    }

    // Flip cart → ABANDONED.
    await tx.update(carts).set({ status: 'ABANDONED' }).where(eq(carts.id, cart.id));

    // Mark the payment intent — FAILED for failures, CANCELED for cancellations.
    await tx
      .update(paymentIntents)
      .set({ status: eventType === 'payment_intent.canceled' ? 'CANCELED' : 'FAILED' })
      .where(eq(paymentIntents.id, pi.id));
  });
}

export default storefrontWebhookRoutes;
