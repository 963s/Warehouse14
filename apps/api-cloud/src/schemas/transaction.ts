/**
 * TypeBox schemas for POST /api/transactions/finalize.
 *
 * Single source of truth — Fastify uses these for runtime validation,
 * @fastify/swagger publishes them as the OpenAPI 3.1 schema, and
 * `Static<typeof X>` gives the route handler precise compile-time types.
 *
 * The body is intentionally explicit:
 *   • Header totals are required even though they're recomputable from
 *     items — this is the client's declaration of intent, which the API
 *     validates with Decimal.js. Mismatch = client bug = reject.
 *   • Each line carries its `reservation_session_id` (the UUID from a prior
 *     `reserve()`) so the route can call `finalize()` per line.
 *   • Storno is the same endpoint with `storno_of_transaction_id` set and
 *     all money fields negated.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString, SignedDecimalString, VatRateString } from './money.js';

// ────────────────────────────────────────────────────────────────────────
// Enums (mirror the DB)
// ────────────────────────────────────────────────────────────────────────

export const TransactionDirection = Type.Union([Type.Literal('VERKAUF'), Type.Literal('ANKAUF')], {
  description: 'VERKAUF = we sell to customer; ANKAUF = we buy from customer (ADR-0007).',
});

export const PaymentMethod = Type.Union(
  [
    Type.Literal('CASH'),
    Type.Literal('ZVT_CARD'),
    Type.Literal('SUMUP'),
    Type.Literal('MOLLIE'),
    Type.Literal('STRIPE'),
    Type.Literal('EBAY'),
    Type.Literal('BANK_TRANSFER'),
    Type.Literal('VOUCHER'),
  ],
  { description: 'Payment channel — per migration 0009 enum.' },
);

export const TaxTreatmentCode = Type.Union(
  [
    Type.Literal('MARGIN_25A'),
    Type.Literal('INVESTMENT_GOLD_25C'),
    Type.Literal('STANDARD_19'),
    Type.Literal('REDUCED_7'),
    Type.Literal('MIXED'),
    Type.Literal('REVERSE_CHARGE_13B'),
  ],
  { description: 'BMF tax treatment code (seeded in tax_treatment_codes — migration 0005).' },
);

// ────────────────────────────────────────────────────────────────────────
// Line item
// ────────────────────────────────────────────────────────────────────────

export const FinalizeLineItem = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  reservationSessionId: Type.String({
    format: 'uuid',
    description:
      'Session id from the prior `reserve()` that put this product into RESERVED state. ' +
      'The route calls inventory-lock finalize() with this id; mismatch fails the whole transaction.',
  }),

  // Negative on storno lines.
  lineSubtotalEur: SignedDecimalString,
  lineVatEur: SignedDecimalString,
  lineTotalEur: SignedDecimalString,

  appliedTaxTreatmentCode: TaxTreatmentCode,
  appliedVatRate: Type.Union([VatRateString, Type.Null()], {
    description: 'NULL for §25a margin scheme; otherwise the snapshot of the rate applied at sale.',
  }),

  // §25a margin snapshot — required when applied_tax_treatment_code = MARGIN_25A.
  acquisitionCostEurSnapshot: Type.Union([DecimalString, Type.Null()]),
  marginEur: Type.Union([SignedDecimalString, Type.Null()]),

  /**
   * Rabatt (line discount), GoBD-reported separately (migration 0019). The
   * line money fields above are already NET of this amount — this records HOW
   * MUCH was knocked off so the receipt + DSFinV-K can show it. The DB CHECK
   * `line_discount_eur = 0 OR line_discount_reason IS NOT NULL` requires a
   * reason whenever the discount is non-zero; the route surfaces a clean
   * VALIDATION_ERROR before the DB does.
   */
  lineDiscountEur: Type.Optional(DecimalString),
  lineDiscountReason: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),

  displayOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 32767 })),
});
export type FinalizeLineItem = Static<typeof FinalizeLineItem>;

// ────────────────────────────────────────────────────────────────────────
// Payment leg
// ────────────────────────────────────────────────────────────────────────

export const FinalizePayment = Type.Object({
  paymentMethod: PaymentMethod,
  amountEur: SignedDecimalString,
  externalRef: Type.Optional(Type.String({ maxLength: 256 })),
  zvtTerminalId: Type.Optional(Type.String({ maxLength: 64 })),
  zvtReceiptNumber: Type.Optional(Type.String({ maxLength: 64 })),
  zvtCardBrand: Type.Optional(Type.String({ maxLength: 32 })),
  zvtCardPanMasked: Type.Optional(
    Type.String({
      pattern: '^\\*+\\d{4}$',
      description: 'Masked last-4 PAN (e.g. `****1234`). DB CHECK refuses other shapes.',
    }),
  ),
  molliePaymentId: Type.Optional(Type.String({ maxLength: 64 })),
});
export type FinalizePayment = Static<typeof FinalizePayment>;

// ────────────────────────────────────────────────────────────────────────
// Request body
// ────────────────────────────────────────────────────────────────────────

export const FinalizeBody = Type.Object({
  direction: TransactionDirection,

  /**
   * Optional for VERKAUF (walk-in cash sale below KYC threshold).
   * REQUIRED for ANKAUF — enforced by `transactions_ankauf_requires_customer`
   * CHECK constraint (migration 0013 C-1). Sending null here on ANKAUF will
   * fail at the DB, which the error-handler maps to VALIDATION_ERROR.
   */
  customerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),

  // Header money — the client's declaration. Decimal.js validation re-checks
  // against the sum of items + payments.
  subtotalEur: SignedDecimalString,
  vatEur: SignedDecimalString,
  totalEur: SignedDecimalString,
  taxTreatmentCode: TaxTreatmentCode,

  items: Type.Array(FinalizeLineItem, { minItems: 1, maxItems: 200 }),
  payments: Type.Array(FinalizePayment, { minItems: 1, maxItems: 16 }),

  /**
   * §19.2 C-4 — client-supplied idempotency token.
   *
   * The client (BezahlenDialog) generates a UUIDv4 once per Bezahlen
   * dialog open and SENDS THE SAME KEY on every retry attempt. The
   * server's INSERT … ON CONFLICT pattern guarantees at-most-once
   * finalize for a given key — a lost-response retry returns the
   * ORIGINAL transaction row, not a duplicate.
   *
   * Partial UNIQUE INDEX `transactions_idempotency_key_uniq` (migration
   * 0028) is the enforcement layer. NULL is permitted for legacy / non-
   * V1 callers (e.g. webhook handlers, worker jobs), but V1 POS clients
   * MUST set this. Required field — no Type.Optional.
   */
  idempotencyKey: Type.String({
    format: 'uuid',
    description: 'Client-generated UUIDv4. Same key on every retry of the same logical sale.',
  }),

  /**
   * Storno linkage. Present when this transaction REVERSES a prior one.
   * The pre-existing `transactions_validate_storno` trigger enforces:
   *   • the referenced row is not itself a storno
   *   • direction matches the original
   *   • magnitudes exactly negate the original
   *   • customer matches
   * Migration 0013 C-5 adds the partial UNIQUE — at most one storno per original.
   */
  stornoOfTransactionId: Type.Optional(Type.String({ format: 'uuid' })),

  notesInternal: Type.Optional(Type.String({ maxLength: 1024 })),

  /**
   * Abholung einer Web-Reservierung am Tresen (0099).
   *
   * Gesetzt, wenn dieser Verkauf die Ware einer Online-Reservierung übergibt,
   * die der Kunde abholt und hier bezahlt. Dann gilt zweierlei: die reservierten
   * Stücke gehören keinem Kassierer (`reserved_by_user_id` ist NULL), also wird
   * mit `userId: null` finalisiert; und nach dem Beleg wird der Warenkorb an
   * DIESE Transaktion gebunden (CONVERTED, pickup_stage ABGEHOLT, abgeholt am
   * und durch), damit die Reservierung und der Kassenbon EIN Vorgang sind und
   * nicht zwei unverbundene Zeilen.
   */
  webOrderNumber: Type.Optional(Type.String({ maxLength: 32 })),
});
export type FinalizeBody = Static<typeof FinalizeBody>;

// ────────────────────────────────────────────────────────────────────────
// Response
// ────────────────────────────────────────────────────────────────────────

export const FinalizeResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  receiptLocator: Type.String(),
  finalizedAt: Type.String({ format: 'date-time' }),
  ledgerEventId: Type.Integer({
    description: 'monotonically-increasing id of the emitted ledger_events row.',
  }),
  direction: TransactionDirection,
  totalEur: SignedDecimalString,
  storno: Type.Boolean({ description: 'TRUE if this transaction reversed a prior one.' }),
});
export type FinalizeResponse = Static<typeof FinalizeResponse>;
