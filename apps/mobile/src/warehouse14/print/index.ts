/**
 * Warehouse14 Owner OS — the Print abstraction.
 *
 * The clean, no-heavy-native-dep print/share spine for receipts + labels. It has
 * two honest tiers (see capabilities.ts):
 *
 *   • SHARE — render a receipt/label to a file and hand it to the OS share sheet
 *     (RN `Share` + expo-file-system, both already present). From there the
 *     owner saves a PDF, AirPrints, or sends it. This ships today.
 *   • DIRECT ESC/POS — streaming to a Bluetooth/LAN thermal printer. NOT in this
 *     build (needs a native transport + a custom dev-client). The surface shows
 *     an honest locked state pointing at the desktop cashier, with the precise
 *     requirement spelled out — never a fabricated capability.
 *
 *   types          — ReceiptDoc / LabelDoc / Printable (decimal-EUR-string docs).
 *   capabilities   — runtime capability detection + the ESC/POS requirement copy.
 *   render-html    — pure HTML (PDF-able) + monospace-text renderers.
 *   print-service  — sharePrintable(): write a temp file + open the share sheet.
 *   PrintPreview   — the on-screen, native preview that mirrors the printed doc.
 */
export type {
  ReceiptLine,
  ReceiptVatRow,
  ReceiptDoc,
  LabelDoc,
  Printable,
} from "./types"

export {
  getPrintCapabilities,
  escposRequirement,
  type PrintCapabilities,
} from "./capabilities"

export { renderHtml, renderText } from "./render-html"

export {
  sharePrintable,
  type PrintFormat,
  type ShareResult,
} from "./print-service"

export { PrintPreview, type PrintPreviewProps } from "./PrintPreview"
