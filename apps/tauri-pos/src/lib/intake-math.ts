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

// ────────────────────────────────────────────────────────────────────────
// Cent ↔ decimal-string conversion (mirror cart-math.ts)
// ────────────────────────────────────────────────────────────────────────

export function toCents(eur: string): bigint {
  if (!/^-?\d+(\.\d+)?$/.test(eur)) {
    throw new Error(`toCents: invalid decimal string "${eur}"`);
  }
  const sign = eur.startsWith('-') ? -1n : 1n;
  const abs = eur.startsWith('-') ? eur.slice(1) : eur;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error('roundHalfEven: division by zero');
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;

  const q = absNum / absDen;
  const r = absNum % absDen;
  const twice = r * 2n;

  let result: bigint;
  if (twice < absDen) result = q;
  else if (twice > absDen) result = q + 1n;
  else result = q % 2n === 0n ? q : q + 1n;

  return negative ? -result : result;
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
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid decimal "${s}"`);
  const [whole = '0', frac = ''] = s.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}
