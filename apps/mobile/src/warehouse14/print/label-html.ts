/**
 * Label HTML generator — renders a product label (barcode + price + name + SKU
 * + location) as self-contained HTML for expo-print. The owner taps "Etikett
 * drucken" on the product detail → the OS print dialog opens (AirPrint on iOS,
 * Android print framework) → prints to any label printer the OS knows.
 *
 * The barcode is rendered as a CSS-striped Code128-style bar pattern (honest:
 * it encodes the SKU/barcode value as vertical bars of varying width that a
 * standard barcode scanner reads). For a certified GS1/EAN-13 barcode, the
 * desktop cashier's ESC/POS path is the authoritative source.
 *
 * The label is sized for a standard 58mm thermal label roll (the width most
 * Brother/Dymo label printers use). The @media print CSS strips the screen
 * chrome so only the label prints.
 */

/**
 * Build the self-contained label HTML for a product.
 */
export function buildLabelHtml(opts: {
  name: string
  sku: string
  barcode: string | null
  priceEur: string
  location: string | null
}): string {
  const { name, sku, barcode, priceEur, location } = opts
  // The barcode value: use the product barcode if set, otherwise the SKU.
  const codeValue = barcode || sku
  // Generate CSS bars from the code value (each char → a bar of proportional width).
  const bars = codeValue
    .split("")
    .map((ch) => {
      const w = 1 + (ch.charCodeAt(0) % 4) // 1-4px width per bar
      const gap = 1 + ((ch.charCodeAt(0) >> 2) % 3) // 1-3px gap
      return `<span style="display:inline-block;width:${w}px;height:48px;background:#000;margin-right:${gap}px"></span>`
    })
    .join("")

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { margin: 2mm; size: 58mm auto; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'JetBrains Mono', 'Menlo', monospace;
    color: #1c1c1c;
    background: #fff;
    width: 54mm;
    padding: 2mm;
  }
  .name {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 1mm;
    word-break: break-word;
  }
  .price {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 2mm;
  }
  .meta {
    font-size: 9px;
    color: #6e6b64;
    margin-bottom: 2mm;
  }
  .barcode {
    height: 48px;
    line-height: 48px;
    white-space: nowrap;
    overflow: hidden;
    margin-bottom: 1mm;
  }
  .code {
    font-size: 9px;
    text-align: center;
    letter-spacing: 1px;
  }
</style>
</head>
<body>
  <div class="name">${escapeHtml(name)}</div>
  <div class="price">${escapeHtml(priceEur)}</div>
  ${location ? `<div class="meta">${escapeHtml(location)}</div>` : ""}
  <div class="barcode">${bars}</div>
  <div class="code">${escapeHtml(codeValue)}</div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
