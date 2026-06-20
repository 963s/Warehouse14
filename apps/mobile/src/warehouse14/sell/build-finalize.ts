/**
 * build-finalize — turn a derived cart + tender into the EXACT wire bodies the
 * fiscal endpoints accept. This is the one bridge between the pure cart model
 * and `transactionsApi.finalize` / `transactionsApi.ankauf`. It produces no
 * money of its own: every EUR string here comes from `cart-math` cents via
 * `fromCents`, so the server's Decimal.js re-validation (transaction-math.ts)
 * agrees line-for-line and the at-most-once `idempotencyKey` rides along.
 *
 * Nothing here fires a request — the surface calls the api-client with the body
 * this returns, behind the fiscal-confirm sheet + step-up. Keeping the build
 * pure means the receipt preview and the actual submit see the SAME numbers.
 */
import type {
  FinalizeBody,
  FinalizeLineItem,
  FinalizePayment,
  PaymentMethod,
  TaxTreatmentCode,
} from "@warehouse14/api-client"

import { fromCents } from "./cart-math"
import type { CartTotals } from "./cart"

/**
 * The header Steuerschlüssel: the single code when the whole basket shares one,
 * otherwise MIXED (the server stores per-line codes; the header is a summary).
 */
export function headerTaxTreatment(totals: CartTotals): TaxTreatmentCode {
  const codes = new Set(totals.lines.map((l) => l.taxTreatmentCode))
  if (codes.size === 1) {
    const [only] = [...codes]
    return only as TaxTreatmentCode
  }
  return "MIXED"
}

/** Map the cart's derived line views to server `FinalizeLineItem`s (cents → EUR). */
function toFinalizeItems(totals: CartTotals): FinalizeLineItem[] {
  return totals.lines.map((l) => {
    const m = l.math
    const item: FinalizeLineItem = {
      productId: l.id,
      // The reservation session releasing this product RESERVED→SOLD. Empty
      // string is a deliberate caller error caught upstream; we never invent one.
      reservationSessionId: l.reservationSessionId ?? "",
      lineSubtotalEur: fromCents(m.lineSubtotalCents),
      lineVatEur: fromCents(m.lineVatCents),
      lineTotalEur: fromCents(m.lineTotalCents),
      appliedTaxTreatmentCode: l.taxTreatmentCode,
      appliedVatRate: m.appliedVatRate,
      acquisitionCostEurSnapshot:
        m.acquisitionCostSnapshotCents === null ? null : fromCents(m.acquisitionCostSnapshotCents),
      marginEur: m.marginCents === null ? null : fromCents(m.marginCents),
      displayOrder: l.displayOrder,
    }
    // Rabatt is GoBD-reported separately; the DB CHECK requires a reason when > 0.
    if (m.lineDiscountCents > 0n) {
      item.lineDiscountEur = fromCents(m.lineDiscountCents)
      item.lineDiscountReason = l.discountReason ?? null
    }
    return item
  })
}

export interface BuildFinalizeParams {
  totals: CartTotals
  customerId: string | null
  /** One UUIDv4 per Bezahlen sheet open — sent unchanged on every retry. */
  idempotencyKey: string
  /** How the customer paid. A single tender covers the full total in V1. */
  payment: { method: PaymentMethod; amountEur?: string; externalRef?: string }
  notesInternal?: string
}

/**
 * Assemble a Verkauf `FinalizeBody` from the derived cart + tender. The payment
 * amount defaults to the exact header total (the cash leg's change is handled at
 * the drawer, not on the wire), so Σ payments = total as the server requires.
 */
export function buildFinalizeBody(params: BuildFinalizeParams): FinalizeBody {
  const { totals, customerId, idempotencyKey, payment, notesInternal } = params
  const totalEur = fromCents(totals.header.totalCents)

  const tender: FinalizePayment = {
    paymentMethod: payment.method,
    amountEur: payment.amountEur ?? totalEur,
  }
  if (payment.externalRef) tender.externalRef = payment.externalRef

  const body: FinalizeBody = {
    direction: "VERKAUF",
    customerId,
    subtotalEur: fromCents(totals.header.subtotalCents),
    vatEur: fromCents(totals.header.vatCents),
    totalEur,
    taxTreatmentCode: headerTaxTreatment(totals),
    items: toFinalizeItems(totals),
    payments: [tender],
    idempotencyKey,
  }
  if (notesInternal) body.notesInternal = notesInternal
  return body
}
