/**
 * Session lifetime — one source of truth for staff/owner session TTLs.
 *
 * Security review 2026-07-21: the owner TTL was 30 days, duplicated across the
 * PIN and Google login routes. A 30-day token on a device that could be lost is
 * a long blast-radius window (the app's LocalLockGate re-locks every launch, so
 * the token is not freely usable, but a stolen UNLOCKED phone had a month of
 * reach). Shortened to 7 days for the owner; staff stays a work-shift 8 hours.
 * Revocation (sessions.revoked_at, migration 0089) is the immediate kill switch
 * for the lost-device case; this TTL is the passive backstop.
 */

/** Owner session lifetime. */
export const OWNER_SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

/** Staff (cashier) session lifetime — a work shift. */
export const STAFF_SESSION_TTL_MS = 8 * 60 * 60_000; // 8 hours

/** The TTL for a freshly minted session, by actor kind. */
export function sessionTtlMs(isOwner: boolean): number {
  return isOwner ? OWNER_SESSION_TTL_MS : STAFF_SESSION_TTL_MS;
}
