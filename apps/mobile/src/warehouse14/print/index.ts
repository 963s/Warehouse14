/**
 * Warehouse14 Owner OS — the Print abstraction.
 *
 * The clean print/share spine for receipts + labels, built on Expo config-plugin
 * modules (autolinked at prebuild — no heavy native dep). It has two honest tiers
 * (see capabilities.ts):
 *
 *   • SYSTEM PRINT + PDF — render a receipt/label to HTML and hand it to the OS:
 *     `printPrintable()` opens the platform print dialog (AirPrint on iOS, the
 *     Android print framework on Android) for a one-tap print or "Save as PDF";
 *     `sharePdfPrintable()` renders a real PDF and shares it via `expo-sharing`
 *     (iOS + Android). This ships today.
 *   • DIRECT ESC/POS — streaming to a Bluetooth/LAN thermal printer. NOT in this
 *     build (needs a native transport + a custom dev-client). The surface shows
 *     an honest locked state pointing at the desktop cashier, with the precise
 *     requirement spelled out — never a fabricated capability.
 *
 *   types          — ReceiptDoc / LabelDoc / Printable (decimal-EUR-string docs).
 *   capabilities   — runtime capability detection + the ESC/POS requirement copy.
 *   render-html    — pure HTML (PDF-able) + monospace-text renderers.
 *   print-service  — printPrintable() + sharePdfPrintable(): print / share a PDF.
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
  printPrintable,
  sharePdfPrintable,
  type PrintOutcome,
} from "./print-service"

export { PrintPreview, type PrintPreviewProps } from "./PrintPreview"
