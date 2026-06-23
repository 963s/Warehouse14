/**
 * print/capabilities — the honest answer to "what can this device actually do
 * with a receipt or a label?", resolved at runtime, with no heavy native dep.
 *
 * The Owner OS print story has exactly two tiers, and this module makes the
 * boundary between them explicit so the UI never overpromises:
 *
 *   1. SYSTEM PRINT + PDF (available now on iOS/Android/web). We render the
 *      document to self-contained HTML and hand it to the OS:
 *        • PRINT — `expo-print`'s `printAsync({ html })` opens the platform print
 *          dialog: AirPrint on iOS, the Android print framework on Android. From
 *          there the owner prints to any printer the OS knows (incl. AirPrint /
 *          Mopria network printers) or saves a PDF. One tap, no share detour.
 *        • PDF SHARE — `printToFileAsync({ html })` renders a real PDF into the
 *          cache, then `expo-sharing`'s `shareAsync` hands that PDF to the OS
 *          share sheet (Files, Mail, Drive, …). `expo-sharing` provides the
 *          `content://` FileProvider grant on Android, so the PDF share works on
 *          Android too — unlike the old core-RN `Share` file path, which could
 *          not. Both modules are Expo config-plugin modules autolinked at
 *          prebuild — no manual native code, no heavy dependency.
 *      This is real, shipping capability — not a stub.
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
import { Platform } from "react-native"

/** What the device can do with a printable, resolved once at module load. */
export interface PrintCapabilities {
  /**
   * The OS print dialog is reachable (`expo-print`). True on iOS (AirPrint),
   * Android (print framework) and web (browser print) when the module is
   * autolinked. This is the flag the surface uses to enable its PRIMARY action.
   */
  canPrintNative: boolean
  /**
   * We can render a PDF and hand it to the OS share sheet (`expo-print`'s
   * `printToFileAsync` + `expo-sharing`). True on iOS and Android — `expo-sharing`
   * supplies the `content://` FileProvider grant Android needs — and on web,
   * where it falls back to a download. This is the flag the SECONDARY "als PDF
   * teilen" action uses.
   */
  canSharePdf: boolean
  /** We can write a temp file for the PDF (expo-file-system present). */
  canWriteFile: boolean
  /**
   * A receipt/label can be produced + handed off RIGHT NOW, by EITHER printing
   * or sharing a PDF. The surface uses this to decide whether to show the action
   * cluster at all versus the honest "nothing available" note.
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

/** True when `expo-print`'s `printAsync` is importable on this platform. */
function detectPrint(): boolean {
  try {
    // Required lazily so a missing/unlinked module degrades to `false` instead
    // of a crash at import time. The module is autolinked at prebuild.
    const print = require("expo-print") as { printAsync?: unknown }
    return typeof print?.printAsync === "function"
  } catch {
    return false
  }
}

/** True when both PDF rendering (`expo-print`) and `expo-sharing` are present. */
function detectPdfShare(): boolean {
  try {
    const print = require("expo-print") as { printToFileAsync?: unknown }
    const sharing = require("expo-sharing") as { shareAsync?: unknown }
    return typeof print?.printToFileAsync === "function" && typeof sharing?.shareAsync === "function"
  } catch {
    return false
  }
}

/** True when expo-file-system's modern `File`/`Paths` API is importable. */
function detectFileSystem(): boolean {
  try {
    // `File` + `Paths` are the SDK 54+ API we use for cleanup of the rendered PDF.
    const fs = require("expo-file-system") as { File?: unknown; Paths?: unknown }
    return typeof fs?.File === "function" && typeof fs?.Paths !== "undefined"
  } catch {
    return false
  }
}

let cached: PrintCapabilities | null = null

/** Resolve (and memoize) the device's print capabilities. */
export function getPrintCapabilities(): PrintCapabilities {
  if (cached) return cached
  const canPrintNative = detectPrint()
  const canSharePdf = detectPdfShare()
  const canWriteFile = detectFileSystem()
  cached = {
    canPrintNative,
    canSharePdf,
    canWriteFile,
    // Either path counts as "can export": print to a printer/PDF, or share a PDF.
    canExportDocument: canPrintNative || canSharePdf,
    canPrintEscPos: false, // no native ESC/POS transport in this build honest.
    platform: Platform.OS,
  }
  return cached
}

/**
 * Reset the memoized capabilities. FOR TESTS ONLY — production resolves once.
 */
export function __resetPrintCapabilitiesForTest(): void {
  cached = null
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
    "Ein direkter Druck vom Telefon an einen dedizierten Thermo- oder " +
    "Etikettendrucker (Bluetooth oder Netzwerk) benötigt einen ESC/POS- bzw. " +
    "ZPL-Datenstrom über eine native Geräteverbindung. Das erfordert ein " +
    "zusätzliches natives Modul und einen eigenen App-Build und ist in dieser " +
    "Version bewusst nicht aktiv. Der zertifizierte Druck läuft weiterhin über " +
    "die Desktop-Kasse.",
  /** What the owner CAN do instead, today, from the phone. */
  alternative:
    "Beleg oder Etikett über die Drucken-Funktion an einen AirPrint- oder " +
    "Netzwerkdrucker senden oder als PDF teilen und sichern.",
} as const
