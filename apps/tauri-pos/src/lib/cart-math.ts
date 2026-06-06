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

export function toCents(input: string): bigint {
  // Tolerate the German decimal comma ("10,20") anywhere a price string flows.
  const eur = input.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(eur)) {
    throw new Error(`toCents: invalid decimal string "${input}"`);
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
  const negative = num < 0n !== den < 0n;
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
// Discount math (percent → EUR; invoice-discount distribution).
//
// Money: bigint-cents, HALF_EVEN, capped, Σ-EXACT (no rounding drift). The
// per-line TAX math (computeLineMath) is REUSED — these only produce the
// discountEur it consumes.
// ────────────────────────────────────────────────────────────────────────

/** Discount cents from a percentage of `baseCents`, HALF_EVEN, clamped to [0, base]. */
export function percentToEur(baseCents: bigint, pct: number): bigint {
  if (baseCents <= 0n || !Number.isFinite(pct) || pct <= 0) return 0n;
  const pctBp = BigInt(Math.round(pct * 100)); // basis points: 10% → 1000
  if (pctBp <= 0n) return 0n;
  let d = roundHalfEven(baseCents * pctBp, 10_000n);
  if (d < 0n) d = 0n;
  if (d > baseCents) d = baseCents;
  return d;
}

/**
 * Distribute a total invoice discount across line bases proportionally, using
 * the largest-remainder method so Σ(shares) === min(totalCents, Σbases) EXACTLY
 * (no drift) and no share exceeds its own base.
 */
export function distributeInvoiceDiscount(
  bases: readonly bigint[],
  totalCents: bigint,
): bigint[] {
  const n = bases.length;
  if (n === 0) return [];
  const totalBase = bases.reduce((acc, b) => acc + (b > 0n ? b : 0n), 0n);
  if (totalBase <= 0n || totalCents <= 0n) return bases.map(() => 0n);

  const target = totalCents > totalBase ? totalBase : totalCents;
  const shares = new Array<bigint>(n);
  const remainders = new Array<bigint>(n);
  let allocated = 0n;
  for (let i = 0; i < n; i++) {
    const b = (bases[i] as bigint) > 0n ? (bases[i] as bigint) : 0n;
    const num = b * target;
    const floor = num / totalBase;
    shares[i] = floor;
    remainders[i] = num - floor * totalBase;
    allocated += floor;
  }

  let leftover = target - allocated; // ∈ [0, n)
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ra = remainders[a] as bigint;
    const rb = remainders[b] as bigint;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return a - b; // tie → lower index
  });
  for (let k = 0; k < order.length && leftover > 0n; k++) {
    shares[order[k] as number] += 1n;
    leftover -= 1n;
  }
  return shares;
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
  /** Rabatt knocked off this line (≥ 0). GoBD-reported separately. */
  lineDiscountCents: bigint;
}

export function computeLineMath(params: {
  taxTreatmentCode: TaxTreatmentCode;
  listPriceEur: string;
  acquisitionCostEur: string;
  /** Rabatt to knock off the list price before tax. Clamped to [0, listPrice]. */
  discountEur?: string | undefined;
}): LineMath {
  const listTotal = toCents(params.listPriceEur);
  let discount = params.discountEur ? toCents(params.discountEur) : 0n;
  if (discount < 0n) discount = 0n;
  if (discount > listTotal) discount = listTotal;

  // Tax is computed on the NET (post-discount) price; the discount amount is
  // carried alongside for the receipt + GoBD reporting (line_discount_eur).
  const breakdown = computeTaxBreakdown(
    params.taxTreatmentCode,
    listTotal - discount,
    toCents(params.acquisitionCostEur),
  );
  return { ...breakdown, lineDiscountCents: discount };
}

function computeTaxBreakdown(
  taxTreatmentCode: TaxTreatmentCode,
  total: bigint,
  cost: bigint,
): Omit<LineMath, 'lineDiscountCents'> {
  switch (taxTreatmentCode) {
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
    case 'REVERSE_CHARGE_13B': {
      const subtotal = roundHalfEven(total * 100n, 119n);
      return {
        lineTotalCents: subtotal,
        lineVatCents: 0n,
        lineSubtotalCents: subtotal,
        marginCents: null,
        appliedVatRate: '0.0000',
        acquisitionCostSnapshotCents: null,
      };
    }
    default:
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

export function classifyCartProductTax(product: {
  itemType: string;
  finenessDecimal: string | null;
  acquiredFromCustomerId: string | null;
  isCommission: boolean;
  yearMintedFrom?: number | null;
}): TaxTreatmentCode {
  const purity = product.finenessDecimal ? Number.parseFloat(product.finenessDecimal) : 0;

  // §25c investment gold — bars at ≥ 99.5% fineness. Checked first so an
  // investment-grade piece is NEVER mis-classified as a §25a margin item.
  if (product.itemType === 'gold_bar' && purity >= 0.995) {
    return 'INVESTMENT_GOLD_25C';
  }
  // §25c investment gold — coins at ≥ 90.0% fineness minted after 1800 (the
  // BMF "modern bullion coin" test). A second-hand investment coin is still
  // §25c, so this precedes the margin-scheme fallback below.
  if (
    product.itemType === 'gold_coin' &&
    purity >= 0.9 &&
    typeof product.yearMintedFrom === 'number' &&
    product.yearMintedFrom >= 1800
  ) {
    return 'INVESTMENT_GOLD_25C';
  }

  const isSecondHand = product.acquiredFromCustomerId !== null || product.isCommission;
  const isSecondHandEligibleType = [
    'gold_jewelry',
    'gold_coin',
    'silver_jewelry',
    'silver_coin',
    'platinum_jewelry',
    'platinum_coin',
    'antique',
    'watch',
  ].includes(product.itemType);

  if (isSecondHand && isSecondHandEligibleType) {
    return 'MARGIN_25A';
  }

  return 'STANDARD_19';
}

// ────────────────────────────────────────────────────────────────────────
// Header totals — sum of line totals (with HALF_EVEN we don't lose cents).
// ────────────────────────────────────────────────────────────────────────

export interface HeaderTotals {
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
}

// ────────────────────────────────────────────────────────────────────────
// Tender split — voucher + cash (Phase C2). A voucher covers up to the full
// total; the cash leg pays the remainder; change is computed on the remainder.
// ────────────────────────────────────────────────────────────────────────

export interface TenderSplit {
  /** Voucher amount actually applied (≤ total, ≤ balance, ≥ 0). */
  appliedVoucherCents: bigint;
  /** Amount still due after the voucher (paid in cash). */
  dueCents: bigint;
  /** Change to hand back (0 when cash doesn't yet cover the due). */
  changeCents: bigint;
  /** True once the cash received covers the post-voucher due. */
  cashCovered: boolean;
}

export function computeTender(params: {
  totalCents: bigint;
  /** null when no voucher is applied. */
  voucherBalanceCents: bigint | null;
  cashCents: bigint;
}): TenderSplit {
  const { totalCents, voucherBalanceCents, cashCents } = params;
  let applied = 0n;
  if (voucherBalanceCents !== null && voucherBalanceCents > 0n) {
    applied = voucherBalanceCents >= totalCents ? totalCents : voucherBalanceCents;
  }
  const dueCents = totalCents - applied;
  const cashCovered = cashCents >= dueCents;
  const changeCents = cashCovered ? cashCents - dueCents : 0n;
  return { appliedVoucherCents: applied, dueCents, changeCents, cashCovered };
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
