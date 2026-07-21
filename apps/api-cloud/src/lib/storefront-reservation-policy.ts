/**
 * Reserve-and-pickup business rules (security review 2026-07-21).
 *
 * The owner's question — "what stops one shopper reserving ALL products?" —
 * had no answer: the reserve flow held every cart item unconditionally, with no
 * per-cart or per-shopper ceiling, so a script minting guests could lock the
 * whole catalogue for the full 3-day hold. These caps are the business answer.
 *
 * The numbers fit a physical antiques/coins/gold shop where a reservation means
 * "hold it, I will come pick it up": a genuine customer reserves a handful of
 * pieces, never dozens. Env-overridable so the owner can tune without a deploy.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Max distinct products a single reservation (one cart) may hold. A pickup of
 * more than this is not a normal customer; it is hoarding or a script.
 */
export const MAX_ITEMS_PER_RESERVATION = envInt('STOREFRONT_MAX_ITEMS_PER_RESERVATION', 8);

/**
 * Max distinct products a single shopper may hold RESERVED at once, counted
 * across ALL their live holds (a shopper can reserve, get a fresh cart, and
 * reserve again — this bounds the running total, not just one reservation).
 */
export const MAX_ACTIVE_RESERVED_PER_SHOPPER = envInt('STOREFRONT_MAX_ACTIVE_RESERVED_PER_SHOPPER', 8);

/** Max distinct products a cart may accumulate — mirrors the reservation cap so
 *  the shopper hits an honest "cart full" early, not a surprise at reserve time. */
export const MAX_ITEMS_PER_CART = MAX_ITEMS_PER_RESERVATION;
