/**
 * ankauf-kyc-gate — the pure GwG §10 KYC-gate decision for the Ankauf flow.
 *
 * UI-SURFACING ONLY. The server re-enforces KYC/GwG on finalize (the client is
 * never the sole gate). This function exists so the EARLY banner in IntakeList
 * and the final AnkaufBezahlenDialog compute the requirement identically and can
 * never drift apart — and so the threshold logic is unit-testable without a DOM.
 */

import { GWG_IDENTITY_THRESHOLD_EUR } from './ankauf-thresholds.js';
import { toCents } from './intake-math.js';

export interface KycGateCustomer {
  /** ISO timestamp KYC was stamped, or null if never verified. */
  kycVerifiedAt: string | null;
}

/**
 * §10 GwG aggregation context for the selected customer: the sum of their PRIOR
 * in-window ANKAUF buys (excluding the current cart), as the server computed it
 * over the configured rolling window. Supplied by `GET /api/customers/:id`.
 */
export interface KycGateAggregate {
  /** Σ of the customer's prior in-window ANKAUF buys, in cents. */
  priorWindowAnkaufCents: bigint;
  /** Rolling window length (days) — for the banner copy. */
  windowDays: number;
}

export interface KycGateDecision {
  /** The CURRENT Ankauf total has reached the GwG §10 threshold (≥ €2.000). */
  thresholdReached: boolean;
  /**
   * §10 aggregation: the customer's rolling-window ANKAUF sum (prior + current)
   * reaches the threshold — even when the current buy alone is under it. This is
   * the linked-transaction rule that smurfing exploits.
   */
  aggregateReached: boolean;
  /** prior-window + current, in cents (current clamped at ≥0). */
  aggregateCents: bigint;
  /** The selected customer already carries a KYC stamp. */
  kycVerified: boolean;
  /**
   * KYC must be stamped before payout: EITHER the single-tx threshold OR the §10
   * aggregate is reached, a customer is selected, and they are not yet verified.
   * (False when no customer is selected — there is nothing to stamp yet.)
   */
  required: boolean;
  /** Which rule made it required, for the banner wording. Null when not required. */
  reason: 'single' | 'aggregate' | null;
}

/** GwG threshold in integer cents, computed once. */
const GWG_THRESHOLD_CENTS = toCents(GWG_IDENTITY_THRESHOLD_EUR);

export function evaluateKycGate(
  totalCents: bigint,
  customer: KycGateCustomer | null,
  aggregate?: KycGateAggregate,
): KycGateDecision {
  const thresholdReached = totalCents >= GWG_THRESHOLD_CENTS;

  const current = totalCents > 0n ? totalCents : 0n;
  const aggregateCents = (aggregate?.priorWindowAnkaufCents ?? 0n) + current;
  // Only assert the §10 rule when the server actually supplied a window aggregate.
  const aggregateReached = aggregate != null && aggregateCents >= GWG_THRESHOLD_CENTS;

  const kycVerified = customer != null && customer.kycVerifiedAt != null;
  const trips = thresholdReached || aggregateReached;
  const required = trips && customer != null && !kycVerified;
  const reason = !required ? null : thresholdReached ? 'single' : 'aggregate';

  return { thresholdReached, aggregateReached, aggregateCents, kycVerified, required, reason };
}
