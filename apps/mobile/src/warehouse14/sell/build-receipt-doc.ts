/**
 * build-receipt-doc — turn a derived cart + tender + the SERVER's finalize result
 * into the `ReceiptDoc` the Print abstraction renders + shares. This is the
 * one bridge between the pure cart model and a shareable, human-readable Beleg
 * (PDF via the OS share sheet / AirPrint), so the Verkauf-Beleg screen can offer
 * a print/share action right after a sale seals.
 *
 * It is the receipt sibling of `build-finalize`: where that produces the wire
 * body the server re-validates, this produces the PREVIEW document the owner
 * shares. Both read the SAME `cart-math` cents, so the shared copy matches the
 * confirm sheet and the booked sale line-for-line — nothing is fabricated.
 *
 * Honesty: every EUR string comes from real summed cents via `fromCents`; the
 * Beleg number + the issued timestamp come from the server's FinalizeResponse,
 * never invented. A field with no real value (a shop name we don't hold, a
 * footer not loaded) is omitted rather than guessed — the ReceiptDoc renderer
 * already degrades on absence.
 */
import type { PaymentMethod } from "@warehouse14/api-client"

import { fromCents } from "./cart-math"
import type { CartTotals } from "./cart"
import { PAYMENT_METHOD_LABELS, TAX_TREATMENT_LONG, formatVatRate } from "./labels"
import type { ReceiptDoc, ReceiptLine, ReceiptVatRow } from "../print/types"

export interface BuildReceiptDocParams {
  /** The derived cart totals at the moment of finalize (the real lines + math). */
  totals: CartTotals
  /** "Verkauf" | "Ankauf" — drives the headline + total caption. Default Verkauf. */
  kind?: "Verkauf" | "Ankauf"
  /** The server-issued Beleg number from the finalize response. */
  receiptLocator: string
  /** ISO timestamp the server stamped on the sealed sale (finalizedAt). */
  issuedAt?: string
  /** Configured shop name for the head; omitted when the surface has none. */
  shopName?: string | null
  /**
   * How the customer paid. CASH carries the received + change cents so the Beleg
   * shows the drawer split; a cashless tender shows just the method label.
   */
  payment?: { method: PaymentMethod; receivedCents?: bigint; changeCents?: bigint }
  /** Live legal Belegtext footer (from belegtextApi); omitted when not loaded. */
  belegtext?: string | null
}

/** Map the cart's derived line views to printable `ReceiptLine`s (cents → EUR). */
function toReceiptLines(totals: CartTotals): ReceiptLine[] {
  return totals.lines.map((l) => {
    const line: ReceiptLine = {
      name: l.name,
      totalEur: fromCents(l.math.lineTotalCents),
    }
    if (l.qty > 1) line.qty = l.qty
    if (l.sku) line.sku = l.sku
    return line
  })
}

/**
 * Map the per-Steuerschlüssel VAT groups to printable rows with their full legal
 * label. A rate-less scheme (§25a/§25c) prints its scheme name, not a "0 %".
 */
function toVatRows(totals: CartTotals): ReceiptVatRow[] {
  return totals.vatGroups.map((g) => {
    const pct = formatVatRate(g.appliedVatRate)
    const label = pct
      ? `${TAX_TREATMENT_LONG[g.taxTreatmentCode]} (${pct})`
      : TAX_TREATMENT_LONG[g.taxTreatmentCode]
    return { label, vatEur: fromCents(g.vatCents) }
  })
}

/**
 * Assemble a shareable `ReceiptDoc` from the sealed sale. The total + subtotal +
 * VAT all come from the cart's real cents (so the shared copy equals the booked
 * sale), while the Beleg number + issued timestamp ride in from the server's
 * finalize response. Optional fields (shop name, footer, change) are omitted
 * when not present rather than guessed.
 */
export function buildReceiptDoc(params: BuildReceiptDocParams): ReceiptDoc {
  const { totals, kind = "Verkauf", receiptLocator, issuedAt, shopName, payment, belegtext } =
    params

  const doc: ReceiptDoc = {
    kind,
    receiptLocator,
    lines: toReceiptLines(totals),
    subtotalEur: fromCents(totals.header.subtotalCents),
    vatRows: toVatRows(totals),
    totalEur: fromCents(totals.header.totalCents),
  }

  if (shopName) doc.shopName = shopName
  if (issuedAt) doc.issuedAt = issuedAt
  if (belegtext) doc.belegtext = belegtext

  if (payment) {
    const p: NonNullable<ReceiptDoc["payment"]> = {
      methodLabel: PAYMENT_METHOD_LABELS[payment.method],
    }
    if (payment.receivedCents != null) p.receivedEur = fromCents(payment.receivedCents)
    // Only print a change row when there is genuine change to give back.
    if (payment.changeCents != null && payment.changeCents > 0n) {
      p.changeEur = fromCents(payment.changeCents)
    }
    doc.payment = p
  }

  return doc
}
