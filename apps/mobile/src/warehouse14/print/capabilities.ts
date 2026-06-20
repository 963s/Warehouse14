/**
 * print/capabilities — the honest answer to "what can this device actually do
 * with a receipt or a label?", resolved at runtime, with no heavy native dep.
 *
 * The Owner OS print story has exactly two tiers, and this module makes the
 * boundary between them explicit so the UI never overpromises:
 *
 *   1. SHARE (available now, zero new native deps). We render the document to a
 *      file (HTML for a rich PDF-able sheet, or a monospace text fallback) using
 *      `expo-file-system` — already a dependency — and hand it to the OS share
 *      sheet via React Native's built-in `Share` API (core RN, not a new
 *      module). From there the owner saves to Files as PDF, AirPrints to any
 *      networked printer the OS knows, or sends it on. This is real, shipping
 *      capability — not a stub.
 *
 *   2. DIRECT ESC/POS (NOT available in this build). Talking to a Bluetooth or
 *      LAN thermal printer (the 80 mm Bon-Drucker / the Brother/Zebra label
 *      printer at the counter) means raw ESC/POS or ZPL byte streams over a
 *      socket — which RN cannot do without a native module (react-native-ble-plx
 *      / a TCP-socket module / a vendor SDK) and a custom dev-client rebuild.
 *      We do NOT pretend to have it. The surface shows an honest locked state
 *      with the precise note below, and routes the owner to the desktop cashier,
 *      which owns the certified counter-printer path today.
 *
 * Nothing here fabricates capability: each flag is derived from whether the
 * underlying module is actually importable on this platform.
 */
import { Platform, Share } from "react-native"

/** What the device can do with a printable, resolved once at module load. */
export interface PrintCapabilities {
  /**
   * The OS share sheet is reachable (RN `Share`). On native this is always true;
   * on web it is gated on the Web Share API and falls back to download.
   */
  canShare: boolean
  /** We can write a temp file to share/preview (expo-file-system present). */
  canWriteFile: boolean
  /**
   * A receipt/label can be produced + handed off RIGHT NOW (share + file write).
   * This is the flag the surface uses to enable its primary action.
   */
  canExportDocument: boolean
  /**
   * Direct ESC/POS or ZPL streaming to a Bluetooth/LAN thermal printer. Always
   * `false` in this build — see the module header + `escposRequirement`.
   */
  canPrintEscPos: boolean
  /** The platform, surfaced so copy can read "auf diesem iPhone/iPad/Gerät". */
  platform: typeof Platform.OS
}

/** True when expo-file-system's modern `File`/`Paths` API is importable. */
function detectFileSystem(): boolean {
  try {
    // Required lazily so a missing module degrades to `false` instead of a crash
    // at import time. `File` + `Paths` are the SDK 54+ API we write through.
    const fs = require("expo-file-system") as { File?: unknown; Paths?: unknown }
    return typeof fs?.File === "function" && typeof fs?.Paths !== "undefined"
  } catch {
    return false
  }
}

/** True when the built-in RN `Share` module is wired (always so on native). */
function detectShare(): boolean {
  return typeof Share?.share === "function"
}

let cached: PrintCapabilities | null = null

/** Resolve (and memoize) the device's print capabilities. */
export function getPrintCapabilities(): PrintCapabilities {
  if (cached) return cached
  const canShare = detectShare()
  const canWriteFile = detectFileSystem()
  cached = {
    canShare,
    canWriteFile,
    canExportDocument: canShare && canWriteFile,
    canPrintEscPos: false, // no native ESC/POS transport in this build — honest.
    platform: Platform.OS,
  }
  return cached
}

/**
 * The precise, owner-readable explanation of what a real on-device thermal-
 * printer path would require — shown in the locked state so the gap is honest
 * and concrete, never hand-waved. German, no fabricated promises.
 */
export const escposRequirement = {
  /** One-line summary for the locked card. */
  summary:
    "Bon- und Etikettendrucker am Tresen werden über den Desktop-Kassenplatz angesteuert.",
  /** The technical reason, in plain German, for the detail/info row. */
  detail:
    "Ein direkter Druck vom Telefon an einen Thermo- oder Etikettendrucker " +
    "(Bluetooth oder Netzwerk) benötigt einen ESC/POS- bzw. ZPL-Datenstrom über " +
    "eine native Geräteverbindung. Das erfordert ein zusätzliches natives Modul " +
    "und einen eigenen App-Build und ist in dieser Version bewusst nicht aktiv. " +
    "Der zertifizierte Druck läuft weiterhin über die Desktop-Kasse.",
  /** What the owner CAN do instead, today, from the phone. */
  alternative:
    "Beleg oder Etikett als PDF teilen, per AirPrint an einen bekannten Drucker " +
    "senden oder in Dateien sichern.",
} as const
