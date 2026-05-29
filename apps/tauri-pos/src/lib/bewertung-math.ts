/**
 * bewertung-math — Schmelzwert hint + integer-cents totals.
 *
 * Live "Schmelzwert" hint per item:
 *
 *   schmelzwert_eur = weight_grams × fineness_decimal × price_per_gram_eur
 *
 * Everything lifted into integer space (4-decimal scaling) so we stay
 * bigint-only — no Number arithmetic in the price path. Matches the
 * server-side discipline of memory.md #41 (HALF_EVEN rounding) and
 * #69 (metal-prices engine).
 *
 * Returns null when any required input is missing — the UI degrades
 * gracefully and just omits the hint.
 */

export function toCents(eur: string): bigint {
  if (!/^-?\d+(\.\d+)?$/.test(eur)) {
    throw new Error(`toCents: invalid decimal "${eur}"`);
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

function parseScaled(s: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid decimal "${s}"`);
  const [whole = '0', frac = ''] = s.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}

export interface SchmelzwertInput {
  metal: 'gold' | 'silver' | 'platinum' | 'palladium' | null | undefined;
  weightGrams: string | null | undefined;
  finenessDecimal: string | null | undefined;
  pricePerGramEur: string | null | undefined;
}

/**
 * Compute the per-item Schmelzwert hint. Returns null when any input is
 * missing or malformed (UI shows no hint). All-integer math:
 *
 *   weight_scaled  = weight  × 10_000          (4-decimal scale)
 *   fineness_scaled= fineness × 10_000
 *   price_scaled   = price   × 10_000
 *   result_in_cents = round_half_even(
 *     weight_scaled × fineness_scaled × price_scaled / (10_000^3 / 100)
 *   )
 *
 * The denominator `1e12 / 100 = 1e10` lands the result in cents.
 */
export function computeSchmelzwertEur(input: SchmelzwertInput): string | null {
  if (
    input.metal === null ||
    input.metal === undefined ||
    input.weightGrams === null ||
    input.weightGrams === undefined ||
    input.weightGrams.length === 0 ||
    input.finenessDecimal === null ||
    input.finenessDecimal === undefined ||
    input.finenessDecimal.length === 0 ||
    input.pricePerGramEur === null ||
    input.pricePerGramEur === undefined ||
    input.pricePerGramEur.length === 0
  ) {
    return null;
  }
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
  const numerator = weightScaled * finenessScaled * priceScaled;
  const denominator = 10_000n * 10_000n * 100n;
  const cents = roundHalfEven(numerator, denominator);
  return fromCents(cents);
}

/** Sum of negotiated/offered values, bigint-cents safe. */
export function sumItemCents(values: readonly string[]): bigint {
  let total = 0n;
  for (const v of values) total += toCents(v);
  return total;
}
