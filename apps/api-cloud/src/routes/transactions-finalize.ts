/**
 * POST /api/transactions/finalize — the first vital artery (ADR-0021 §1).
 *
 * The 12 days of foundation work converge here. One DB transaction. All-or-
 * nothing. The DB triggers do the policing; this handler orchestrates.
 *
 * Sequence (everything inside `db.transaction(...)`):
 *
 *   1. inventory-lock finalize() for each line — RESERVED → SOLD.
 *      Throws ReservationOwnershipError on mismatch.
 *   2. INSERT into transactions — the BEFORE INSERT triggers fire:
 *        • transactions_validate_storno          (sign + amounts + direction)
 *        • transactions_validate_sanctions       (C-2, hard-block)
 *        • transactions_validate_closing_day     (C-3, FINALIZED-day guard)
 *        • transactions_ankauf_requires_customer (C-1)
 *        • transactions_balance_equation         (subtotal+vat=total)
 *        • transactions_sign_discipline          (sign vs storno_of)
 *   3. INSERT into transaction_items (one or many).
 *   4. INSERT into transaction_payments (one or many).
 *   5. AFTER INSERT on transactions fires `on_transaction_finalized`:
 *        • UPDATE customers.cumulative_*_eur     (Great Connection)
 *        • INSERT ledger_events (extends the hash chain + pg_notify SSE)
 *
 * Any thrown error inside the block ⇒ ROLLBACK ⇒ no partial state. The DB
 * is either back to "before" or fully forward to "after".
 *
 * Gatekeepers (in order):
 *   • requireAuth         — must have a valid session
 *   • requireRole         — ADMIN or CASHIER
 *   • mTLS device         — populated by mtlsPlugin; the route checks it
 *     for the POS surface (CASHIER role MUST have a device id; ADMIN may
 *     not — e.g. Bridge UX issuing a back-office adjustment)
 *   • requireStepUp       — if |totalEur| ≥ TRANSACTION_STEP_UP_THRESHOLD_EUR
 *
 * Money discipline (Decimal.js):
 *   • Σ items.lineTotalEur          === totalEur
 *   • Σ items.lineSubtotalEur       === subtotalEur
 *   • Σ items.lineVatEur            === vatEur
 *   • Σ payments.amountEur          === totalEur
 *   • subtotalEur + vatEur          === totalEur
 *   • sign discipline mirrors storno_of_transaction_id presence
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  ledgerEvents,
  transactionItems,
  transactionPayments,
  transactions,
} from '@warehouse14/db/schema';
import {
  ReservationOwnershipError,
  finalize as finalizeReservation,
} from '@warehouse14/inventory-lock';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { totalExceedsStepUpThreshold, validateTransactionMath } from '../lib/transaction-math.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  FinalizeBody,
  FinalizeResponse,
  type FinalizeBody as TFinalizeBody,
} from '../schemas/transaction.js';

// ────────────────────────────────────────────────────────────────────────
// Local errors → ApiErrorCode mapping
// ────────────────────────────────────────────────────────────────────────

class ProductNotReservableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'PRODUCT_NOT_RESERVABLE';
}

class ValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}

class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

// Error response schema — referenced for OpenAPI completeness.
const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface TransactionsFinalizeOpts {
  env: Env;
}

// ────────────────────────────────────────────────────────────────────────
// Plugin / route
// ────────────────────────────────────────────────────────────────────────

const transactionsFinalize: FastifyPluginAsync<TransactionsFinalizeOpts> = async (app, opts) => {
  app.post(
    '/api/transactions/finalize',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Finalize a fiscal transaction (the vital artery, ADR-0021)',
        description:
          'All-or-nothing finalize: moves each reserved product to SOLD, inserts the transaction + items + payments, ' +
          'and (via DB triggers) updates the customer cumulative spend and emits a hash-chained ledger event. ' +
          'High-value transactions require a fresh PIN step-up.',
        body: FinalizeBody,
        response: {
          200: FinalizeResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
          423: ErrorResponse,
        },
      },
    },
    async (req, _reply) => {
      // ──────────────────────────────────────────────────────────────────
      // 1. Gatekeepers.
      // ──────────────────────────────────────────────────────────────────
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // Every finalized transaction must originate from an mTLS-paired device.
      // The mtlsPlugin populates req.deviceId from Cf-Client-Cert-Sha256 (prod)
      // or X-Dev-Device-Fingerprint (dev). Tests must send this header too.
      const deviceId = req.deviceId;
      if (!deviceId) {
        throw new DeviceRequiredError('Finalize requires an mTLS-paired device');
      }

      const body = req.body as TFinalizeBody;

      // Step-up gate — high-value transactions need a fresh PIN within the
      // 10-minute window. We use absolute value so a €5,000 storno triggers
      // the same friction as a €5,000 sale.
      if (totalExceedsStepUpThreshold(body.totalEur, opts.env.TRANSACTION_STEP_UP_THRESHOLD_EUR)) {
        requireStepUp(req);
      }

      // ──────────────────────────────────────────────────────────────────
      // 2. Decimal.js validation — fail fast with field paths.
      // ──────────────────────────────────────────────────────────────────
      const mathErr = validateTransactionMath(body);
      if (mathErr) {
        throw new ValidationError(mathErr.message, mathErr);
      }

      // ──────────────────────────────────────────────────────────────────
      // 3-PRE. §19.2 C-4 idempotency dedup.
      //
      // Cheap pre-check OUTSIDE the transaction — if a row already exists
      // for this idempotency key, return the original result without
      // re-running finalize. This is the "lost response, operator retry"
      // path: the original transaction committed, the response never
      // reached the client, the operator retried with the SAME key.
      //
      // The pre-check is not the security boundary — the DB's partial
      // UNIQUE INDEX (transactions_idempotency_key_uniq, migration 0028)
      // is. The check below is the happy-path fast lane; on a true race
      // (two concurrent retries) one INSERT wins, the other catches the
      // unique-violation below and falls back to the same dedup SELECT.
      // ──────────────────────────────────────────────────────────────────
      const existingByKey = (
        await app.db
          .select({
            id: transactions.id,
            receiptLocator: transactions.receiptLocator,
            finalizedAt: transactions.finalizedAt,
            direction: transactions.direction,
            totalEur: transactions.totalEur,
            stornoOfTransactionId: transactions.stornoOfTransactionId,
          })
          .from(transactions)
          .where(drizzleSql`${transactions.idempotencyKey} = ${body.idempotencyKey}::uuid`)
          .limit(1)
      )[0];

      if (existingByKey) {
        const ledgerRow = (
          await app.db
            .select({ id: ledgerEvents.id })
            .from(ledgerEvents)
            .where(
              drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${existingByKey.id}`,
            )
            .limit(1)
        )[0];

        return {
          id: existingByKey.id,
          receiptLocator: existingByKey.receiptLocator,
          finalizedAt: existingByKey.finalizedAt.toISOString(),
          ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
          direction: existingByKey.direction,
          totalEur: existingByKey.totalEur,
          storno: existingByKey.stornoOfTransactionId != null,
        };
      }

      // ──────────────────────────────────────────────────────────────────
      // 3. ONE database transaction — the all-or-nothing contract.
      //
      // Drizzle's `db.transaction` wraps BEGIN…COMMIT/ROLLBACK. Any throw
      // inside rolls back; we then re-throw so the error-handler plugin
      // maps the error to HTTP.
      // ──────────────────────────────────────────────────────────────────
      const outcome = await app.db
        .transaction(async (tx) => {
          // 3a. Move each reserved product to SOLD. The ownership guard
          // checks BOTH `(sessionId, userId)` — closes memory.md §19.2 C-1
          // (cross-cashier stale-cart finalize). A reservation created by
          // Cashier A cannot be finalized by Cashier B even if B has the
          // same sessionId in their localStorage.
          const actorUserId = req.actor.id; // requireAuth narrowed actor → non-null
          for (const item of body.items) {
            try {
              await finalizeReservation(tx, {
                productId: item.productId,
                sessionId: item.reservationSessionId,
                userId: actorUserId,
              });
            } catch (err) {
              if (err instanceof ReservationOwnershipError) {
                throw new ProductNotReservableError(err.message);
              }
              throw err;
            }
          }

          // 3b. INSERT the transaction header. Triggers fire here:
          //   sanctions / closing-day / storno-validation / ankauf-customer / sign-discipline.
          //   The AFTER-INSERT trigger then runs cumulative spend + ledger emit.
          const txRow = (
            await tx
              .insert(transactions)
              .values({
                direction: body.direction,
                customerId: body.customerId,
                deviceId,
                cashierUserId: req.actor.id,
                subtotalEur: body.subtotalEur,
                vatEur: body.vatEur,
                totalEur: body.totalEur,
                taxTreatmentCode: body.taxTreatmentCode,
                // §19.2 C-4 — persist the client's idempotency key. The partial
                // UNIQUE INDEX (migration 0028) raises 23505 on a concurrent
                // duplicate; we catch it outside this transaction and fall back
                // to the same SELECT-by-key dedup path as the pre-check.
                idempotencyKey: body.idempotencyKey,
                ...(body.stornoOfTransactionId
                  ? { stornoOfTransactionId: body.stornoOfTransactionId }
                  : {}),
                ...(body.notesInternal ? { notesInternal: body.notesInternal } : {}),
              })
              .returning({
                id: transactions.id,
                receiptLocator: transactions.receiptLocator,
                finalizedAt: transactions.finalizedAt,
              })
          )[0];
          if (!txRow) {
            throw new Error('INSERT INTO transactions returned no row (should be impossible)');
          }

          // 3c. INSERT line items.
          await tx.insert(transactionItems).values(
            body.items.map((item, idx) => ({
              transactionId: txRow.id,
              productId: item.productId,
              lineSubtotalEur: item.lineSubtotalEur,
              lineVatEur: item.lineVatEur,
              lineTotalEur: item.lineTotalEur,
              appliedTaxTreatmentCode: item.appliedTaxTreatmentCode,
              appliedVatRate: item.appliedVatRate,
              acquisitionCostEurSnapshot: item.acquisitionCostEurSnapshot,
              marginEur: item.marginEur,
              displayOrder: item.displayOrder ?? idx,
            })),
          );

          // 3d. INSERT payment legs.
          await tx.insert(transactionPayments).values(
            body.payments.map((p) => ({
              transactionId: txRow.id,
              paymentMethod: p.paymentMethod,
              amountEur: p.amountEur,
              externalRef: p.externalRef ?? null,
              zvtTerminalId: p.zvtTerminalId ?? null,
              zvtReceiptNumber: p.zvtReceiptNumber ?? null,
              zvtCardBrand: p.zvtCardBrand ?? null,
              zvtCardPanMasked: p.zvtCardPanMasked ?? null,
              molliePaymentId: p.molliePaymentId ?? null,
            })),
          );

          // 3e. Look up the ledger_events row that the AFTER-INSERT trigger
          // emitted — the SSE consumers reference this id. The trigger always
          // emits exactly one row per (transactions, entity_id) by design.
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
            id: txRow.id,
            receiptLocator: txRow.receiptLocator,
            finalizedAt: txRow.finalizedAt,
            ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
          };
        })
        .catch(async (err: unknown) => {
          // §19.2 C-4 race fallback: two concurrent retries with the same
          // idempotency key. One INSERT wins, the other gets 23505. We swap
          // the error for a SELECT-by-key that returns the winning row.
          if (isUniqueViolation(err, 'transactions_idempotency_key_uniq')) {
            const winner = (
              await app.db
                .select({
                  id: transactions.id,
                  receiptLocator: transactions.receiptLocator,
                  finalizedAt: transactions.finalizedAt,
                })
                .from(transactions)
                .where(drizzleSql`${transactions.idempotencyKey} = ${body.idempotencyKey}::uuid`)
                .limit(1)
            )[0];
            if (!winner) {
              // Should be impossible — the unique violation proves a row exists.
              throw err;
            }
            const ledgerRow = (
              await app.db
                .select({ id: ledgerEvents.id })
                .from(ledgerEvents)
                .where(
                  drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${winner.id}`,
                )
                .limit(1)
            )[0];
            return {
              id: winner.id,
              receiptLocator: winner.receiptLocator,
              finalizedAt: winner.finalizedAt,
              ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
            };
          }
          throw err;
        });

      return {
        id: outcome.id,
        receiptLocator: outcome.receiptLocator,
        finalizedAt: outcome.finalizedAt.toISOString(),
        ledgerEventId: outcome.ledgerEventId,
        direction: body.direction,
        totalEur: body.totalEur,
        storno: body.stornoOfTransactionId != null,
      };
    },
  );
};

/**
 * §19.2 C-4 helper — narrow a Postgres unique-violation by constraint name.
 *
 * postgres-js raises `PostgresError` with `code = '23505'` and `constraint_name`
 * set to the violated unique index. We match on the partial UNIQUE for
 * idempotency_key only — any OTHER unique violation (e.g. receipt locator
 * collision, vanishingly unlikely) should still propagate as a 500.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  return e.constraint_name === constraint || e.constraint === constraint;
}

export default transactionsFinalize;
