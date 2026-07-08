/**
 * metal-margin — pure preview of the server's Ankauf (buy-rate) derivation.
 *
 * The SERVER owns the authoritative number: routes/metal-prices.ts computes
 * `ankauf = ROUND(avg10d × (1 − margin), 4)` in NUMERIC (half-away-from-zero).
 * This mirrors it so the per-metal margin editor can show the resulting buy
 * price live as the owner types — but the real value always comes from the
 * server `/rates` refetch after save (the client never persists its own price).
 *
 * Money stays a decimal STRING on the wire; we only parse for the preview.
 */

const PER_GRAM_4DP = /^-?\d+(?:\.\d+)?$/;

/** Round half-away-from-zero to 4 decimals (matches SQL ROUND(x, 4)). */
function round4(x: number): number {
  const f = 10_000;
  // +1e-9 nudges true halves over the rounding boundary despite float drift.
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
}

/**
 * Preview the derived Ankauf rate from a per-gram base (€/g as a string) and a
 * margin FRACTION (0.10 = 10%). Returns a 4dp decimal string, or null when the
 * base is missing / non-numeric or the margin is non-finite — never a fabricated
 * number.
 */
export function deriveAnkaufPerGram(
  baseEurPerGram: string | null | undefined,
  marginFraction: number,
): string | null {
  if (baseEurPerGram == null) return null;
  const trimmed = baseEurPerGram.trim();
  if (!PER_GRAM_4DP.test(trimmed)) return null;
  if (!Number.isFinite(marginFraction)) return null;

  const base = Number.parseFloat(trimmed);
  if (!Number.isFinite(base)) return null;

  return round4(base * (1 - marginFraction)).toFixed(4);
}

/** Format a per-gram decimal string as German "1.234,5678 €/g" (2–4 dp). */
export function formatPerGram(valueEur: string | null): string {
  if (valueEur == null) return '-';
  const trimmed = valueEur.trim();
  if (!PER_GRAM_4DP.test(trimmed)) return '-';
  const n = Number.parseFloat(trimmed);
  return `${n.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} €/g`;
}
