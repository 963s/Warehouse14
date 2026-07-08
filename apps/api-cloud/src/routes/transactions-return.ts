/**
 * POST /api/transactions/return — online return (Day 21).
 *
 * Distinct from `transactions/storno`:
 *   • Storno is FISCAL ONLY — products stay SOLD (V1 conservative posture).
 *   • Return is PHYSICAL — items came back, products go back to AVAILABLE
 *     so they can be sold again. Triggered by Fernabsatzgesetz right of
 *     withdrawal or by warranty exchanges.
 *
 * Pipeline (one DB transaction):
 *   1. Load original transaction; refuse if not WEB sale, already returned,
 *      or already stornoed.
 *   2. Load original items + payments.
 *   3. Build a negative-amount mirror transaction with:
 *        storno_of_transaction_id = original.id
 *        returned_at              = now()
 *        shipping_status          = 'RETURNED'
 *   4. INSERT items + payments (negated) — triggers fire as usual.
 *   5. For each product in the original: flip status SOLD → AVAILABLE.
 *   6. (Best-effort) call Stripe Refund API for the original PaymentIntent;
 *      the refund.event lands on /api/webhooks/stripe and is recorded but
 *      no further state change is needed.
 *
 * Mandatory PIN step-up (fiscal action).
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  paymentIntents,
  transactionItems,
  transactionPayments,
  transactions,
} from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ReturnNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class ReturnConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class ReturnValidationError extends DomainError {
  public readonly httpStatus = 422;
  public readonly code: ApiErrorCode = 'STORNO_OF_STORNO';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

function neg(s: string): string {
  if (s.startsWith('-')) return s.slice(1);
  if (s === '0' || s === '0.00' || s === '0.0') return s;
  return `-${s}`;
}

export interface ReturnRouteOpts {
  env: Env;
}

const transactionsReturnRoute: FastifyPluginAsync<ReturnRouteOpts> = async (app, opts) => {
  app.post<{
    Body: { originalTransactionId: string; reason: string };
  }>(
    '/api/transactions/return',
    {
      schema: {
        tags: ['transactions'],
        summary:
          'Online return (Fernabsatzgesetz). Reverses fiscal + returns product to AVAILABLE.',
        body: Type.Object({
          originalTransactionId: Type.String({ format: 'uuid' }),
          reason: Type.String({ minLength: 8, maxLength: 1024 }),
        }),
        response: {
          200: Type.Object({
            id: Type.String({ format: 'uuid' }),
            stornoOfTransactionId: Type.String({ format: 'uuid' }),
            returnedAt: Type.String({ format: 'date-time' }),
            stripeRefundQueued: Type.Boolean(),
          }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          422: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const { originalTransactionId, reason } = req.body;

      const outcome = await app.db.transaction(async (tx) => {
        const [orig] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, originalTransactionId))
          .limit(1);
        if (!orig) throw new ReturnNotFoundError(`Transaction ${originalTransactionId} not found.`);
        if (orig.stornoOfTransactionId != null) {
          throw new ReturnValidationError('Cannot return a storno transaction.');
        }
        if (orig.salesChannel !== 'WEB') {
          throw new ReturnConflictError(
            'Only WEB sales can be online-returned. Use storno for POS sales.',
          );
        }
        // Refuse double-return: partial UNIQUE on storno_of_transaction_id already does it.

        const items = await tx
          .select()
          .from(transactionItems)
          .where(eq(transactionItems.transactionId, originalTransactionId));
        const payments = await tx
          .select()
          .from(transactionPayments)
          .where(eq(transactionPayments.transactionId, originalTransactionId));

        // Insert the return mirror.
        const [ret] = await tx
          .insert(transactions)
          .values({
            direction: orig.direction,
            customerId: orig.customerId,
            deviceId: orig.deviceId,
            cashierUserId: req.actor.id,
            subtotalEur: neg(orig.subtotalEur),
            vatEur: neg(orig.vatEur),
            totalEur: neg(orig.totalEur),
            taxTreatmentCode: orig.taxTreatmentCode,
            stornoOfTransactionId: orig.id,
            notesInternal: `[return] ${reason}`,
            salesChannel: orig.salesChannel,
            shippingStatus: 'RETURNED',
            returnedAt: new Date(),
          })
          .returning({ id: transactions.id, finalizedAt: transactions.finalizedAt });
        if (!ret) throw new Error('return insert returned no row');

        if (items.length > 0) {
          await tx.insert(transactionItems).values(
            items.map((line) => ({
              transactionId: ret.id,
              productId: line.productId,
              lineSubtotalEur: neg(line.lineSubtotalEur),
              lineVatEur: neg(line.lineVatEur),
              lineTotalEur: neg(line.lineTotalEur),
              appliedTaxTreatmentCode: line.appliedTaxTreatmentCode,
              appliedVatRate: line.appliedVatRate,
              acquisitionCostEurSnapshot: line.acquisitionCostEurSnapshot,
              marginEur: line.marginEur != null ? neg(line.marginEur) : null,
              displayOrder: line.displayOrder,
            })),
          );
        }
        if (payments.length > 0) {
          await tx.insert(transactionPayments).values(
            payments.map((p) => ({
              transactionId: ret.id,
              paymentMethod: p.paymentMethod,
              amountEur: neg(p.amountEur),
              externalRef: p.externalRef,
              zvtTerminalId: p.zvtTerminalId,
              zvtReceiptNumber: p.zvtReceiptNumber,
              zvtCardBrand: p.zvtCardBrand,
              zvtCardPanMasked: p.zvtCardPanMasked,
              molliePaymentId: p.molliePaymentId,
            })),
          );
        }

        // Flip each product back to AVAILABLE. Null the FULL reservation
        // envelope too (mirroring inventory-lock `release`): an AVAILABLE row
        // MUST carry no reservation columns (CHECK products_available_no_reservation).
        // A WEB sale keeps its envelope on the SOLD row, so flipping to AVAILABLE
        // without clearing it violated the CHECK and rolled the whole return back.
        for (const line of items) {
          await tx.execute(drizzleSql`
          UPDATE products
             SET status = 'AVAILABLE'::product_status,
                 sold_at = NULL,
                 reserved_by_channel = NULL,
                 reserved_by_session_id = NULL,
                 reserved_by_user_id = NULL,
                 reserved_at = NULL,
                 reservation_expires_at = NULL
           WHERE id = ${line.productId} AND status = 'SOLD'::product_status
        `);
        }

        // Best-effort Stripe Refund. We resolve the original payment_intent for
        // this transaction by walking back to the cart it was converted from.
        let refundQueued = false;
        const [pi] = (await tx
          .select({
            provider: paymentIntents.provider,
            providerIntentId: paymentIntents.providerIntentId,
          })
          .from(paymentIntents)
          .innerJoin(drizzleSql`carts c`, drizzleSql`carts.id = ${paymentIntents.cartId}` as never)
          .where(drizzleSql`carts.converted_to_transaction_id = ${orig.id}` as never)
          .limit(1)
          .catch(() => [])) as Array<{ provider: string; providerIntentId: string }>;
        if (pi && opts.env.STRIPE_SECRET_KEY && pi.provider === 'STRIPE') {
          // Fire-and-forget: the refund event lands on the existing webhook.
          // We don't await this strictly — but inside the tx it stays serial.
          // We DO await to surface auth/network errors loudly.
          try {
            const body = new URLSearchParams();
            body.set('payment_intent', pi.providerIntentId);
            body.set('metadata[return_transaction_id]', ret.id);
            body.set('metadata[reason]', reason.slice(0, 200));
            const resp = await fetch('https://api.stripe.com/v1/refunds', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${opts.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Stripe-Version': opts.env.STRIPE_API_VERSION,
              },
              body: body.toString(),
            });
            refundQueued = resp.ok;
            if (!resp.ok) {
              req.log.warn({ status: resp.status }, 'stripe refund call failed (continuing)');
            }
          } catch (err) {
            req.log.warn({ err }, 'stripe refund call threw (continuing)');
          }
        }

        return { id: ret.id, finalizedAt: ret.finalizedAt, refundQueued };
      });

      return reply.status(200).send({
        id: outcome.id,
        stornoOfTransactionId: originalTransactionId,
        returnedAt: outcome.finalizedAt.toISOString(),
        stripeRefundQueued: outcome.refundQueued,
      });
    },
  );
};

export default transactionsReturnRoute;
