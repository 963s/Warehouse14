/**
 * print/types — the document shapes the Print abstraction renders + shares.
 *
 * These are PREVIEW documents, not the legal Beleg. The TSE/Belegtext on the
 * server owns the legally-binding receipt; what we render here is a faithful,
 * human-readable copy the owner can save as PDF, AirPrint, or send from the
 * share sheet. Every field is a real value the caller already holds (a finalized
 * receipt locator, a real product's sku/price) — nothing is fabricated.
 *
 * Money is carried as DECIMAL EUR STRINGS ("12.90"), the same shape the read
 * endpoints emit, so the caller never has to convert; the renderer formats them
 * de-DE. A field is omitted (left undefined) rather than guessed.
 */

/** One printed line on a receipt (a sold/bought article or a fee row). */
export interface ReceiptLine {
  /** Article name (already resolved, German). */
  name: string
  /** Quantity; omitted renders as a single unit. */
  qty?: number
  /** Optional article number shown under the name. */
  sku?: string | null
  /** Line total as a decimal EUR string ("24.90"). */
  totalEur: string
}

/** One per-Steuerschlüssel VAT row in the receipt's tax breakdown. */
export interface ReceiptVatRow {
  /** Full legal label ("Regelsteuersatz 19%", "Differenzbesteuerung §25a UStG"). */
  label: string
  /** VAT amount as a decimal EUR string. */
  vatEur: string
}

/**
 * A receipt-shaped document — the Verkauf/Ankauf preview. Reuses the same
 * vocabulary the on-screen `ReceiptPreview` shows, so the printed copy and the
 * confirm sheet match line-for-line.
 */
export interface ReceiptDoc {
  /** "Verkauf" | "Ankauf" — drives the headline + the total caption. */
  kind: "Verkauf" | "Ankauf"
  /** Configured shop name for the head; omitted when the surface has none. */
  shopName?: string
  /** The real, server-issued Beleg number once finalized; omitted on a draft. */
  receiptLocator?: string | null
  /** ISO timestamp of the receipt; omitted falls back to "now" at render. */
  issuedAt?: string
  lines: ReceiptLine[]
  /** Net subtotal as a decimal EUR string. */
  subtotalEur?: string
  vatRows?: ReceiptVatRow[]
  /** Grand total / payout as a decimal EUR string. */
  totalEur: string
  /** Payment method label ("Bar", "EC-/Kreditkarte") + the cash split, when known. */
  payment?: {
    methodLabel: string
    receivedEur?: string
    changeEur?: string
  }
  /** Live legal Belegtext footer (from belegtextApi); omitted when not loaded. */
  belegtext?: string | null
}

/**
 * A single article label — a price/shelf tag for the storefront or a drawer.
 * Every field is a real column on `ProductListRow`; the barcode is printed as
 * its human digits (we do NOT fabricate a scannable barcode image — that needs a
 * barcode font/encoder the desktop label path owns; see the locked state note).
 */
export interface LabelDoc {
  /** Article name (German). */
  name: string
  /** Stock-keeping unit — the internal article number. */
  sku: string
  /** EAN/UPC barcode digits, when the product has one; omitted otherwise. */
  barcode?: string | null
  /** List price as a decimal EUR string ("199.00"). */
  priceEur: string
  /** Optional Lagerort line (storage · drawer · position) for a drawer tag. */
  location?: string | null
  /** Optional short condition/metal note ("Gold 585 · sehr gut"). */
  note?: string | null
}

/** The thing a print job carries to the renderer. */
export type Printable =
  | { type: "receipt"; doc: ReceiptDoc }
  | { type: "labels"; docs: LabelDoc[] }
