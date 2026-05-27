/**
 * TypeBox schemas for POST /api/transactions/storno (Day 15).
 *
 * Storno = negative-amount mirror of the original transaction, linked via
 * `storno_of_transaction_id`. The DB triggers (migration 0009 + 0013 C-5)
 * enforce:
 *   • original must not itself be a storno
 *   • direction matches the original
 *   • magnitudes exactly negate the original
 *   • customer matches
 *   • at most one storno per original (partial UNIQUE)
 *
 * The route loads the original transaction + its lines + payments, builds
 * the negated mirror, and INSERTs in one transaction. The triggers do the
 * cumulative-spend reversal + ledger emit. The route emits an explicit
 * audit_log row carrying the human-readable `reason` for incident review.
 *
 * Basel directive Day 15 §3: `requireStepUp` is **mandatory**, regardless of
 * amount. No "small storno" loophole.
 */

import { Type, type Static } from '@sinclair/typebox';

import { SignedDecimalString } from './money.js';
import { TransactionDirection } from './transaction.js';

export const StornoBody = Type.Object({
  originalTransactionId: Type.String({ format: 'uuid' }),
  /**
   * Required free-text justification — surfaced in audit_log payload and
   * shown to ADMIN on the Bridge reversal review panel. Minimum 8 chars to
   * deter "fat-finger" stornos with no context.
   */
  reason: Type.String({
    minLength: 8,
    maxLength: 1024,
    description: 'Human-readable reason for the reversal. Persisted to audit_log.',
    examples: ['Customer changed mind 30s after sale', 'Wrong item rung up'],
  }),
});
export type StornoBody = Static<typeof StornoBody>;

export const StornoResponse = Type.Object({
  /** ID of the NEW storno transaction row. */
  id: Type.String({ format: 'uuid' }),
  /** ID of the original transaction that was reversed. */
  stornoOfTransactionId: Type.String({ format: 'uuid' }),
  receiptLocator: Type.String(),
  finalizedAt: Type.String({ format: 'date-time' }),
  direction: TransactionDirection,
  /** Negated total — mirrors `-original.totalEur`. */
  totalEur: SignedDecimalString,
  /** ID of the `transaction.stornoed` ledger event emitted by the trigger. */
  ledgerEventId: Type.Integer(),
});
export type StornoResponse = Static<typeof StornoResponse>;
