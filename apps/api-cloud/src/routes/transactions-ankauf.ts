/**
 * POST /api/transactions/ankauf — Day-8 dedicated Ankauf write atom.
 *
 * One DB transaction wrapping:
 *   1. INSERT N rows into products (status='AVAILABLE' or 'DRAFT' per item.publishImmediately)
 *   2. INSERT 1 row into transactions (direction='ANKAUF', customerId, header_total)
 *   3. INSERT N rows into transaction_items (line_total = negotiatedPriceEur per line)
 *   4. INSERT 1 row into transaction_payments (CASH or BANK_TRANSFER outflow)
 *   5. INSERT 1 row into audit_log (ankauf.completed, redacted payload)
 *
 * Triggers that fire automatically:
 *   • transactions_validate_sanctions  (BEFORE INSERT) — refuses banned customers
 *   • transactions_validate_closing_day (BEFORE INSERT) — refuses past-FINALIZED days
 *   • transactions_ankauf_requires_customer (CHECK) — refuses null customer_id
 *   • verify_transaction_balance (DEFERRABLE INITIALLY DEFERRED) — at COMMIT
 *   • ledger_events AFTER INSERT — emits transaction.created (SSE bridge picks up)
 *
 * Step-up: REQUIRED when |totalEur| ≥ TRANSACTION_STEP_UP_THRESHOLD_EUR.
 * Same env var as Verkauf finalize; one knob for the whole platform.
 *
 * Auth: ADMIN + CASHIER (Verkauf gates the same way; Ankauf is symmetric).
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  auditLog,
  ledgerEvents,
  products,
  transactionItems,
  transactionPayments,
  transactions,
} from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { totalExceedsStepUpThreshold } from '../lib/transaction-math.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { AnkaufBody, AnkaufResponse, type AnkaufBody as TAnkaufBody } from '../schemas/ankauf.js';

// ────────────────────────────────────────────────────────────────────────
// Local error classes — mirror transactions-finalize.ts naming convention
// ────────────────────────────────────────────────────────────────────────

class AnkaufValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: { field: string; reason: string };
  public constructor(field: string, reason: string) {
    super(`Validation failed for field "${field}": ${reason}`);
    this.details = { field, reason };
  }
}

class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

// ────────────────────────────────────────────────────────────────────────
// Math helper — Σ items.negotiatedPriceEur === totalEur, bigint-cents
// ────────────────────────────────────────────────────────────────────────

function toCents(eur: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(eur)) {
    throw new AnkaufValidationError('totalEur', `invalid decimal "${eur}"`);
  }
  const sign = eur.startsWith('-') ? -1n : 1n;
  const abs = eur.startsWith('-') ? eur.slice(1) : eur;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}

function fromCents(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Error response schema (mirrors error-handler envelope)
// ────────────────────────────────────────────────────────────────────────

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface TransactionsAnkaufOpts {
  env: Env;
}

const transactionsAnkaufRoute: FastifyPluginAsync<TransactionsAnkaufOpts> = async (app, opts) => {
  app.post<{ Body: TAnkaufBody }>(
    '/api/transactions/ankauf',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Ankauf (purchase from customer) — atomic create-products + transaction.',
        description:
          'Day-8 dedicated route. Creates N product rows + 1 transaction (direction=ANKAUF) ' +
          '+ N transaction_items + 1 transaction_payment (CASH or BANK_TRANSFER outflow), all ' +
          'in one DB transaction. Customer required (DB CHECK). Sanctions hard-block applies. ' +
          'Step-up required when totalEur ≥ TRANSACTION_STEP_UP_THRESHOLD_EUR.',
        body: AnkaufBody,
        response: {
          200: AnkaufResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const actorId = req.actor.id;

      // transactions.device_id is NOT NULL — every Ankauf is anchored to a
      // specific POS terminal (the seller stood at THAT counter on THAT
      // device). Mirrors Verkauf finalize discipline.
      const deviceId = req.deviceId;
      if (!deviceId) {
        throw new DeviceRequiredError(
          'Ankauf requires a paired POS device cert — register the terminal first.',
        );
      }

      // ── Math integrity (client declares total; we re-verify exact sum) ──
      const declaredTotalCents = toCents(body.totalEur);
      let computedSumCents = 0n;
      for (const item of body.items) {
        const c = toCents(item.negotiatedPriceEur);
        if (c <= 0n) {
          throw new AnkaufValidationError(
            'items[].negotiatedPriceEur',
            `expected positive cents, got ${item.negotiatedPriceEur}`,
          );
        }
        computedSumCents += c;
      }
      if (declaredTotalCents !== computedSumCents) {
        throw new AnkaufValidationError(
          'totalEur',
          `header total ${body.totalEur} ≠ Σ items.negotiatedPriceEur ${fromCents(computedSumCents)}`,
        );
      }
      if (declaredTotalCents <= 0n) {
        throw new AnkaufValidationError('totalEur', `Ankauf total must be > 0`);
      }

      // ── payout consistency: BANK_TRANSFER must carry an externalRef; CASH must not ──
      if (body.payoutMethod === 'BANK_TRANSFER' && !body.payoutExternalRef) {
        throw new AnkaufValidationError(
          'payoutExternalRef',
          'BANK_TRANSFER requires an external reference',
        );
      }
      if (body.payoutMethod === 'CASH' && body.payoutExternalRef !== undefined) {
        throw new AnkaufValidationError(
          'payoutExternalRef',
          'CASH payout must not carry an external reference',
        );
      }

      // ── Step-up gate (server-side, defence in depth) ──
      if (totalExceedsStepUpThreshold(body.totalEur, opts.env.TRANSACTION_STEP_UP_THRESHOLD_EUR)) {
        requireStepUp(req);
      }

      // ─────────────────────────────────────────────────────────────────────
      // ONE DB transaction — the all-or-nothing contract
      // ─────────────────────────────────────────────────────────────────────
      const outcome = await app.db.transaction(async (tx) => {
        // 1. Insert all products. Each returns its uuid which we link to
        //    the transaction_items rows below.
        const createdProducts: Array<{
          id: string;
          sku: string;
          status: 'DRAFT' | 'AVAILABLE';
          clientReferenceId: string | null;
        }> = [];

        for (const item of body.items) {
          const [row] = await tx
            .insert(products)
            .values({
              sku: item.sku,
              barcode: item.barcode ?? null,
              itemType: item.itemType,
              metal: item.metal ?? null,
              karatCode: item.karatCode ?? null,
              finenessDecimal: item.finenessDecimal ?? null,
              weightGrams: item.weightGrams ?? null,
              hallmarkStamps: item.hallmarkStamps,
              // Acquisition cost is INTAKE-LOCKED at the value negotiated here.
              acquisitionCostEur: item.negotiatedPriceEur,
              listPriceEur: item.listPriceEur,
              taxTreatmentCode: item.taxTreatmentCode,
              condition: item.condition,
              isCommission: false,
              acquiredFromCustomerId: body.customerId,
              name: item.name,
              descriptionDe: item.descriptionDe ?? null,
              marketingAttributes: [],
              listedOnStorefront: false,
              listedOnEbay: false,
              status: item.publishImmediately ? 'AVAILABLE' : 'DRAFT',
              ...(item.publishImmediately ? { publishedAt: new Date() } : {}),
            })
            .returning({
              id: products.id,
              sku: products.sku,
              status: products.status,
            });
          if (!row) throw new Error('Ankauf: product INSERT returned no row');
          createdProducts.push({
            id: row.id,
            sku: row.sku,
            status: row.status as 'DRAFT' | 'AVAILABLE',
            clientReferenceId: item.clientReferenceId ?? null,
          });
        }

        // 2. Insert the transaction header. AFTER trigger emits ledger event.
        //    Sanctions BEFORE trigger fires here — banned customers throw.
        //    Closing-day BEFORE trigger fires here — FINALIZED days throw.
        const [txRow] = await tx
          .insert(transactions)
          .values({
            direction: 'ANKAUF',
            customerId: body.customerId,
            deviceId,
            cashierUserId: actorId,
            // Ankauf math: subtotal = total, vat = 0. The §25a margin only
            // materialises on the FUTURE sale of these items.
            subtotalEur: body.totalEur,
            vatEur: '0.00',
            totalEur: body.totalEur,
            // The transaction's classification — for Ankauf this is the
            // intent ("we're buying second-hand goods under §25a"). The
            // PRODUCTS each carry their own treatment for the future sale.
            taxTreatmentCode: 'MARGIN_25A',
            ...(body.notesInternal ? { notesInternal: body.notesInternal } : {}),
          })
          .returning({
            id: transactions.id,
            receiptLocator: transactions.receiptLocator,
            finalizedAt: transactions.finalizedAt,
          });
        if (!txRow) throw new Error('Ankauf: transaction INSERT returned no row');

        // 3. Insert transaction_items — one per product. Line totals are the
        //    negotiated cash prices. For Ankauf, line_subtotal = line_total
        //    and line_vat = 0 (§25a math only on resale).
        await tx.insert(transactionItems).values(
          body.items.map((item, idx) => {
            const product = createdProducts[idx];
            if (!product) throw new Error('Ankauf: product/item index mismatch');
            return {
              transactionId: txRow.id,
              productId: product.id,
              lineSubtotalEur: item.negotiatedPriceEur,
              lineVatEur: '0.00',
              lineTotalEur: item.negotiatedPriceEur,
              appliedTaxTreatmentCode: item.taxTreatmentCode,
              appliedVatRate: null,
              // Snapshot the freshly-set cost (it equals the line total here).
              acquisitionCostEurSnapshot: item.negotiatedPriceEur,
              // No margin on Ankauf — that lives on the future sale.
              marginEur: null,
              displayOrder: idx,
            };
          }),
        );

        // 4. Insert the single payment leg — cash leaves the drawer (or a
        //    bank-transfer outflow is recorded). Either way, amount = total.
        await tx.insert(transactionPayments).values({
          transactionId: txRow.id,
          paymentMethod: body.payoutMethod,
          amountEur: body.totalEur,
          externalRef: body.payoutExternalRef ?? null,
        });

        // 5. Audit log — redacted payload, never plaintext PII.
        await tx.insert(auditLog).values({
          eventType: 'ankauf.completed',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            transactionId: txRow.id,
            customerId: body.customerId,
            totalEur: body.totalEur,
            payoutMethod: body.payoutMethod,
            itemCount: createdProducts.length,
            productIds: createdProducts.map((p) => p.id),
            publishedCount: createdProducts.filter((p) => p.status === 'AVAILABLE').length,
            draftCount: createdProducts.filter((p) => p.status === 'DRAFT').length,
          },
        });

        // 6. Read the ledger event the trigger just emitted, so we can return
        //    its id (SSE consumers anchor against this).
        const ledgerRow = (
          await tx
            .select({ id: ledgerEvents.id })
            .from(ledgerEvents)
            .where(
              drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${txRow.id}`,
            )
            .limit(1)
        )[0];

        return {
          transactionId: txRow.id,
          receiptLocator: txRow.receiptLocator,
          finalizedAt: txRow.finalizedAt,
          ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
          createdProducts,
        };
      });

      return reply.status(200).send({
        transactionId: outcome.transactionId,
        receiptLocator: outcome.receiptLocator,
        finalizedAt: outcome.finalizedAt.toISOString(),
        ledgerEventId: outcome.ledgerEventId,
        totalEur: body.totalEur,
        payoutMethod: body.payoutMethod,
        createdProducts: outcome.createdProducts,
      });
    },
  );
};

export default transactionsAnkaufRoute;
