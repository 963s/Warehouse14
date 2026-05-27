/**
 * cart-math — pure bigint-cents math for the Verkauf cart.
 *
 * The server (`apps/api-cloud/src/lib/transaction-math.ts`) re-validates
 * every number with Decimal.js, so anything we send here must match. Rules:
 *
 *   STANDARD_19       vat = total × 19 / 119 (round HALF_EVEN to cents)
 *                     subtotal = total - vat
 *   REDUCED_7         vat = total × 7  / 107
 *                     subtotal = total - vat
 *   MARGIN_25A        margin = max(0, listPrice - acquisitionCost)
 *                     vat    = margin × 19 / 119  (NEVER negative — if cost
 *                              exceeds price, the operator priced below cost
 *                              and the §25a vat is zero by law)
 *                     subtotal = total - vat
 *   INVESTMENT_GOLD_25C  vat = 0; subtotal = total = listPrice
 *
 * Rounding: HALF_EVEN (banker's rounding) to match memory.md #41. We use
 * the "round-half-even on cents from full integer math" trick to avoid
 * Decimal.js as a client-side dep.
 */

import type { TaxTreatmentCode } from '@warehouse14/api-client';

// ────────────────────────────────────────────────────────────────────────
// Cent <-> decimal-string conversion
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

// ────────────────────────────────────────────────────────────────────────
// Banker's rounding (HALF_EVEN) on integer-cent ratios.
//
//   round_half_even(num, den) → bigint cents
//
// Used by per-line VAT extraction. Plain (num / den) truncates toward zero,
// which is correct ~50% of the time. We add the half-up adjustment, then
// flip ties to even.
// ────────────────────────────────────────────────────────────────────────

function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error('roundHalfEven: division by zero');
  const negative = (num < 0n) !== (den < 0n);
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;

  const q = absNum / absDen;
  const r = absNum % absDen;
  const twice = r * 2n;

  let result: bigint;
  if (twice < absDen) result = q;
  else if (twice > absDen) result = q + 1n;
  else result = q % 2n === 0n ? q : q + 1n; // tie → even

  return negative ? -result : result;
}

// ────────────────────────────────────────────────────────────────────────
// Per-line tax breakdown
// ────────────────────────────────────────────────────────────────────────

export interface LineMath {
  /** Header line_total — what the customer pays for this row. */
  lineTotalCents: bigint;
  /** Decomposed VAT inside that total. */
  lineVatCents: bigint;
  /** lineTotal - lineVat. */
  lineSubtotalCents: bigint;
  /** For §25a: the margin component (NULL otherwise). */
  marginCents: bigint | null;
  /** The decimal VAT rate (e.g. "0.1900") or null for §25a/§25c. */
  appliedVatRate: string | null;
  /** Snapshot of acquisition cost (only for §25a). */
  acquisitionCostSnapshotCents: bigint | null;
}

export function computeLineMath(params: {
  taxTreatmentCode: TaxTreatmentCode;
  listPriceEur: string;
  acquisitionCostEur: string;
}): LineMath {
  const total = toCents(params.listPriceEur);
  const cost = toCents(params.acquisitionCostEur);

  switch (params.taxTreatmentCode) {
    case 'STANDARD_19': {
      const vat = roundHalfEven(total * 19n, 119n);
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: null,
        appliedVatRate: '0.1900',
        acquisitionCostSnapshotCents: null,
      };
    }
    case 'REDUCED_7': {
      const vat = roundHalfEven(total * 7n, 107n);
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: null,
        appliedVatRate: '0.0700',
        acquisitionCostSnapshotCents: null,
      };
    }
    case 'MARGIN_25A': {
      // Margin is non-negative — a below-cost sale produces zero VAT (the
      // shop took a loss; the Finanzamt doesn't pay VAT back).
      const rawMargin = total - cost;
      const margin = rawMargin < 0n ? 0n : rawMargin;
      const vat = roundHalfEven(margin * 19n, 119n);
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: margin,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: cost,
      };
    }
    case 'INVESTMENT_GOLD_25C':
      return {
        lineTotalCents: total,
        lineVatCents: 0n,
        lineSubtotalCents: total,
        marginCents: null,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: null,
      };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Header totals — sum of line totals (with HALF_EVEN we don't lose cents).
// ────────────────────────────────────────────────────────────────────────

export interface HeaderTotals {
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
}

export function sumHeader(lines: readonly LineMath[]): HeaderTotals {
  let sub = 0n;
  let vat = 0n;
  let tot = 0n;
  for (const l of lines) {
    sub += l.lineSubtotalCents;
    vat += l.lineVatCents;
    tot += l.lineTotalCents;
  }
  return {
    subtotalEur: fromCents(sub),
    vatEur: fromCents(vat),
    totalEur: fromCents(tot),
  };
}
