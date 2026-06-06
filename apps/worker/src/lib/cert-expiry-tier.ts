/**
 * cert-expiry-tier — pure KassenSichV TSE certificate-expiry classifier.
 *
 * Turns a Fiskaly cert `valid_to` (REAL data read at the HIL boundary) into an
 * escalation tier. The cert-checker job alerts ONCE per escalation (T-30 → T-7 →
 * T-1 → expired) by comparing the current tier's rank to the last-alerted tier,
 * so the operator gets a fresh warning each time the situation gets MORE urgent
 * but is never re-spammed inside the same tier.
 *
 * No new alert type is introduced — the existing `alert.tse_cert_expiry` event
 * carries the tier in its payload (memory.md #45: zero new critical alerts).
 */

export type CertExpiryTier = 'T-30' | 'T-7' | 'T-1' | 'expired';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Classify how close a TSE certificate is to expiry.
 *   • `expired`  — `validTo` is at/before `now`.
 *   • `T-1`      — ≤ 1 full day remaining.
 *   • `T-7`      — ≤ 7 full days remaining.
 *   • `T-30`     — ≤ 30 full days remaining.
 *   • `null`     — more than 30 days out (nothing to alert).
 * "Full days" = floor of the remaining interval, matching the cert-checker.
 */
export function certExpiryTier(validTo: Date, now: Date): CertExpiryTier | null {
  const ms = validTo.getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / DAY_MS);
  if (days <= 1) return 'T-1';
  if (days <= 7) return 'T-7';
  if (days <= 30) return 'T-30';
  return null;
}

/**
 * Escalation rank: higher = more urgent. `null` (no tier) is 0 so any real tier
 * escalates from it. Used to decide whether to re-alert: alert iff
 * `tierRank(current) > tierRank(lastAlerted)`.
 */
export function tierRank(tier: CertExpiryTier | null): number {
  switch (tier) {
    case 'expired':
      return 4;
    case 'T-1':
      return 3;
    case 'T-7':
      return 2;
    case 'T-30':
      return 1;
    default:
      return 0;
  }
}
