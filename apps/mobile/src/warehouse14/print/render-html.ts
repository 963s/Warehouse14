/**
 * print/render-html — the PURE renderers that turn a `Printable` into a
 * self-contained HTML document (PDF-able via the OS) and a monospace text
 * fallback. No DOM, no React, no native calls — just strings, so this is unit-
 * testable and shared by both the share path and the on-screen preview's "view
 * source" affordance.
 *
 * Design notes:
 *   • The receipt is laid out for an 80 mm Bon roll (the counter format) but
 *     reflows fine on A4/Letter when AirPrinted — a single narrow column.
 *   • Labels tile onto a printable sheet (auto-fit grid) so a batch of price
 *     tags prints in one pass.
 *   • All money is formatted de-DE through the shared `Money` helper so the
 *     printed copy matches the app exactly. Dates are de-DE too.
 *   • Everything user-supplied is HTML-escaped — a product name with an `&` or
 *     `<` can never break the document.
 *
 * Honesty: the renderer prints only what the doc carries. A missing subtotal,
 * VAT row, or Belegtext is omitted, never invented. The receipt is clearly
 * marked a Vorschau/Kopie unless a real `receiptLocator` is present.
 */
import { Money } from "@warehouse14/domain/money"

import { lightPalette } from "@/warehouse14/theme"

import type { LabelDoc, Printable, ReceiptDoc } from "./types"

// ── Print colours, SOURCED from the antique theme (DESIGN.md §0) ──────────────
// A printed Bon is a fixed artifact: warm antique ink on white paper, with the
// fine gold hairline. So we read the LIGHT palette tokens ONCE here and inline
// the resulting values into the self-contained document below — no raw brand
// hex is hardcoded in the template. `PAPER` is the one non-brand value: it is
// the physical white of a Bon roll / PDF sheet, NOT the cream app canvas, so it
// is intentionally not a palette token.
const INK = lightPalette.foreground // warm antique ink matches the app foreground
const MUTED = lightPalette.mutedForeground // faded ink captions / meta
const HAIRLINE = lightPalette.border // fine warm-gold rule
const PAPER = "#ffffff" // white Bon roll / PDF, not the cream app canvas

/** Escape the five HTML-significant characters in any interpolated value. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Format a decimal EUR string ("12.90") as de-DE EUR ("12,90 €"). */
function eur(value: string): string {
  return Money.of(value, "EUR").format()
}

/** Format an ISO timestamp (or now) as a de-DE date+time. */
function dateTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ── Shared print CSS ─────────────────────────────────────────────────────────
// Kept inline so the document is fully self-contained (the share/PDF target has
// no network). Mono for figures so columns align like a real Bon.
const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: ${INK}; /* warm antique ink matches the app foreground */
    background: ${PAPER}; /* white: a Bon roll / PDF, not the cream app canvas */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .mono { font-family: "SFMono-Regular", "Menlo", "Consolas", monospace; }
  @media print { @page { margin: 8mm; } }
`

/** Wrap a body fragment in a complete, standalone HTML document. */
function htmlDocument(title: string, bodyCss: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${BASE_CSS}${bodyCss}</style>
</head><body>${body}</body></html>`
}

// ── Receipt → HTML ───────────────────────────────────────────────────────────

const RECEIPT_CSS = `
  .receipt { width: 76mm; max-width: 100%; margin: 0 auto; padding: 4mm 2mm; }
  .receipt .head { text-align: center; margin-bottom: 6px; }
  .receipt .shop { font-size: 15px; font-weight: 700; }
  .receipt .kind { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: ${MUTED}; }
  .receipt .meta { font-size: 10px; color: ${MUTED}; text-align: center; }
  .receipt hr { border: none; border-top: 1px dashed ${HAIRLINE}; margin: 6px 0; }
  .receipt .row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; align-items: baseline; }
  .receipt .row .name { flex: 1; }
  .receipt .row .sku { font-size: 10px; color: ${MUTED}; }
  .receipt .row .amt { white-space: nowrap; }
  .receipt .muted { color: ${MUTED}; font-size: 11px; }
  .receipt .total { font-weight: 700; font-size: 14px; }
  .receipt .legal { font-size: 9px; color: ${MUTED}; line-height: 1.45; margin-top: 8px; }
`

function receiptHtml(doc: ReceiptDoc): string {
  const totalCaption = doc.kind === "Ankauf" ? "Auszahlung gesamt" : "Gesamt"
  const stamp = doc.receiptLocator
    ? `Beleg-Nr. ${esc(doc.receiptLocator)}`
    : `${esc(doc.kind)} · Vorschau`

  const lines = doc.lines
    .map((l) => {
      const qty = l.qty && l.qty > 1 ? `${l.qty}× ` : ""
      const sku = l.sku ? `<div class="sku mono">${esc(l.sku)}</div>` : ""
      return `<div class="row"><div class="name">${qty}${esc(l.name)}${sku}</div><div class="amt mono">${eur(
        l.totalEur,
      )}</div></div>`
    })
    .join("")

  const subtotal = doc.subtotalEur
    ? `<div class="row muted"><div class="name">Zwischensumme (netto)</div><div class="amt mono">${eur(
        doc.subtotalEur,
      )}</div></div>`
    : ""

  const vat = (doc.vatRows ?? [])
    .map(
      (v) =>
        `<div class="row muted"><div class="name">${esc(v.label)}</div><div class="amt mono">${eur(
          v.vatEur,
        )}</div></div>`,
    )
    .join("")

  const payment = doc.payment
    ? [
        `<div class="row muted"><div class="name">Zahlungsart</div><div class="amt">${esc(
          doc.payment.methodLabel,
        )}</div></div>`,
        doc.payment.receivedEur
          ? `<div class="row muted"><div class="name">Erhalten</div><div class="amt mono">${eur(
              doc.payment.receivedEur,
            )}</div></div>`
          : "",
        doc.payment.changeEur
          ? `<div class="row muted"><div class="name">Rückgeld</div><div class="amt mono">${eur(
              doc.payment.changeEur,
            )}</div></div>`
          : "",
      ].join("")
    : ""

  const legal = doc.belegtext ? `<div class="legal">${esc(doc.belegtext)}</div>` : ""

  const body = `<div class="receipt">
    <div class="head">
      ${doc.shopName ? `<div class="shop">${esc(doc.shopName)}</div>` : ""}
      <div class="kind">${stamp}</div>
    </div>
    <div class="meta">${dateTime(doc.issuedAt)}</div>
    <hr />
    ${lines}
    <hr />
    ${subtotal}${vat}
    <div class="row total"><div class="name">${totalCaption}</div><div class="amt mono">${eur(
      doc.totalEur,
    )}</div></div>
    ${payment ? `<hr />${payment}` : ""}
    ${legal}
  </div>`

  const title = doc.receiptLocator ? `Beleg ${doc.receiptLocator}` : `${doc.kind} Vorschau`
  return htmlDocument(title, RECEIPT_CSS, body)
}

// ── Labels → HTML ────────────────────────────────────────────────────────────

const LABEL_CSS = `
  .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(48mm, 1fr)); gap: 4mm; padding: 4mm; }
  .label { border: 1px solid ${HAIRLINE}; border-radius: 6px; padding: 8px 10px; page-break-inside: avoid; }
  .label .name { font-size: 12px; font-weight: 600; line-height: 1.25; }
  .label .note { font-size: 10px; color: ${MUTED}; margin-top: 2px; }
  .label .price { font-size: 18px; font-weight: 700; margin-top: 6px; }
  .label .sku { font-size: 10px; color: ${MUTED}; margin-top: 6px; }
  .label .barcode { font-size: 11px; letter-spacing: .12em; margin-top: 2px; }
`

function labelCard(d: LabelDoc): string {
  return `<div class="label">
    <div class="name">${esc(d.name)}</div>
    ${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}
    <div class="price mono">${eur(d.priceEur)}</div>
    <div class="sku mono">Art-Nr. ${esc(d.sku)}</div>
    ${d.barcode ? `<div class="barcode mono">${esc(d.barcode)}</div>` : ""}
    ${d.location ? `<div class="sku mono">${esc(d.location)}</div>` : ""}
  </div>`
}

function labelsHtml(docs: LabelDoc[]): string {
  const cards = docs.map(labelCard).join("")
  const title = docs.length === 1 ? `Etikett ${docs[0]?.sku ?? ""}`.trim() : `${docs.length} Etiketten`
  return htmlDocument(title, LABEL_CSS, `<div class="sheet">${cards}</div>`)
}

/** Render any printable to a complete, standalone HTML document string. */
export function renderHtml(printable: Printable): string {
  return printable.type === "receipt" ? receiptHtml(printable.doc) : labelsHtml(printable.docs)
}

// ── Plain-text fallback ──────────────────────────────────────────────────────
// A monospace 32-column text version — the shape a Bon printer would emit and a
// universally shareable fallback. Not an ESC/POS byte stream (that needs the
// native transport we don't have), just clean text.

const WIDTH = 32

function padRow(left: string, right: string): string {
  const space = Math.max(1, WIDTH - left.length - right.length)
  if (left.length + right.length >= WIDTH) {
    return `${left}\n${" ".repeat(Math.max(0, WIDTH - right.length))}${right}`
  }
  return `${left}${" ".repeat(space)}${right}`
}

function center(text: string): string {
  if (text.length >= WIDTH) return text
  const pad = Math.floor((WIDTH - text.length) / 2)
  return `${" ".repeat(pad)}${text}`
}

function receiptText(doc: ReceiptDoc): string {
  const rule = "-".repeat(WIDTH)
  const out: string[] = []
  if (doc.shopName) out.push(center(doc.shopName))
  out.push(center(doc.receiptLocator ? `Beleg ${doc.receiptLocator}` : `${doc.kind} · Vorschau`))
  const dt = dateTime(doc.issuedAt)
  if (dt) out.push(center(dt))
  out.push(rule)
  for (const l of doc.lines) {
    const qty = l.qty && l.qty > 1 ? `${l.qty}x ` : ""
    out.push(padRow(`${qty}${l.name}`, eur(l.totalEur)))
    if (l.sku) out.push(`  ${l.sku}`)
  }
  out.push(rule)
  if (doc.subtotalEur) out.push(padRow("Zwischensumme", eur(doc.subtotalEur)))
  for (const v of doc.vatRows ?? []) out.push(padRow(v.label, eur(v.vatEur)))
  out.push(padRow(doc.kind === "Ankauf" ? "Auszahlung" : "Gesamt", eur(doc.totalEur)))
  if (doc.payment) {
    out.push(rule)
    out.push(padRow("Zahlart", doc.payment.methodLabel))
    if (doc.payment.receivedEur) out.push(padRow("Erhalten", eur(doc.payment.receivedEur)))
    if (doc.payment.changeEur) out.push(padRow("Rückgeld", eur(doc.payment.changeEur)))
  }
  if (doc.belegtext) {
    out.push(rule)
    out.push(doc.belegtext)
  }
  return out.join("\n")
}

function labelsText(docs: LabelDoc[]): string {
  return docs
    .map((d) => {
      const lines = [d.name, eur(d.priceEur), `Art-Nr. ${d.sku}`]
      if (d.barcode) lines.push(d.barcode)
      if (d.location) lines.push(d.location)
      if (d.note) lines.push(d.note)
      return lines.join("\n")
    })
    .join(`\n${"-".repeat(WIDTH)}\n`)
}

/** Render any printable to a monospace plain-text string. */
export function renderText(printable: Printable): string {
  return printable.type === "receipt" ? receiptText(printable.doc) : labelsText(printable.docs)
}
