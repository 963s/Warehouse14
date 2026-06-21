/**
 * print-service — the side-effecting layer of the Print abstraction: take a
 * `Printable`, render it (render-html), write it to a cache file
 * (expo-file-system), and hand it to the OS share sheet (RN `Share`). No heavy
 * native dep; no fabricated capability — every path here is gated on
 * `getPrintCapabilities()` and degrades honestly.
 *
 * From the share sheet the owner can: save to Files as PDF, AirPrint to any
 * printer the OS knows, or send the document on. Direct ESC/POS streaming to a
 * counter thermal printer is intentionally NOT here — see `capabilities.ts`.
 *
 * The result is a typed outcome, never a thrown surprise: the surface switches
 * on `ok` / `dismissed` / `unsupported` / `error` and shows the right state.
 */
import { Share } from "react-native"
import { File, Paths } from "expo-file-system"

import { getPrintCapabilities, type PrintCapabilities } from "./capabilities"
import { renderHtml, renderText } from "./render-html"
import type { Printable } from "./types"

/** What kind of file to produce + share. */
export type PrintFormat = "html" | "text"

export type ShareResult =
  /** The sheet opened and the user shared/saved. */
  | { status: "ok" }
  /** The sheet opened and the user dismissed it (not an error). */
  | { status: "dismissed" }
  /** Sharing/file-writing isn't available on this device. */
  | { status: "unsupported"; reason: string }
  /** Something failed; `message` is a German, owner-readable line. */
  | { status: "error"; message: string }

/** A short, filesystem-safe base name for the temp file. */
function fileBase(printable: Printable): string {
  if (printable.type === "receipt") {
    const loc = printable.doc.receiptLocator
    return loc ? `beleg-${loc.replace(/[^a-zA-Z0-9_-]/g, "")}` : `${printable.doc.kind.toLowerCase()}-vorschau`
  }
  return printable.docs.length === 1 ? `etikett-${(printable.docs[0]?.sku ?? "").replace(/[^a-zA-Z0-9_-]/g, "")}` : `etiketten-${printable.docs.length}`
}

const MIME: Record<PrintFormat, string> = {
  html: "text/html",
  text: "text/plain",
}

/** A unique-enough suffix so two shares in the same second don't collide. */
function stamp(): string {
  return Date.now().toString(36)
}

/**
 * The honest, owner-readable reason document export is off — distinguishing the
 * three blocked cases so the line is never misleading (e.g. it must not claim
 * "kein Dateispeicher" on Android, where the real gap is the share path).
 */
function unsupportedReason(caps: PrintCapabilities): string {
  if (!caps.canShare) {
    return "Auf diesem Gerät ist das Teilen nicht verfügbar."
  }
  if (!caps.canWriteFile) {
    return "Auf diesem Gerät ist kein Dateispeicher für die Vorschau verfügbar."
  }
  // Share + file write exist, but the share sheet won't take the file (Android).
  return (
    "Das Teilen von Dokumenten wird auf diesem Gerät nicht unterstützt. " +
    "Bitte über den Desktop-Kassenplatz drucken."
  )
}

/**
 * Render `printable` to a cache file and open the OS share sheet on it.
 *
 * @param printable the receipt or labels to produce
 * @param opts.format html (rich, PDF-able) or text (universal). Default html.
 * @param opts.dialogTitle Android share-sheet title.
 */
export async function sharePrintable(
  printable: Printable,
  opts: { format?: PrintFormat; dialogTitle?: string } = {},
): Promise<ShareResult> {
  const caps = getPrintCapabilities()
  if (!caps.canExportDocument) {
    return { status: "unsupported", reason: unsupportedReason(caps) }
  }

  const format = opts.format ?? "html"
  const content = format === "html" ? renderHtml(printable) : renderText(printable)
  const ext = format === "html" ? "html" : "txt"
  const name = `${fileBase(printable)}-${stamp()}.${ext}`

  let file: File | null = null
  try {
    file = new File(Paths.cache, name)
    // Overwrite defensively in the (vanishingly unlikely) name-collision case.
    if (file.exists) file.delete()
    file.create()
    file.write(content)
  } catch {
    return {
      status: "error",
      message: "Die Vorschau konnte nicht erstellt werden. Bitte erneut versuchen.",
    }
  }

  try {
    const res = await Share.share(
      { url: file.uri, title: shareTitle(printable) },
      { dialogTitle: opts.dialogTitle ?? "Beleg teilen", subject: shareTitle(printable) },
    )
    if (res.action === Share.dismissedAction) return { status: "dismissed" }
    return { status: "ok" }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Das Teilen wurde abgebrochen."
    return { status: "error", message }
  } finally {
    // Best-effort cleanup; the OS may still be reading it, so failures are fine.
    try {
      file?.delete()
    } catch {
      // ignore — the cache directory is reclaimable by the OS anyway.
    }
  }
}

/** The human title shown in the share sheet / as the email subject. */
function shareTitle(printable: Printable): string {
  if (printable.type === "receipt") {
    const { kind, receiptLocator } = printable.doc
    return receiptLocator ? `${kind} · Beleg ${receiptLocator}` : `${kind} · Vorschau`
  }
  const n = printable.docs.length
  return n === 1 ? "Etikett" : `${n} Etiketten`
}
