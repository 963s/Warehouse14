/**
 * verkauf-kyc — the client mirror of the server's §10 GwG buyer-identity rule
 * for a VERKAUF. This is the gate that makes high-value retail possible (and
 * honest) on mobile: the api-cloud finalize route hard-rejects a sale whose
 * |total| ≥ the configured threshold (default €2.000) without a KYC-verified
 * buyer with KYC_REQUIRED (403). So a sale at/above the line MUST carry a
 * verified customer — and the screen surfaces that truth BEFORE the fiscal gate
 * opens, never as a post-commit English 403.
 *
 * The authority is always the server: this decision only mirrors its rule so the
 * operator is not led into a dead end. Below the threshold a buyer is OPTIONAL
 * (pure attribution / cumulative-spend link); at/above it a verified buyer is
 * REQUIRED. The comparison is `≥` and on the absolute total, exactly as
 * `totalExceedsStepUpThreshold` (transaction-math.ts) does it server-side.
 *
 * Pure + dependency-free (no React, no api): the screen feeds it the selected
 * customer + the cart total cents and renders the returned decision.
 */
import type { CustomerDetail } from "@warehouse14/api-client"

/**
 * The §10 GwG buyer-identity threshold for a VERKAUF, in cents (€2.000). This is
 * the DEFAULT the server falls back to when `gwg.verkauf_identity_threshold_eur`
 * is unset (transactions-finalize.ts COALESCE(..., 2000.00)). A shop that has
 * lowered the setting will have the SERVER refuse earlier than this client hint
 * predicts — that refusal is then surfaced honestly via the KYC_REQUIRED German
 * line, so the client mirror can never be MORE permissive than the server in a
 * way that fabricates a green light: at worst it asks for ID a touch late, and
 * the server still blocks. We keep it in one place so the copy + gate agree.
 */
export const VERKAUF_KYC_THRESHOLD_CENTS = 200_000n

export interface VerkaufKycDecision {
  /** A customer is attached to the sale at all. */
  hasCustomer: boolean
  /** The attached customer carries a KYC verification stamp (kycVerifiedAt). */
  kycVerified: boolean
  /** The cart total is at/above the §10 identity threshold (|total| ≥ €2.000). */
  thresholdReached: boolean
  /**
   * The fiscal commit is BLOCKED on identity: the total is at/above the §10
   * threshold and there is no KYC-verified buyer attached. Mirrors the server's
   * VERKAUF rule (transactions-finalize.ts) — when true, finalize would 403
   * with KYC_REQUIRED, so the screen must not open the fiscal gate yet.
   */
  blocked: boolean
}

/**
 * Evaluate the VERKAUF buyer-identity gate from the (optional) attached customer
 * and the cart total. Below the threshold the buyer is optional and `blocked` is
 * always false; at/above it a KYC-verified buyer is required.
 */
export function evaluateVerkaufKyc(params: {
  customer: CustomerDetail | null
  totalCents: bigint
}): VerkaufKycDecision {
  const { customer, totalCents } = params
  const hasCustomer = customer != null
  const kycVerified = customer?.kycVerifiedAt != null
  // Absolute value + `≥`, matching the server's totalExceedsStepUpThreshold.
  const abs = totalCents < 0n ? -totalCents : totalCents
  const thresholdReached = abs >= VERKAUF_KYC_THRESHOLD_CENTS
  const blocked = thresholdReached && !kycVerified
  return { hasCustomer, kycVerified, thresholdReached, blocked }
}
