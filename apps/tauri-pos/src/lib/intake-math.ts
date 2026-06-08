/**
 * intake-math — bigint-cents math for the Ankauf cart.
 *
 * Used by the Ankauf surface to keep payout totals exact and to compute the
 * live Schmelzwert hint when the operator has entered metal + fineness +
 * weight and a current metal-price is available.
 *
 * Mirrors the precision discipline of `cart-math.ts` (HALF_EVEN banker's
 * rounding, bigint-cents only, no JS-number arithmetic).
 */

// The bigint-cents primitives live in one canonical module (money-core).
// intake-math re-exports toCents / fromCents so its public API is unchanged.
import { fromCents, roundHalfEven, toCents } from './money-core.js';

export { fromCents, toCents };

/**
 * Tolerate the German comma WITHOUT misreading a plain dot-decimal. A value
 * with a comma is German ("1.234,56" / "0,585") → strip dots, comma → dot. A
 * value with no comma is already a dot-decimal (API rates like "62.4500") →
 * leave it untouched. (Unlike `normalizeDecimal`, which treats "." as a
 * thousands separator and would mangle the API values.)
 */
function commaToDot(s: string): string {
  if (s.includes(',')) return s.replace(/\./g, '').replace(',', '.');
  return s;
}

// ────────────────────────────────────────────────────────────────────────
// Header totals
// ────────────────────────────────────────────────────────────────────────

/**
 * Sum line negotiated prices into a header total.
 * Returns bigint cents — caller converts via `fromCents` for display.
 */
export function sumNegotiatedCents(lines: readonly { negotiatedPriceEur: string }[]): bigint {
  let total = 0n;
  for (const l of lines) {
    total += toCents(l.negotiatedPriceEur);
  }
  return total;
}

// ────────────────────────────────────────────────────────────────────────
// Schmelzwert hint (melt value)
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute the live "Schmelzwert" hint for a single intake item.
 *
 *   schmelzwert = weight_grams × fineness_decimal × current_metal_price_per_gram
 *
 * Returns null when any required input is missing or the metal price is
 * unavailable. The UI degrades gracefully: no number rendered, no error.
 *
 * All math in bigint-cents (per gram, per fineness scaled to integer).
 */
export interface SchmelzwertInput {
  metal: 'gold' | 'silver' | 'platinum' | 'palladium' | null;
  /** Grams in decimal-string (e.g. "31.1035" for 1 troy oz). */
  weightGrams: string | null;
  /** Fineness 0..1 in decimal-string (e.g. "0.9999"). */
  finenessDecimal: string | null;
  /** Decimal-string per-gram price (e.g. "62.4500" for gold @ 62.45 EUR/g). */
  pricePerGramEur: string | null;
}

export function computeSchmelzwertEur(input: SchmelzwertInput): string | null {
  if (input.metal === null) return null;
  if (input.weightGrams === null || input.finenessDecimal === null) return null;
  if (input.pricePerGramEur === null) return null;

  // Scale everything to integers to keep precision:
  //   weightCents      = weight  × 10_000  (4 decimals)
  //   finenessCents    = fineness × 10_000 (4 decimals)
  //   priceCents       = price   × 10_000  (4 decimals)
  //   product (before scaling back) = weightCents × finenessCents × priceCents
  //   that's 10_000^3 = 1e12 too large; we divide by 10_000 × 10_000 × 100
  //   to land in cents (final precision = 2 decimals on EUR).
  let weightScaled: bigint;
  let finenessScaled: bigint;
  let priceScaled: bigint;
  try {
    weightScaled = parseScaled(input.weightGrams, 4);
    finenessScaled = parseScaled(input.finenessDecimal, 4);
    priceScaled = parseScaled(input.pricePerGramEur, 4);
  } catch {
    return null;
  }

  // result_in_cents = (weight × fineness × price) / (10_000 × 10_000 × 100)
  // because we want cents = EUR × 100, and we've multiplied EUR by 10_000.
  const numerator = weightScaled * finenessScaled * priceScaled;
  const denominator = 10_000n * 10_000n * 100n;
  const cents = roundHalfEven(numerator, denominator);
  return fromCents(cents);
}

function parseScaled(s: string, decimals: number): bigint {
  // Tolerate the German comma (memory.md money rule) before the strict check.
  const n = commaToDot(s);
  if (!/^\d+(\.\d+)?$/.test(n)) throw new Error(`invalid decimal "${s}"`);
  const [whole = '0', frac = ''] = n.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}

// ────────────────────────────────────────────────────────────────────────
// Estimator helpers (UX P3) — itemType → metal, fineness presets, and the
// suggested buy-price derivation (the buy-rate decision lives here).
// ────────────────────────────────────────────────────────────────────────

export type EstimatorMetal = 'gold' | 'silver' | 'platinum' | 'palladium';

/** Infer the precious metal from an itemType prefix; non-metal types → null. */
export function metalFromItemType(itemType: string): EstimatorMetal | null {
  if (itemType.startsWith('gold')) return 'gold';
  if (itemType.startsWith('silver')) return 'silver';
  if (itemType.startsWith('platinum')) return 'platinum';
  if (itemType.startsWith('palladium')) return 'palladium';
  return null;
}

/** Common hallmark finenesses per metal (per mille) for the quick-pick. */
export const COMMON_FINENESS_PER_MILLE: Record<EstimatorMetal, readonly number[]> = {
  gold: [999, 916, 750, 585, 375],
  silver: [999, 925, 800],
  platinum: [999, 950],
  palladium: [999, 950],
};

/** "585" → "0.585" (the 0..1 decimal the valuation core consumes). */
export function finenessDecimalForPerMille(perMille: number): string {
  return (perMille / 1000).toFixed(3);
}

export interface SuggestedBuyInput {
  metal: EstimatorMetal | null;
  weightGrams: string | null;
  finenessDecimal: string | null;
  /** Per-gram buy rate (margin already baked in). Preferred when present. */
  ankaufRatePerGramEur: string | null;
  /** Per-gram current spot — the gross-melt + the margin-fallback basis. */
  currentRatePerGramEur: string | null;
  /** Safety margin fraction (0.10 = 10%) for the fallback. */
  safetyMarginPct: number;
}

export interface SuggestedBuy {
  /** Decimal-string EUR, or null when no rate is available (no fake 0). */
  value: string | null;
  /** Which basis produced the value — surfaced in the UI. */
  basis: 'ankauf' | 'margin' | 'none';
}

/**
 * Suggested buy price for a precious-metal item. Prefers the server's
 * `ankaufRatePerGramEur` (margin baked in); falls back to current spot ×
 * (1 − safetyMargin); yields null when neither rate is available.
 */
export function suggestedBuyEur(input: SuggestedBuyInput): SuggestedBuy {
  const common = {
    metal: input.metal,
    weightGrams: input.weightGrams,
    finenessDecimal: input.finenessDecimal,
  };

  if (input.ankaufRatePerGramEur !== null) {
    const v = computeSchmelzwertEur({ ...common, pricePerGramEur: input.ankaufRatePerGramEur });
    if (v !== null) return { value: v, basis: 'ankauf' };
  }

  if (input.currentRatePerGramEur !== null) {
    const melt = computeSchmelzwertEur({ ...common, pricePerGramEur: input.currentRatePerGramEur });
    if (melt !== null) {
      const marginScaled = BigInt(Math.round(input.safetyMarginPct * 10_000));
      const suggested = roundHalfEven(toCents(melt) * (10_000n - marginScaled), 10_000n);
      return { value: fromCents(suggested), basis: 'margin' };
    }
  }

  return { value: null, basis: 'none' };
}
