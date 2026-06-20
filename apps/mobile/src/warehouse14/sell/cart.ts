/**
 * cart — the direction-agnostic cart model for the Owner OS sell spine.
 *
 * One pure reducer + a `useCart` hook drive BOTH money paths:
 *   • Verkauf (finalize): sell items OUT — lines reference real products and a
 *     reservation session; the cart total is what the customer pays.
 *   • Ankauf (intake): buy items IN — lines describe items being purchased; the
 *     cart total is what the shop pays out.
 *
 * The model holds lines, each carrying its own Steuerschlüssel + prices, and
 * derives live totals through `cart-math` (server-faithful bigint cents). It
 * does NOT call the network and does NOT format money — surfaces format the
 * derived cents via `formatCents` and submit via the api-client. Keeping the
 * cart pure is what lets the Verkauf and Ankauf screens share one spine.
 */
import { useMemo, useReducer } from "react"
import type { TaxTreatmentCode } from "@warehouse14/api-client"

import {
  computeLineMath,
  groupVat,
  lineForQuantity,
  sumHeaderCents,
  type HeaderTotalsCents,
  type LineMath,
  type VatGroup,
} from "./cart-math"

// ────────────────────────────────────────────────────────────────────────────
// Line model
// ────────────────────────────────────────────────────────────────────────────

/**
 * One cart line as the operator built it — the raw inputs, not the math. The
 * math is derived (never stored) so a price/qty/discount edit always recomputes
 * from the source of truth.
 */
export interface CartLine {
  /** Stable client-side id (the product id for Verkauf, a generated id for Ankauf). */
  id: string
  /** Display name for the row + receipt. */
  name: string
  /** Optional SKU / serial shown in mono under the name. */
  sku?: string | null
  /** Quantity (≥ 1). Serialized inventory is always 1; consumables can be > 1. */
  qty: number
  /** Unit list price in EUR decimal string (what one unit costs the customer). */
  listPriceEur: string
  /** Acquisition cost in EUR decimal string — required for §25a margin VAT. */
  acquisitionCostEur: string
  /** Steuerschlüssel governing this line's VAT. */
  taxTreatmentCode: TaxTreatmentCode
  /** Optional per-line Rabatt in EUR (clamped to the list price by the math). */
  discountEur?: string
  /** Optional reason for the Rabatt — the DB CHECK requires it when discount > 0. */
  discountReason?: string | null
  /** Verkauf only: the reservation session releasing this product RESERVED→SOLD. */
  reservationSessionId?: string
}

/** A line plus its derived math + position — what the UI and receipt render. */
export interface CartLineView extends CartLine {
  math: LineMath
  displayOrder: number
}

// ────────────────────────────────────────────────────────────────────────────
// State + actions
// ────────────────────────────────────────────────────────────────────────────

export interface CartState {
  lines: CartLine[]
}

export type CartAction =
  | { type: "add"; line: CartLine }
  | { type: "remove"; id: string }
  | { type: "setQty"; id: string; qty: number }
  | { type: "incQty"; id: string; delta: number }
  | { type: "setPrice"; id: string; listPriceEur: string }
  | { type: "setDiscount"; id: string; discountEur: string; discountReason?: string | null }
  | { type: "setTaxTreatment"; id: string; taxTreatmentCode: TaxTreatmentCode }
  | { type: "clear" }

export const emptyCart: CartState = { lines: [] }

function patchLine(
  state: CartState,
  id: string,
  patch: (line: CartLine) => CartLine,
): CartState {
  let changed = false
  const lines = state.lines.map((l) => {
    if (l.id !== id) return l
    changed = true
    return patch(l)
  })
  return changed ? { lines } : state
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "add": {
      // Re-adding the same id bumps quantity instead of duplicating the row
      // (a consumable scanned twice). Serialized items are added once.
      const existing = state.lines.find((l) => l.id === action.line.id)
      if (existing) {
        return patchLine(state, action.line.id, (l) => ({ ...l, qty: l.qty + action.line.qty }))
      }
      return { lines: [...state.lines, action.line] }
    }
    case "remove":
      return { lines: state.lines.filter((l) => l.id !== action.id) }
    case "setQty":
      return patchLine(state, action.id, (l) => ({
        ...l,
        qty: Math.max(1, Math.trunc(action.qty)),
      }))
    case "incQty":
      return patchLine(state, action.id, (l) => ({
        ...l,
        qty: Math.max(1, l.qty + Math.trunc(action.delta)),
      }))
    case "setPrice":
      return patchLine(state, action.id, (l) => ({ ...l, listPriceEur: action.listPriceEur }))
    case "setDiscount":
      return patchLine(state, action.id, (l) => ({
        ...l,
        discountEur: action.discountEur,
        discountReason: action.discountReason ?? l.discountReason ?? null,
      }))
    case "setTaxTreatment":
      return patchLine(state, action.id, (l) => ({
        ...l,
        taxTreatmentCode: action.taxTreatmentCode,
      }))
    case "clear":
      return emptyCart
    default:
      return state
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Derivation — the live math the UI and receipt read
// ────────────────────────────────────────────────────────────────────────────

export interface CartTotals {
  lines: CartLineView[]
  header: HeaderTotalsCents
  vatGroups: VatGroup[]
  /** Total unit count across lines. */
  itemCount: number
  /** True when there is nothing to ring up. */
  isEmpty: boolean
}

/** Derive the full cart math from raw lines — pure, memoizable. */
export function deriveCart(state: CartState): CartTotals {
  const views: CartLineView[] = state.lines.map((line, i) => {
    const unit = computeLineMath({
      taxTreatmentCode: line.taxTreatmentCode,
      listPriceEur: line.listPriceEur,
      acquisitionCostEur: line.acquisitionCostEur,
      discountEur: line.discountEur,
    })
    return { ...line, math: lineForQuantity(unit, line.qty), displayOrder: i }
  })

  const header = sumHeaderCents(views.map((v) => v.math))
  const vatGroups = groupVat(
    views.map((v) => ({ ...v.math, taxTreatmentCode: v.taxTreatmentCode })),
  )
  const itemCount = state.lines.reduce((n, l) => n + Math.max(1, Math.trunc(l.qty)), 0)

  return { lines: views, header, vatGroups, itemCount, isEmpty: views.length === 0 }
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

export interface UseCart {
  state: CartState
  totals: CartTotals
  add: (line: CartLine) => void
  remove: (id: string) => void
  setQty: (id: string, qty: number) => void
  incQty: (id: string, delta: number) => void
  setPrice: (id: string, listPriceEur: string) => void
  setDiscount: (id: string, discountEur: string, discountReason?: string | null) => void
  setTaxTreatment: (id: string, code: TaxTreatmentCode) => void
  clear: () => void
  dispatch: React.Dispatch<CartAction>
}

/** The cart hook every sell surface uses — reducer state + the derived totals. */
export function useCart(initial: CartState = emptyCart): UseCart {
  const [state, dispatch] = useReducer(cartReducer, initial)
  const totals = useMemo(() => deriveCart(state), [state])
  return {
    state,
    totals,
    add: (line) => dispatch({ type: "add", line }),
    remove: (id) => dispatch({ type: "remove", id }),
    setQty: (id, qty) => dispatch({ type: "setQty", id, qty }),
    incQty: (id, delta) => dispatch({ type: "incQty", id, delta }),
    setPrice: (id, listPriceEur) => dispatch({ type: "setPrice", id, listPriceEur }),
    setDiscount: (id, discountEur, discountReason) =>
      dispatch({ type: "setDiscount", id, discountEur, discountReason }),
    setTaxTreatment: (id, code) => dispatch({ type: "setTaxTreatment", id, taxTreatmentCode: code }),
    clear: () => dispatch({ type: "clear" }),
    dispatch,
  }
}
