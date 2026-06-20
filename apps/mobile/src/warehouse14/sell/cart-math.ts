/**
 * cart-math — pure bigint-cents money + tax math for the Owner OS sell spine.
 *
 * WHY THIS LIVES HERE (and is not imported): the canonical, audited
 * implementation is `apps/tauri-pos/src/lib/cart-math.ts` (+ `money-core.ts`),
 * which the mobile app may NOT touch and CANNOT import across the app boundary.
 * The api-cloud route `apps/api-cloud/src/lib/transaction-math.ts` is the FINAL
 * authority: it re-validates every number we send with Decimal.js and refuses a
 * finalize whose lines don't agree with its header. So this module is a faithful
 * MIRROR of those two — same bigint-cents discipline, same HALF_EVEN rounding,
 * same per-Steuerschlüssel formulas — so a body produced from it passes the
 * server's invariants byte-for-byte. We do NOT reinvent tax policy here; we copy
 * the proven formulas and point at their source. If the canonical math changes,
 * this mirror must change with it.
 *
 * Server invariants this math satisfies (transaction-math.ts §1–6):
 *   • line_subtotal + line_vat = line_total  (per line)
 *   • Σ line_total = header_total, Σ line_subtotal = header_subtotal,
 *     Σ line_vat = header_vat
 *   • sign discipline: an original (non-storno) sale carries non-negative money.
 *
 * Discipline (memory.md #41, mirrored from money-core.ts):
 *   • cents are ALWAYS bigint — never JS Number/parseFloat/toFixed arithmetic.
 *   • rounding is HALF_EVEN (banker's rounding), ties to even.
 *   • money strings tolerate the German decimal comma ("50,00").
 *
 * Display formatting is NOT done here — surfaces format the EUR strings this
 * module returns through `formatCents`/`formatEur` from `../api` (de-DE EUR).
 */
import type { TaxTreatmentCode } from "@warehouse14/api-client"

// ────────────────────────────────────────────────────────────────────────────
// Cent ⇄ decimal-string conversion (mirrors money-core.ts exactly)
// ────────────────────────────────────────────────────────────────────────────

/** Parse a EUR decimal string ("10,20" / "10.2") to integer bigint cents. */
export function toCents(input: string): bigint {
  // Tolerate the German decimal comma ("10,20") anywhere a price string flows.
  const eur = input.trim().replace(",", ".")
  if (!/^-?\d+(\.\d+)?$/.test(eur)) {
    throw new Error(`toCents: invalid decimal string "${input}"`)
  }
  const sign = eur.startsWith("-") ? -1n : 1n
  const abs = eur.startsWith("-") ? eur.slice(1) : eur
  const [whole = "0", frac = ""] = abs.split(".")
  const fracPadded = frac.padEnd(2, "0").slice(0, 2)
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || "0"))
}

/** Render integer bigint cents back to the wire EUR string ("1999.99"). */
export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? "-" : ""
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`
}

/**
 * Parse a possibly-incomplete user-typed EUR string to cents WITHOUT throwing.
 * Returns null on anything that isn't a clean decimal — for live keypad input
 * where a partial value ("12,") must not crash. Empty/"," reads as 0.
 */
export function tryToCents(input: string): bigint | null {
  const eur = input.trim().replace(",", ".")
  if (eur === "" || eur === ".") return 0n
  if (!/^-?\d+(\.\d+)?$/.test(eur)) return null
  try {
    return toCents(eur)
  } catch {
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Banker's rounding (HALF_EVEN) on integer-cent ratios (mirrors money-core.ts)
// ────────────────────────────────────────────────────────────────────────────

export function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error("roundHalfEven: division by zero")
  const negative = num < 0n !== den < 0n
  const absNum = num < 0n ? -num : num
  const absDen = den < 0n ? -den : den

  const q = absNum / absDen
  const r = absNum % absDen
  const twice = r * 2n

  let result: bigint
  if (twice < absDen) result = q
  else if (twice > absDen) result = q + 1n
  else result = q % 2n === 0n ? q : q + 1n // tie → even

  return negative ? -result : result
}

// ────────────────────────────────────────────────────────────────────────────
// Per-line tax breakdown (mirrors tauri-pos cart-math computeLineMath/Breakdown)
// ────────────────────────────────────────────────────────────────────────────

export interface LineMath {
  /** Header line_total — what the customer pays for this row, in cents. */
  lineTotalCents: bigint
  /** Decomposed VAT inside that total. */
  lineVatCents: bigint
  /** lineTotal − lineVat. */
  lineSubtotalCents: bigint
  /** For §25a: the margin component (null otherwise). */
  marginCents: bigint | null
  /** The decimal VAT rate ("0.1900") or null for §25a/§25c. */
  appliedVatRate: string | null
  /** Snapshot of acquisition cost (only for §25a). */
  acquisitionCostSnapshotCents: bigint | null
  /** Rabatt knocked off this line (≥ 0). GoBD-reported separately. */
  lineDiscountCents: bigint
}

/**
 * Compute the full money breakdown for ONE cart line at a unit's list price.
 * Tax is computed on the NET (post-discount) price; the discount is carried
 * alongside for the receipt + GoBD reporting (line_discount_eur).
 *
 * NOTE: this is per-UNIT math. The cart multiplies a line by its quantity by
 * adding `qty` unit-breakdowns (see `lineForQuantity`), so each cent rounds
 * once per unit exactly as the tauri POS does for a qty-1 line, and the header
 * stays Σ-exact under HALF_EVEN.
 */
export function computeLineMath(params: {
  taxTreatmentCode: TaxTreatmentCode
  listPriceEur: string
  acquisitionCostEur: string
  /** Rabatt to knock off the list price before tax. Clamped to [0, listPrice]. */
  discountEur?: string | undefined
}): LineMath {
  const listTotal = toCents(params.listPriceEur)
  let discount = params.discountEur ? toCents(params.discountEur) : 0n
  if (discount < 0n) discount = 0n
  if (discount > listTotal) discount = listTotal

  const breakdown = computeTaxBreakdown(
    params.taxTreatmentCode,
    listTotal - discount,
    toCents(params.acquisitionCostEur),
  )
  return { ...breakdown, lineDiscountCents: discount }
}

function computeTaxBreakdown(
  taxTreatmentCode: TaxTreatmentCode,
  total: bigint,
  cost: bigint,
): Omit<LineMath, "lineDiscountCents"> {
  switch (taxTreatmentCode) {
    case "STANDARD_19": {
      const vat = roundHalfEven(total * 19n, 119n)
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: null,
        appliedVatRate: "0.1900",
        acquisitionCostSnapshotCents: null,
      }
    }
    case "REDUCED_7": {
      const vat = roundHalfEven(total * 7n, 107n)
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: null,
        appliedVatRate: "0.0700",
        acquisitionCostSnapshotCents: null,
      }
    }
    case "MARGIN_25A": {
      // §25a Differenzbesteuerung — VAT only on the (non-negative) margin. A
      // below-cost sale yields zero VAT: the shop took a loss; the Finanzamt
      // does not refund VAT on it.
      const rawMargin = total - cost
      const margin = rawMargin < 0n ? 0n : rawMargin
      const vat = roundHalfEven(margin * 19n, 119n)
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: margin,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: cost,
      }
    }
    case "INVESTMENT_GOLD_25C":
      // §25c Anlagegold — VAT-exempt; subtotal = total.
      return {
        lineTotalCents: total,
        lineVatCents: 0n,
        lineSubtotalCents: total,
        marginCents: null,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: null,
      }
    case "REVERSE_CHARGE_13B": {
      // §13b — VAT shifts to the recipient; the line carries no output VAT and
      // the header total IS the net subtotal (mirrors tauri-pos cart-math).
      const subtotal = roundHalfEven(total * 100n, 119n)
      return {
        lineTotalCents: subtotal,
        lineVatCents: 0n,
        lineSubtotalCents: subtotal,
        marginCents: null,
        appliedVatRate: "0.0000",
        acquisitionCostSnapshotCents: null,
      }
    }
    case "MIXED":
    default:
      // No single rate applies (a mixed basket is split into typed lines before
      // it reaches here). Treat as zero-VAT pass-through; the server is the
      // authority and will refuse anything inconsistent.
      return {
        lineTotalCents: total,
        lineVatCents: 0n,
        lineSubtotalCents: total,
        marginCents: null,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: null,
      }
  }
}

/**
 * The full breakdown for a line of `qty` identical units, accumulated as the
 * sum of `qty` unit-breakdowns so each cent rounds per unit (server-faithful)
 * and the per-line subtotal+vat=total invariant holds. `qty` is clamped to ≥ 1.
 */
export function lineForQuantity(
  unit: LineMath,
  qty: number,
): LineMath {
  const n = BigInt(Math.max(1, Math.trunc(qty)))
  const margin = unit.marginCents === null ? null : unit.marginCents * n
  const cost =
    unit.acquisitionCostSnapshotCents === null ? null : unit.acquisitionCostSnapshotCents * n
  return {
    lineTotalCents: unit.lineTotalCents * n,
    lineVatCents: unit.lineVatCents * n,
    lineSubtotalCents: unit.lineSubtotalCents * n,
    marginCents: margin,
    appliedVatRate: unit.appliedVatRate,
    acquisitionCostSnapshotCents: cost,
    lineDiscountCents: unit.lineDiscountCents * n,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Header totals — Σ of line totals (HALF_EVEN per unit keeps cents Σ-exact)
// ────────────────────────────────────────────────────────────────────────────

export interface HeaderTotalsCents {
  subtotalCents: bigint
  vatCents: bigint
  totalCents: bigint
}

export function sumHeaderCents(lines: readonly LineMath[]): HeaderTotalsCents {
  let sub = 0n
  let vat = 0n
  let tot = 0n
  for (const l of lines) {
    sub += l.lineSubtotalCents
    vat += l.lineVatCents
    tot += l.lineTotalCents
  }
  return { subtotalCents: sub, vatCents: vat, totalCents: tot }
}

// ────────────────────────────────────────────────────────────────────────────
// VAT grouping for the receipt — one row per applied Steuerschlüssel
// ────────────────────────────────────────────────────────────────────────────

export interface VatGroup {
  taxTreatmentCode: TaxTreatmentCode
  /** Decimal rate ("0.1900") or null (§25a/§25c). */
  appliedVatRate: string | null
  netCents: bigint
  vatCents: bigint
  grossCents: bigint
}

/**
 * Group lines by Steuerschlüssel + rate so the receipt can print the legally
 * required VAT breakdown ("darin enthalten 19% MwSt …"). Each `line` must carry
 * its own treatment code (the cart attaches it).
 */
export function groupVat(
  lines: readonly (LineMath & { taxTreatmentCode: TaxTreatmentCode })[],
): VatGroup[] {
  const map = new Map<string, VatGroup>()
  for (const l of lines) {
    const key = `${l.taxTreatmentCode}|${l.appliedVatRate ?? ""}`
    const g = map.get(key)
    if (g) {
      g.netCents += l.lineSubtotalCents
      g.vatCents += l.lineVatCents
      g.grossCents += l.lineTotalCents
    } else {
      map.set(key, {
        taxTreatmentCode: l.taxTreatmentCode,
        appliedVatRate: l.appliedVatRate,
        netCents: l.lineSubtotalCents,
        vatCents: l.lineVatCents,
        grossCents: l.lineTotalCents,
      })
    }
  }
  return [...map.values()]
}

// ────────────────────────────────────────────────────────────────────────────
// Tender — cash received vs. amount due → change / shortfall
// ────────────────────────────────────────────────────────────────────────────

export interface TenderSplit {
  /** Amount still due (in cents). */
  dueCents: bigint
  /** Cash actually received (in cents). */
  receivedCents: bigint
  /** Change to hand back (0 when cash doesn't yet cover the due). */
  changeCents: bigint
  /** Cash still missing to cover the due (0 once covered). */
  shortfallCents: bigint
  /** True once the cash received covers the amount due. */
  covered: boolean
}

/**
 * The cash-tender split for a CASH sale: given the amount due and the cash the
 * operator received, compute change vs. shortfall. Card/transfer tenders pay
 * the exact total and need no keypad — this is the cash-drawer path.
 */
export function computeTender(params: {
  dueCents: bigint
  receivedCents: bigint
}): TenderSplit {
  const due = params.dueCents < 0n ? 0n : params.dueCents
  const received = params.receivedCents < 0n ? 0n : params.receivedCents
  const covered = received >= due
  return {
    dueCents: due,
    receivedCents: received,
    changeCents: covered ? received - due : 0n,
    shortfallCents: covered ? 0n : due - received,
    covered,
  }
}
