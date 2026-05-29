/**
 * POST /api/transactions/storno — fiscal reversal (Day 15 §3).
 *
 * The most dangerous money-moving endpoint in the API. Reverses a prior
 * transaction by creating a new row with `storno_of_transaction_id` set and
 * NEGATED money columns. The DB triggers do the heavy lifting:
 *
 *   BEFORE INSERT on transactions:
 *     • transactions_validate_storno          — direction match, magnitudes
 *                                               negate exactly, customer match,
 *                                               original is not itself a storno.
 *     • transactions_validate_sanctions       — C-2 (still applies).
 *     • transactions_validate_closing_day     — C-3 (CANNOT storno into a
 *                                               FINALIZED business day).
 *     • transactions_sign_discipline          — storno row must be ≤ 0.
 *     • transactions_balance_equation         — subtotal+vat = total.
 *
 *   AT INSERT:
 *     • transactions_one_storno_per_original_uq (C-5) — UNIQUE partial index
 *       refuses a second storno on the same original.
 *
 *   AFTER INSERT on transactions:
 *     • on_transaction_finalized — UPDATEs customers.cumulative_*_eur with
 *       NEGATIVE total (auto-subtracts) + emits ledger event
 *       'transaction.stornoed' (extends hash chain + pg_notify).
 *
 * Inventory is NOT touched in V1 — products stay SOLD. A separate "return
 * to AVAILABLE" operation is Phase 2 territory (ADR-0016 amendment pending).
 *
 * Basel directive Day 15 §3 — MANDATORY:
 *   `requireStepUp` is invoked UNCONDITIONALLY, regardless of the transaction
 *   amount. No "small storno" loophole. Every fiscal reversal carries a
 *   fresh PIN signature. The route also persists the human-readable `reason`
 *   to `audit_log` inside the same DB transaction so the reversal carries
 *   non-repudiable context for incident review.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  type LedgerEvent,
  type TransactionItem,
  type TransactionPayment,
  type Transaction as TransactionRow,
  auditLog,
  ledgerEvents,
  transactionItems,
  transactionPayments,
  transactions,
} from '@warehouse14/db/schema';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { StornoBody, StornoResponse, type StornoBody as TStornoBody } from '../schemas/storno.js';

// ────────────────────────────────────────────────────────────────────────
// Local error classes — surface to error-handler with stable codes.
// ────────────────────────────────────────────────────────────────────────

class TransactionNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class CannotStornoOfStornoError extends DomainError {
  public readonly httpStatus = 422;
  public readonly code: ApiErrorCode = 'STORNO_OF_STORNO';
}

class AlreadyStornoedError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

// ────────────────────────────────────────────────────────────────────────
// Helper — negate a NUMERIC(18,2) string preserving the wire format.
// Decimal.js would be heavier; this stays inside the regex we already
// enforce via TypeBox + the DB CHECK.
// ────────────────────────────────────────────────────────────────────────

function negateDecimalString(s: string): string {
  if (s.startsWith('-')) return s.slice(1);
  if (s === '0' || s === '0.00' || s === '0.0') return s;
  return `-${s}`;
}

// ────────────────────────────────────────────────────────────────────────
// Plugin / route
// ────────────────────────────────────────────────────────────────────────

const transactionsStorno: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TStornoBody }>(
    '/api/transactions/storno',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Reverse a transaction — fiscal storno (mandatory step-up).',
        description:
          'Creates a negative-amount mirror of the original transaction, linked ' +
          'via `storno_of_transaction_id`. The DB triggers reverse cumulative ' +
          'spend and emit a ledger event. PIN step-up is MANDATORY (Basel ' +
          'directive Day 15 §3) — no fiscal reversal without a fresh PIN.',
        body: StornoBody,
        response: {
          200: StornoResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          422: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      // ──────────────────────────────────────────────────────────────────
      // 1. Auth gates — strictest configuration in the API.
      // ──────────────────────────────────────────────────────────────────
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      if (req.actor.role === 'CASHIER' && req.deviceId == null) {
        throw new DeviceRequiredError('CASHIER actions require a paired POS device cert.');
      }

      // BASEL DIRECTIVE: step-up is MANDATORY for storno regardless of amount.
      // Throws StepUpRequiredError → 403 STEP_UP_REQUIRED if PIN not fresh.
      requireStepUp(req);

      const { originalTransactionId, reason } = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // ──────────────────────────────────────────────────────────────────
      // 2. One DB transaction wraps everything from here.
      //    If any step throws, ROLLBACK undoes the partial state.
      // ──────────────────────────────────────────────────────────────────
      const result = await app.db.transaction(async (tx) => {
        // 2a. Load the original transaction.
        const originalRows: TransactionRow[] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, originalTransactionId))
          .limit(1);
        const original = originalRows[0];
        if (!original) {
          throw new TransactionNotFoundError(
            `Transaction ${originalTransactionId} does not exist.`,
          );
        }

        // 2b. Defensive check — DB trigger also refuses, but giving the caller
        //     a clear 422 code at the boundary beats a generic CHECK_VIOLATION.
        if (original.stornoOfTransactionId != null) {
          throw new CannotStornoOfStornoError(
            `Transaction ${originalTransactionId} is itself a storno and cannot be reversed.`,
          );
        }

        // 2c. Defensive check — UNIQUE partial index (C-5) also refuses, but
        //     clear 409 beats unique_violation.
        const existingRows: { id: string }[] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.stornoOfTransactionId, originalTransactionId))
          .limit(1);
        if (existingRows[0]) {
          throw new AlreadyStornoedError(
            `Transaction ${originalTransactionId} has already been stornoed (storno id: ${existingRows[0].id}).`,
          );
        }

        // 2d. Load the original's lines + payments — we mirror them with
        //     negated amounts. INSERT-only tables so the read is consistent.
        const originalItems: TransactionItem[] = await tx
          .select()
          .from(transactionItems)
          .where(eq(transactionItems.transactionId, originalTransactionId));
        const originalPayments: TransactionPayment[] = await tx
          .select()
          .from(transactionPayments)
          .where(eq(transactionPayments.transactionId, originalTransactionId));

        // 2e. INSERT the storno transaction. The BEFORE INSERT triggers
        //     (storno-validation, sanctions, closing-day) all fire here.
        //     The AFTER INSERT trigger fires customer-spend reversal + ledger emit.
        const insertedRows: { id: string; receiptLocator: string; finalizedAt: Date }[] = await tx
          .insert(transactions)
          .values({
            direction: original.direction,
            customerId: original.customerId,
            deviceId: deviceId ?? original.deviceId,
            cashierUserId: actorId,
            subtotalEur: negateDecimalString(original.subtotalEur),
            vatEur: negateDecimalString(original.vatEur),
            totalEur: negateDecimalString(original.totalEur),
            taxTreatmentCode: original.taxTreatmentCode,
            stornoOfTransactionId: originalTransactionId,
            notesInternal: original.notesInternal,
          })
          .returning({
            id: transactions.id,
            receiptLocator: transactions.receiptLocator,
            finalizedAt: transactions.finalizedAt,
          });
        const storno = insertedRows[0];
        if (!storno) {
          // Cannot happen — RETURNING always emits when INSERT succeeds.
          throw new Error('storno INSERT returned no row');
        }

        // 2f. Mirror lines with negated amounts.
        if (originalItems.length > 0) {
          await tx.insert(transactionItems).values(
            originalItems.map((line) => ({
              transactionId: storno.id,
              productId: line.productId,
              lineSubtotalEur: negateDecimalString(line.lineSubtotalEur),
              lineVatEur: negateDecimalString(line.lineVatEur),
              lineTotalEur: negateDecimalString(line.lineTotalEur),
              appliedTaxTreatmentCode: line.appliedTaxTreatmentCode,
              appliedVatRate: line.appliedVatRate,
              acquisitionCostEurSnapshot: line.acquisitionCostEurSnapshot,
              marginEur: line.marginEur != null ? negateDecimalString(line.marginEur) : null,
              displayOrder: line.displayOrder,
            })),
          );
        }

        // 2g. Mirror payment legs with negated amounts (refunds).
        if (originalPayments.length > 0) {
          await tx.insert(transactionPayments).values(
            originalPayments.map((p) => ({
              transactionId: storno.id,
              paymentMethod: p.paymentMethod,
              amountEur: negateDecimalString(p.amountEur),
              externalRef: p.externalRef,
              zvtTerminalId: p.zvtTerminalId,
              zvtReceiptNumber: p.zvtReceiptNumber,
              zvtCardBrand: p.zvtCardBrand,
              zvtCardPanMasked: p.zvtCardPanMasked,
              molliePaymentId: p.molliePaymentId,
            })),
          );
        }

        // 2h. Persist the human reason — audit_log INSIDE the same TX so the
        //     reason commits atomically with the storno (or rolls back together).
        await tx.insert(auditLog).values({
          eventType: 'transaction.stornoed_with_reason',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            stornoId: storno.id,
            originalTransactionId,
            reason,
            originalTotalEur: original.totalEur,
            stornoTotalEur: negateDecimalString(original.totalEur),
            direction: original.direction,
          },
        });

        // 2i. Read back the ledger event id emitted by the AFTER INSERT trigger.
        //     The trigger writes EXACTLY ONE row per transactions INSERT; we
        //     take the most recent for this storno's UUID.
        const ledgerRows: Pick<LedgerEvent, 'id'>[] = await tx
          .select({ id: ledgerEvents.id })
          .from(ledgerEvents)
          .where(
            drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${storno.id}`,
          )
          .orderBy(drizzleSql`${ledgerEvents.id} DESC`)
          .limit(1);
        const ledgerEventId = ledgerRows[0]?.id;
        if (ledgerEventId == null) {
          throw new Error('AFTER INSERT trigger did not emit a ledger_event row for the storno');
        }

        return {
          id: storno.id,
          receiptLocator: storno.receiptLocator,
          finalizedAt: storno.finalizedAt,
          direction: original.direction,
          totalEur: negateDecimalString(original.totalEur),
          ledgerEventId: Number(ledgerEventId),
        };
      });

      return reply.status(200).send({
        id: result.id,
        stornoOfTransactionId: originalTransactionId,
        receiptLocator: result.receiptLocator,
        finalizedAt: result.finalizedAt.toISOString(),
        direction: result.direction,
        totalEur: result.totalEur,
        ledgerEventId: result.ledgerEventId,
      });
    },
  );
};

export default transactionsStorno;
