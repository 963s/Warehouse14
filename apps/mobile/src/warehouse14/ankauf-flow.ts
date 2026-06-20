/**
 * ankauf-flow — the buy-in (Ankauf) intake model: the lot of items being bought,
 * the live precious-metal valuation hint, the GwG/KYC gate decision, the header
 * payout total, and the exact `AnkaufBody` the fiscal route consumes.
 *
 * It is the Ankauf counterpart of `sell/verkauf-flow.ts`, but the two money paths
 * are deliberately DIFFERENT (ADR day8-domain-decision §15.2):
 *   • Verkauf SELLS existing reserved stock (RESERVED→SOLD, VAT-bearing cart).
 *   • Ankauf BUYS NEW items in — each line becomes a freshly created product, the
 *     payout is cash OUT, and the buy-in itself bears no output VAT (the §25a
 *     margin is taxed later, on resale). So the header total is a plain Σ of the
 *     negotiated prices — no tax decomposition — and the line shape is the wire
 *     `AnkaufLineItem`, not the sell `CartLine`.
 *
 * Honesty rules this module obeys (DESIGN.md + the Owner OS fiscal doctrine):
 *   • The valuation hint (Schmelzwert + suggested buy) is a SUGGESTION derived
 *     from real server metal rates; it pre-fills nothing it cannot compute and
 *     returns null when a rate is missing — never a fabricated number.
 *   • The KYC gate mirrors the server's authoritative BEFORE-INSERT trigger
 *     (`transactions_validate_kyc`): an ANKAUF requires a KYC-verified seller for
 *     EVERY buy from €0,01 (hard §259 StGB Hehlerei rule, no threshold). The gate
 *     here only SURFACES that truth early; the server is the un-bypassable
 *     authority. The §10 GwG windowed aggregate is preserved for the banner copy.
 *   • All money is bigint-cents (mirrors intake-math / cart-math discipline):
 *     HALF_EVEN rounding, German-comma tolerant, no JS-number arithmetic.
 *
 * It performs NO network call and fires NO payout — the screen composes the
 * FiscalConfirmSheet over `transactionsApi.ankauf` for that. This keeps the
 * Ankauf screen a thin, declarative composition over a tested pure core.
 */
import { useCallback, useMemo, useState } from "react"
import type {
  AnkaufCondition,
  AnkaufItemType,
  AnkaufLineItem,
  AnkaufMetal,
  AnkaufPayoutMethod,
  CustomerDetail,
  MetalRate,
  TaxTreatmentCode,
} from "@warehouse14/api-client"

import { generateAnkaufSku } from "./ankauf-ui"
import { fromCents, newIdempotencyKey, roundHalfEven, tryToCents } from "./sell"

// ────────────────────────────────────────────────────────────────────────────
// GwG threshold (§10) — for the windowed-aggregate banner copy ONLY
// ────────────────────────────────────────────────────────────────────────────

/**
 * The §10 GwG identity threshold (€2.000), in cents. For ANKAUF the single-buy
 * rule already trips at €0,01 (§259 StGB), so this threshold is used ONLY to
 * decide whether the customer's PRIOR rolling-window buys have crossed the §10
 * linked-transaction line — context for the banner, never the gate itself.
 */
export const GWG_THRESHOLD_CENTS = 200_000n

// ────────────────────────────────────────────────────────────────────────────
// Intake line — the editable draft, plus the wire item it builds
// ────────────────────────────────────────────────────────────────────────────

/**
 * One item in the buy-in lot. A superset of the wire `AnkaufLineItem`: it adds a
 * stable client id (for list keys + removal) and keeps every field as the
 * operator typed it. `negotiatedPriceEur` is the cash actually paid for THIS item
 * and becomes its locked acquisition cost server-side.
 */
export interface IntakeLine {
  /** Stable client-only id (list key + removal). */
  id: string
  sku: string
  itemType: AnkaufItemType
  metal: AnkaufMetal | null
  karatCode: string
  finenessDecimal: string
  weightGrams: string
  condition: AnkaufCondition
  taxTreatmentCode: TaxTreatmentCode
  name: string
  descriptionDe: string
  /** Resale list price (≥ 0). */
  listPriceEur: string
  /** Cash paid for this item (> 0). Becomes acquisition_cost_eur. */
  negotiatedPriceEur: string
  /** TRUE → product AVAILABLE on insert; FALSE → DRAFT (photo workflow first). */
  publishImmediately: boolean
}

/** A fresh, mostly-empty intake line with sensible buy-in defaults. */
export function emptyIntakeLine(): IntakeLine {
  return {
    id: makeLineId(),
    sku: generateAnkaufSku(),
    itemType: "gold_jewelry",
    metal: "gold",
    karatCode: "",
    finenessDecimal: "",
    weightGrams: "",
    condition: "USED_GOOD",
    taxTreatmentCode: "MARGIN_25A",
    name: "",
    descriptionDe: "",
    listPriceEur: "",
    negotiatedPriceEur: "",
    publishImmediately: false,
  }
}

/**
 * A fresh intake line id. It is a UUIDv4 (not a readable slug) ON PURPOSE: the
 * Ankauf route validates `clientReferenceId` as `format: 'uuid'` and echoes it
 * back on each created product, so this one value doubles as the React list key
 * AND the wire correlation id — letting the response's createdProducts be matched
 * back to the line that produced them with no separate mapping.
 */
function makeLineId(): string {
  return newIdempotencyKey()
}

/**
 * Validate a draft line for the minimum the server demands: a name, a positive
 * paid price, and a non-negative list price. Returns the offending field key (for
 * inline highlighting) or null when the line is complete.
 */
export function validateIntakeLine(line: IntakeLine): keyof IntakeLine | null {
  if (line.name.trim().length === 0) return "name"
  const paid = tryToCents(line.negotiatedPriceEur)
  if (paid == null || paid <= 0n) return "negotiatedPriceEur"
  const list = tryToCents(line.listPriceEur)
  if (line.listPriceEur.trim().length === 0 || list == null || list < 0n) return "listPriceEur"
  return null
}

/**
 * Turn a complete draft line into the exact wire `AnkaufLineItem`. Empty optional
 * strings collapse to `undefined` so the body carries only meaningful fields. The
 * `clientReferenceId` is the draft's stable id, so the response's createdProducts
 * can be matched back to the line that produced them.
 */
export function lineToAnkaufItem(line: IntakeLine): AnkaufLineItem {
  const trimmed = (s: string): string | undefined => {
    const v = s.trim()
    return v.length > 0 ? v : undefined
  }
  return {
    sku: line.sku.trim(),
    itemType: line.itemType,
    ...(line.metal ? { metal: line.metal } : {}),
    karatCode: trimmed(line.karatCode),
    // weightGrams + finenessDecimal are OPTIONAL + informational at intake (the
    // server does not re-price from them). They carry the server's exact decimal
    // patterns, so we send them ONLY when they match — a comma value or an
    // over-precise scale read is omitted rather than triggering a 400, never
    // silently rounded into a different number the operator did not type.
    finenessDecimal: matchOrUndefined(line.finenessDecimal, FINENESS_PATTERN),
    weightGrams: matchOrUndefined(line.weightGrams, MONEY_PATTERN),
    condition: line.condition,
    taxTreatmentCode: line.taxTreatmentCode,
    name: line.name.trim(),
    descriptionDe: trimmed(line.descriptionDe),
    // Money fields are normalized comma→dot so a German-typed "7,98" is sent as
    // the "7.98" the DecimalString pattern accepts (validateIntakeLine already
    // proved they parse). The header total is re-summed from the same cents.
    listPriceEur: normalizeMoney(line.listPriceEur),
    negotiatedPriceEur: normalizeMoney(line.negotiatedPriceEur),
    publishImmediately: line.publishImmediately,
    clientReferenceId: line.id,
  }
}

/** Server DecimalString — non-negative, ≤2 fractional digits (NUMERIC(18,2)). */
const MONEY_PATTERN = /^\d{1,16}(\.\d{1,2})?$/
/** Server FinenessString — one leading digit, ≤4 fractional digits (NUMERIC(5,4)). */
const FINENESS_PATTERN = /^\d(\.\d{1,4})?$/

/** Comma→dot a money string and render it back from cents so it is ≤2 dp. */
function normalizeMoney(input: string): string {
  return fromCents(tryToCents(input) ?? 0n)
}

/** Return the comma-normalized value only when it matches `pattern`, else undefined. */
function matchOrUndefined(input: string, pattern: RegExp): string | undefined {
  const v = input.trim().replace(",", ".")
  if (v.length === 0) return undefined
  return pattern.test(v) ? v : undefined
}

// ────────────────────────────────────────────────────────────────────────────
// Valuation hint — Schmelzwert (melt) + suggested buy (mirror of intake-math)
// ────────────────────────────────────────────────────────────────────────────

/** Parse a decimal string to an integer scaled by 10^decimals, comma-tolerant. */
function parseScaled(s: string, decimals: number): bigint | null {
  const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.trim()
  if (!/^\d+(\.\d+)?$/.test(n)) return null
  const [whole = "0", frac = ""] = n.split(".")
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals)
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || "0")
}

/**
 * Schmelzwert (melt value) for ONE item:
 *   value = weight_grams × fineness_decimal × price_per_gram
 * All math in scaled-integer space (4 decimals each) then rounded HALF_EVEN to
 * cents. Returns null when any input is missing or unparseable (no fake 0).
 */
export function schmelzwertCents(input: {
  weightGrams: string
  finenessDecimal: string
  pricePerGramEur: string | null
}): bigint | null {
  if (!input.pricePerGramEur) return null
  const weight = parseScaled(input.weightGrams, 4)
  const fineness = parseScaled(input.finenessDecimal, 4)
  const price = parseScaled(input.pricePerGramEur, 4)
  if (weight == null || fineness == null || price == null) return null
  // result_cents = (weight × fineness × price) / (10_000 × 10_000 × 100)
  const numerator = weight * fineness * price
  const denominator = 10_000n * 10_000n * 100n
  return roundHalfEven(numerator, denominator)
}

export interface ValuationHint {
  /** Gross melt value in cents (weight × fineness × spot), or null. */
  meltCents: bigint | null
  /** Suggested buy price in cents, or null when no rate is available. */
  suggestedCents: bigint | null
  /** Which basis produced the suggestion. */
  basis: "ankauf" | "margin" | "none"
}

/**
 * The live valuation hint for a draft line, given the server's per-metal rate.
 * Prefers the margin-baked `ankaufRatePerGramEur` (basis "ankauf"); falls back to
 * spot × (1 − safetyMargin) (basis "margin"); yields nulls when no rate exists
 * (basis "none"). The melt is always the GROSS spot value (for the operator's
 * reference). NEVER a fabricated number — a missing rate means a missing hint.
 */
export function valuationHint(params: {
  metal: AnkaufMetal | null
  weightGrams: string
  finenessDecimal: string
  rate: MetalRate | null
}): ValuationHint {
  const { metal, weightGrams, finenessDecimal, rate } = params
  if (metal == null || rate == null) {
    return { meltCents: null, suggestedCents: null, basis: "none" }
  }
  const meltCents = schmelzwertCents({
    weightGrams,
    finenessDecimal,
    pricePerGramEur: rate.currentPricePerGramEur,
  })

  // Preferred: the server's margin-baked buy rate.
  const ankaufCents = schmelzwertCents({
    weightGrams,
    finenessDecimal,
    pricePerGramEur: rate.ankaufRatePerGramEur,
  })
  if (ankaufCents != null) {
    return { meltCents, suggestedCents: ankaufCents, basis: "ankauf" }
  }

  // Fallback: spot × (1 − safetyMargin).
  if (meltCents != null) {
    const marginScaled = BigInt(Math.round(rate.safetyMarginPct * 10_000))
    const suggested = roundHalfEven(meltCents * (10_000n - marginScaled), 10_000n)
    return { meltCents, suggestedCents: suggested, basis: "margin" }
  }

  return { meltCents, suggestedCents: null, basis: "none" }
}

// ────────────────────────────────────────────────────────────────────────────
// Header total — plain Σ of the negotiated prices (no VAT on a buy-in)
// ────────────────────────────────────────────────────────────────────────────

/** Sum the lot's negotiated payout into header cents. Unparseable lines count 0. */
export function sumNegotiatedCents(lines: readonly IntakeLine[]): bigint {
  let total = 0n
  for (const l of lines) {
    total += tryToCents(l.negotiatedPriceEur) ?? 0n
  }
  return total
}

// ────────────────────────────────────────────────────────────────────────────
// KYC gate — mirror of the server's authoritative ANKAUF rule
// ────────────────────────────────────────────────────────────────────────────

export interface KycGateDecision {
  /** A customer is selected at all. */
  hasCustomer: boolean
  /** The selected customer already carries a KYC verification stamp. */
  kycVerified: boolean
  /**
   * Payout is BLOCKED until KYC is stamped: a customer is selected but not yet
   * verified. For ANKAUF this is true for ANY positive buy (§259 StGB — no
   * threshold); the server trigger refuses the payout regardless.
   */
  blocked: boolean
  /** The customer's prior in-window ANKAUF sum has crossed §10 (banner context). */
  aggregateReached: boolean
}

/**
 * Evaluate the buy-in KYC gate from the selected customer + the cart total. The
 * §10 aggregate (prior window + current) is computed only for the banner; the
 * BLOCK itself is the §259 rule (verified seller required for every buy).
 */
export function evaluateAnkaufKyc(params: {
  customer: CustomerDetail | null
  totalCents: bigint
}): KycGateDecision {
  const { customer, totalCents } = params
  const hasCustomer = customer != null
  const kycVerified = customer?.kycVerifiedAt != null
  // §259 StGB: an ANKAUF needs a verified seller for any buy from €0,01.
  const blocked = hasCustomer && !kycVerified && totalCents > 0n

  const priorCents = customer?.gwgRollingAnkauf
    ? (tryToCents(customer.gwgRollingAnkauf.priorAnkaufEur) ?? 0n)
    : 0n
  const current = totalCents > 0n ? totalCents : 0n
  const aggregateReached = hasCustomer && priorCents + current >= GWG_THRESHOLD_CENTS

  return { hasCustomer, kycVerified, blocked, aggregateReached }
}

// ────────────────────────────────────────────────────────────────────────────
// The hook — the editable intake lot
// ────────────────────────────────────────────────────────────────────────────

export interface UseAnkaufLot {
  /** The committed lines in the lot (each a completed item). */
  lines: readonly IntakeLine[]
  /** Header payout total, in cents. */
  totalCents: bigint
  /** True when the lot has no lines yet. */
  isEmpty: boolean
  /** Append a completed line to the lot. */
  addLine: (line: IntakeLine) => void
  /** Remove a line by its client id. */
  removeLine: (id: string) => void
  /** Clear the whole lot (after a payout, or an explicit reset). */
  clear: () => void
}

/** The intake lot: the list of bought-in items + the derived payout total. */
export function useAnkaufLot(): UseAnkaufLot {
  const [lines, setLines] = useState<readonly IntakeLine[]>([])

  const addLine = useCallback((line: IntakeLine) => {
    setLines((prev) => [...prev, line])
  }, [])

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const totalCents = useMemo(() => sumNegotiatedCents(lines), [lines])

  return {
    lines,
    totalCents,
    isEmpty: lines.length === 0,
    addLine,
    removeLine,
    clear,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Build the AnkaufBody — the exact wire payload for transactionsApi.ankauf
// ────────────────────────────────────────────────────────────────────────────

export interface BuildAnkaufParams {
  customerId: string
  lines: readonly IntakeLine[]
  payoutMethod: AnkaufPayoutMethod
  /** Required for BANK_TRANSFER; refused for CASH. */
  payoutExternalRef?: string
  notesInternal?: string
  /** At-most-once dedup key (newIdempotencyKey, one per sheet-open). */
  idempotencyKey: string
}

/**
 * Assemble the exact `AnkaufBody`. The total is the Σ of the line negotiated
 * prices (rendered back from cents so it matches the server's own sum byte-for-
 * byte). The external ref rides along ONLY for BANK_TRANSFER (the route refuses
 * it for CASH). Notes are included only when present.
 */
export function buildAnkaufBody(params: BuildAnkaufParams): {
  customerId: string
  payoutMethod: AnkaufPayoutMethod
  payoutExternalRef?: string
  totalEur: string
  notesInternal?: string
  items: AnkaufLineItem[]
  idempotencyKey: string
} {
  const totalEur = fromCents(sumNegotiatedCents(params.lines))
  const items = params.lines.map(lineToAnkaufItem)
  const externalRef = params.payoutExternalRef?.trim()
  const notes = params.notesInternal?.trim()
  return {
    customerId: params.customerId,
    payoutMethod: params.payoutMethod,
    ...(params.payoutMethod === "BANK_TRANSFER" && externalRef
      ? { payoutExternalRef: externalRef }
      : {}),
    totalEur,
    ...(notes ? { notesInternal: notes } : {}),
    items,
    idempotencyKey: params.idempotencyKey,
  }
}
