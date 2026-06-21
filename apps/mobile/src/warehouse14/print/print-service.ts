/**
 * print-service — the side-effecting layer of the Print abstraction: take a
 * `Printable`, render it (render-html) and hand it to the OS, with no heavy
 * native dep and no fabricated capability. Two real, shipping paths:
 *
 *   • printPrintable()    — render to HTML and open the platform print dialog
 *     (`expo-print`): AirPrint on iOS, the Android print framework on Android.
 *     One tap → the owner picks a printer (incl. networked AirPrint/Mopria) or
 *     "Save as PDF". This is the PRIMARY action; it replaces the old two-tap
 *     share-only flow.
 *   • sharePdfPrintable() — render the HTML to a real PDF file
 *     (`expo-print.printToFileAsync`) and hand that PDF to the OS share sheet
 *     (`expo-sharing`). Works on iOS AND Android (expo-sharing supplies the
 *     `content://` grant Android needs). This is the SECONDARY "als PDF teilen".
 *
 * Direct ESC/POS streaming to a counter thermal printer is intentionally NOT
 * here — see `capabilities.ts`. Each path is gated on `getPrintCapabilities()`
 * and degrades honestly to a typed outcome, never a thrown surprise: the surface
 * switches on `ok` / `dismissed` / `unsupported` / `error` and shows the right
 * state. Raw native/English exception text is NEVER surfaced — the owner always
 * gets one clean German line.
 */
import { File, Paths } from "expo-file-system"

import { getPrintCapabilities, type PrintCapabilities } from "./capabilities"
import { renderHtml } from "./render-html"
import type { Printable } from "./types"

export type PrintOutcome =
  /** The print/share completed (the dialog opened and finished). */
  | { status: "ok" }
  /** The dialog opened and the user dismissed it (not an error). */
  | { status: "dismissed" }
  /** Printing/sharing isn't available on this device. */
  | { status: "unsupported"; reason: string }
  /** Something failed; `message` is a German, owner-readable line. */
  | { status: "error"; message: string }

/** A short, filesystem-safe base name for a generated PDF file. */
function fileBase(printable: Printable): string {
  if (printable.type === "receipt") {
    const loc = printable.doc.receiptLocator
    return loc
      ? `beleg-${loc.replace(/[^a-zA-Z0-9-]/g, "")}`
      : `${printable.doc.kind.toLowerCase()}-vorschau`
  }
  return printable.docs.length === 1
    ? `etikett-${(printable.docs[0]?.sku ?? "").replace(/[^a-zA-Z0-9-]/g, "")}`
    : `etiketten-${printable.docs.length}`
}

/**
 * Print width in CSS pixels for the rendered page. The receipt is an 80 mm Bon
 * column (≈ 226 px at 72 PPI), so we constrain it; labels tile on a full Letter
 * sheet, so we let `expo-print` use its default Letter width.
 */
function printWidth(printable: Printable): number | undefined {
  return printable.type === "receipt" ? 226 : undefined
}

/**
 * The honest, owner-readable reason a path is off. Distinguishes the cases so the
 * line is never misleading.
 */
function unsupportedReason(caps: PrintCapabilities, want: "print" | "pdf"): string {
  if (want === "print" && !caps.canPrintNative) {
    return "Auf diesem Gerät ist das Drucken nicht verfügbar."
  }
  if (want === "pdf" && !caps.canSharePdf) {
    return "Auf diesem Gerät ist das Teilen als PDF nicht verfügbar."
  }
  return "Auf diesem Gerät ist diese Funktion nicht verfügbar."
}

/**
 * Open the platform print dialog on `printable` (AirPrint / Android print
 * framework). One tap; the OS handles printer selection and "Save as PDF".
 *
 * On iOS the promise resolves once printing starts and REJECTS if the user
 * closes the dialog without printing → we map that rejection to `dismissed`,
 * never an error. On Android the promise resolves as soon as the dialog shows.
 */
export async function printPrintable(printable: Printable): Promise<PrintOutcome> {
  const caps = getPrintCapabilities()
  if (!caps.canPrintNative) {
    return { status: "unsupported", reason: unsupportedReason(caps, "print") }
  }

  let printAsync: (opts: { html: string; width?: number }) => Promise<void>
  try {
    // Lazy import so a device without the module degrades via the capability
    // gate above rather than crashing at module load.
    ;({ printAsync } = require("expo-print") as {
      printAsync: (opts: { html: string; width?: number }) => Promise<void>
    })
  } catch {
    return { status: "unsupported", reason: unsupportedReason(caps, "print") }
  }

  const html = renderHtml(printable)
  try {
    await printAsync({ html, width: printWidth(printable) })
    return { status: "ok" }
  } catch {
    // iOS rejects when the print window is closed without printing. We treat
    // that as a normal dismissal — never surface the raw native error text.
    return { status: "dismissed" }
  }
}

/**
 * Render `printable` to a real PDF and open the OS share sheet on it
 * (`expo-print.printToFileAsync` + `expo-sharing`). Works on iOS and Android.
 */
export async function sharePdfPrintable(
  printable: Printable,
  opts: { dialogTitle?: string } = {},
): Promise<PrintOutcome> {
  const caps = getPrintCapabilities()
  if (!caps.canSharePdf) {
    return { status: "unsupported", reason: unsupportedReason(caps, "pdf") }
  }

  let printToFileAsync: (o: { html: string; width?: number }) => Promise<{ uri: string }>
  let shareAsync: (
    url: string,
    o?: { mimeType?: string; UTI?: string; dialogTitle?: string },
  ) => Promise<void>
  let isAvailableAsync: () => Promise<boolean>
  try {
    ;({ printToFileAsync } = require("expo-print") as {
      printToFileAsync: (o: { html: string; width?: number }) => Promise<{ uri: string }>
    })
    ;({ shareAsync, isAvailableAsync } = require("expo-sharing") as {
      shareAsync: (
        url: string,
        o?: { mimeType?: string; UTI?: string; dialogTitle?: string },
      ) => Promise<void>
      isAvailableAsync: () => Promise<boolean>
    })
  } catch {
    return { status: "unsupported", reason: unsupportedReason(caps, "pdf") }
  }

  // The runtime confirmation that the share sheet is reachable on this device.
  try {
    if (!(await isAvailableAsync())) {
      return { status: "unsupported", reason: unsupportedReason(caps, "pdf") }
    }
  } catch {
    return { status: "unsupported", reason: unsupportedReason(caps, "pdf") }
  }

  const html = renderHtml(printable)
  let pdfFile: File
  try {
    const result = await printToFileAsync({ html, width: printWidth(printable) })
    // Rename the rendered PDF to a friendly, owner-readable name ("beleg-…​.pdf")
    // so it shows up sensibly in Files/Mail rather than as a random hash.
    pdfFile = renameToFriendly(new File(result.uri), `${fileBase(printable)}-${stamp()}.pdf`)
  } catch {
    return {
      status: "error",
      message: "Die PDF-Vorschau konnte nicht erstellt werden. Bitte erneut versuchen.",
    }
  }

  try {
    await shareAsync(pdfFile.uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: opts.dialogTitle ?? "Beleg als PDF teilen",
    })
    return { status: "ok" }
  } catch {
    // The OS share sheet threw. The raw exception text is an English / system
    // string, so we NEVER surface it — the owner gets one clean German line.
    return {
      status: "error",
      message: "Das Teilen konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
    }
  } finally {
    // Best-effort cleanup of the rendered PDF; the OS may still be reading it,
    // so failures are fine — the cache directory is reclaimable anyway.
    try {
      if (pdfFile.exists) pdfFile.delete()
    } catch {
      // ignore — the cache directory is reclaimable by the OS.
    }
  }
}

/** A unique-enough suffix so two exports in the same second don't collide. */
function stamp(): string {
  return Date.now().toString(36)
}

/**
 * Move a freshly rendered PDF to a friendly name in the cache directory so it
 * shares as "beleg-….pdf" rather than a random hash. Best-effort: if the move
 * fails for any reason we share the original file untouched.
 */
function renameToFriendly(rendered: File, friendlyName: string): File {
  try {
    const target = new File(Paths.cache, friendlyName)
    if (target.exists) target.delete()
    rendered.move(target)
    return target
  } catch {
    return rendered
  }
}
