/**
 * Label HTML generator — renders a product label (barcode + price + name + SKU
 * + location) as self-contained HTML for expo-print. The owner taps "Etikett
 * drucken" on the product detail → the OS print dialog opens (AirPrint on iOS,
 * Android print framework) → prints to any label printer the OS knows.
 *
 * The barcode is a REAL, scannable Code 128-B symbol of the product's barcode
 * (or its SKU as the fallback), drawn as inline SVG bars by the shared pure
 * encoder (./code128). Any 1-D scanner reads it. For a certified GS1/EAN-13
 * symbol, the desktop cashier's ESC/POS path remains the authoritative source.
 *
 * The label is sized for a standard 58mm thermal label roll (the width most
 * Brother/Dymo label printers use). The @media print CSS strips the screen
 * chrome so only the label prints.
 */
import { code128Svg } from "./code128"

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
  // A real, scannable Code 128-B symbol as inline SVG (shared pure encoder) —
  // stretched to the label width by the `.barcode svg` rule below.
  const barcodeSvg = code128Svg(codeValue, { height: 48, moduleWidth: 1.4 })

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
    margin-bottom: 1mm;
  }
  .barcode svg { display: block; width: 100%; height: 48px; }
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
  <div class="barcode">${barcodeSvg}</div>
  <div class="code">${escapeHtml(codeValue)}</div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
