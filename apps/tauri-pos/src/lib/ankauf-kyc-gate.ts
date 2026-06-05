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

export interface KycGateDecision {
  /** The running Ankauf total has reached the GwG §10 threshold (≥ €2.000). */
  thresholdReached: boolean;
  /** The selected customer already carries a KYC stamp. */
  kycVerified: boolean;
  /**
   * KYC must be stamped before payout: the threshold is reached, a customer is
   * selected, and they are not yet verified. (False when no customer is
   * selected — there is nothing to stamp yet.)
   */
  required: boolean;
}

/** GwG threshold in integer cents, computed once. */
const GWG_THRESHOLD_CENTS = toCents(GWG_IDENTITY_THRESHOLD_EUR);

export function evaluateKycGate(
  totalCents: bigint,
  customer: KycGateCustomer | null,
): KycGateDecision {
  const thresholdReached = totalCents >= GWG_THRESHOLD_CENTS;
  const kycVerified = customer != null && customer.kycVerifiedAt != null;
  const required = thresholdReached && customer != null && !kycVerified;
  return { thresholdReached, kycVerified, required };
}
