/**
 * Belege / Dokumente — die geteilte Präsentationsschicht für das GoBD-Beleg-
 * register (deutsche Kategorie-Labels, Badge-Varianten, Dateigrößen- und
 * Integritäts-Formatierung, Verknüpfungs-Texte, Gruppierung + Sortierung). Die
 * Wahrheit über jedes Dokument lebt im Server: jede Zeile zeigt auf ein
 * unveränderliches Objekt (r2Key + sha256), das das Kassensystem beim Verkauf
 * oder Ankauf abgelegt hat. Dieses Modul ÜBERSETZT die Zeilen nur für die
 * Owner-UI und erfindet nichts — keine Dateigröße ohne echtes Byte-Feld, kein
 * „heruntergeladen", solange die App keinen Byte-Zugriff auf das Objekt hat.
 *
 * Reines, framework-freies Modul (keine React-Imports) — nur Daten + Mapper, so
 * wie whatsapp-ui.ts / ebay-ui.ts / ankauf-ui.ts. Die Bildschirme ziehen daraus.
 */
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentRow,
} from "@warehouse14/api-client"
import {
  type LucideIcon,
  BadgeCheck,
  FileText,
  IdCard,
  Receipt,
  ScrollText,
  Truck,
} from "lucide-react-native"

import type { BadgeProps } from "@/components/ui/badge"

export type BadgeVariant = NonNullable<BadgeProps["variant"]>

// Re-export the api-client's canonical German labels so the surface pulls one
// barrel (belege-ui) instead of reaching into the api-client for the value.
export { DOCUMENT_CATEGORY_LABELS }
export type { DocumentCategory, DocumentRow }

// ── Kategorie-Meta (Label + Icon + Badge-Variante, ehrlich neutral) ───────────
// Jede Kategorie bekommt ein ruhiges Icon und eine Badge-Variante. Wir färben
// NICHTS grün als „gut" oder rot als „schlecht" — ein Beleg ist ein Beleg; die
// Variante trennt nur optisch (z. B. die fiskalisch relevanten Rechnungen/
// Ankaufbelege als `default`-Brass von den Nachweisen als `secondary`). Der
// Ausweis-Scan ist `outline`, weil er ein sensibler KYC-Nachweis ist, der ruhig
// und unauffällig bleiben soll.

export interface CategoryMeta {
  category: DocumentCategory
  label: string
  icon: LucideIcon
  variant: BadgeVariant
  /** Ob die Kategorie ein fiskalisch/steuerlich relevanter Beleg ist (GoBD-Kern). */
  fiscal: boolean
  /** Eine ruhige Erklärzeile für die Kopf-/Filterhilfe. */
  hint: string
}

const CATEGORY_META: Readonly<Record<DocumentCategory, CategoryMeta>> = {
  RECHNUNG: {
    category: "RECHNUNG",
    label: DOCUMENT_CATEGORY_LABELS.RECHNUNG,
    icon: Receipt,
    variant: "default",
    fiscal: true,
    hint: "Verkaufsrechnungen der steuerlich relevante Ausgangsbeleg.",
  },
  ANKAUFBELEG: {
    category: "ANKAUFBELEG",
    label: DOCUMENT_CATEGORY_LABELS.ANKAUFBELEG,
    icon: ScrollText,
    variant: "default",
    fiscal: true,
    hint: "Ankaufbelege der Nachweis jeder Auszahlung an Verkäufer.",
  },
  VERSANDBELEG: {
    category: "VERSANDBELEG",
    label: DOCUMENT_CATEGORY_LABELS.VERSANDBELEG,
    icon: Truck,
    variant: "secondary",
    fiscal: false,
    hint: "Versandbelege Nachweis über den Versand verkaufter Stücke.",
  },
  EXPERTISE: {
    category: "EXPERTISE",
    label: DOCUMENT_CATEGORY_LABELS.EXPERTISE,
    icon: FileText,
    variant: "secondary",
    fiscal: false,
    hint: "Expertisen fachliche Begutachtung eines Stücks.",
  },
  ZERTIFIKAT: {
    category: "ZERTIFIKAT",
    label: DOCUMENT_CATEGORY_LABELS.ZERTIFIKAT,
    icon: BadgeCheck,
    variant: "secondary",
    fiscal: false,
    hint: "Zertifikate Echtheits- oder Herkunftsnachweis.",
  },
  AUSWEIS: {
    category: "AUSWEIS",
    label: DOCUMENT_CATEGORY_LABELS.AUSWEIS,
    icon: IdCard,
    variant: "outline",
    fiscal: false,
    hint: "Ausweis-Scans sensibler KYC-Nachweis nach Geldwäschegesetz.",
  },
}

export function categoryMeta(category: DocumentCategory): CategoryMeta {
  return CATEGORY_META[category]
}

export function categoryLabel(category: DocumentCategory): string {
  return CATEGORY_META[category].label
}

export function categoryIcon(category: DocumentCategory): LucideIcon {
  return CATEGORY_META[category].icon
}

export function categoryVariant(category: DocumentCategory): BadgeVariant {
  return CATEGORY_META[category].variant
}

/**
 * Die Kategorien in der Reihenfolge, in der die Filter-Segmente erscheinen:
 * die fiskalisch relevanten Belege zuerst (Rechnung, Ankaufbeleg), dann die
 * Nachweise, dann der sensible Ausweis-Scan zuletzt.
 */
export const CATEGORY_ORDER: readonly DocumentCategory[] = [
  "RECHNUNG",
  "ANKAUFBELEG",
  "VERSANDBELEG",
  "EXPERTISE",
  "ZERTIFIKAT",
  "AUSWEIS",
] as const

// ── Dateigröße (echte Bytes → lesbar; nie geschätzt) ──────────────────────────
// `sizeBytes` kommt als Dezimal-String (ein bigint auf dem Draht). Wir parsen
// ihn vorsichtig und formatieren in de-DE. Ist das Feld kein gültiger,
// nicht-negativer Wert, geben wir NULL zurück — die UI zeigt dann gar keine
// Größe statt einer erfundenen.

const UNITS = ["B", "KB", "MB", "GB"] as const

export function formatFileSize(sizeBytes: string | number | null | undefined): string | null {
  if (sizeBytes == null) return null
  const n = typeof sizeBytes === "number" ? sizeBytes : Number(sizeBytes)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 1) return "0 B"
  const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1)
  const value = n / Math.pow(1024, exp)
  // Bytes ganzzahlig, sonst eine Nachkommastelle in de-DE (Komma als Trenner).
  const formatted =
    exp === 0
      ? Math.round(value).toLocaleString("de-DE")
      : value.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 1 })
  return `${formatted} ${UNITS[exp]}`
}

// ── Integrität (sha256, ehrlich verkürzt) ─────────────────────────────────────
// Der Server speichert den sha256-Hash des Objekts (GoBD-Unveränderlichkeit).
// Wir zeigen eine verkürzte, monospaced Form als Vertrauens-Signal — nie als
// klickbaren Download. Fehlt der Hash, sagen wir das ehrlich (kein erfundener).

export function shortHash(sha256Hex: string | null): string | null {
  if (!sha256Hex) return null
  const hex = sha256Hex.trim().toLowerCase()
  if (hex.length < 12) return hex || null
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`
}

export function hasIntegrityHash(doc: DocumentRow): boolean {
  return typeof doc.sha256Hex === "string" && doc.sha256Hex.trim().length > 0
}

// ── Dateityp (aus dem MIME-Typ, nur ein ruhiges Kürzel) ───────────────────────
// Ein kurzes, gut lesbares Kürzel des Formats (PDF, JPG, …) aus dem mimeType.
// Rein kosmetisch für die Zeile; die echte Wahrheit bleibt der mimeType selbst.

export function fileKindLabel(mimeType: string): string {
  const m = mimeType.toLowerCase()
  if (m === "application/pdf") return "PDF"
  if (m === "image/jpeg") return "JPG"
  if (m === "image/png") return "PNG"
  if (m === "image/webp") return "WEBP"
  if (m === "image/heic" || m === "image/heif") return "HEIC"
  if (m === "text/csv") return "CSV"
  if (m.startsWith("image/")) return "Bild"
  const sub = m.split("/")[1]
  return sub ? sub.toUpperCase().slice(0, 6) : "Datei"
}

/** Ob das Dokument ein Bild ist (treibt das Vorschau-/Icon-Verhalten). */
export function isImage(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/")
}

// ── Verknüpfung (an welchen Vorgang der Beleg gepinnt ist) ─────────────────────
// Genau eine der vier Verknüpfungen ist gesetzt (der Server erzwingt das). Wir
// übersetzen sie in eine ruhige deutsche Zeile, damit der Owner sieht, woran der
// Beleg hängt, ohne die rohe ID lesen zu müssen.

export type DocumentLinkKind = "customer" | "product" | "transaction" | "appraisal" | "none"

export interface DocumentLink {
  kind: DocumentLinkKind
  /** Deutsches Label des Vorgangs, z. B. „Vorgang" / „Kunde". */
  label: string
  /** Die rohe ID (monospaced angezeigt), oder null bei „none". */
  id: string | null
}

const LINK_LABEL: Readonly<Record<DocumentLinkKind, string>> = {
  customer: "Kunde",
  product: "Artikel",
  transaction: "Vorgang",
  appraisal: "Bewertung",
  none: "Nicht verknüpft",
}

export function documentLink(doc: DocumentRow): DocumentLink {
  if (doc.transactionId) return { kind: "transaction", label: LINK_LABEL.transaction, id: doc.transactionId }
  if (doc.appraisalId) return { kind: "appraisal", label: LINK_LABEL.appraisal, id: doc.appraisalId }
  if (doc.customerId) return { kind: "customer", label: LINK_LABEL.customer, id: doc.customerId }
  if (doc.productId) return { kind: "product", label: LINK_LABEL.product, id: doc.productId }
  return { kind: "none", label: LINK_LABEL.none, id: null }
}

/** Eine kurze, ID-arme Referenz für die Zeile (z. B. „Vorgang · a1b2c3"). */
export function linkSummary(doc: DocumentRow): string {
  const link = documentLink(doc)
  if (link.id == null) return link.label
  const short = link.id.length > 8 ? link.id.slice(0, 8) : link.id
  return `${link.label} · ${short}`
}

// ── Sortierung + Gruppierung (neueste zuerst, je Kategorie) ───────────────────
// Die Liste zeigt die Belege neueste-zuerst (createdAt absteigend). Archivierte
// rutschen ans Ende (sie sind GoBD-soft-deleted, bleiben aber sichtbar, wenn der
// Owner sie einbezieht — wir verstecken nichts, sondern markieren).

export function sortDocuments(docs: ReadonlyArray<DocumentRow>): DocumentRow[] {
  return [...docs].sort((a, b) => {
    const aArch = a.archivedAt ? 1 : 0
    const bArch = b.archivedAt ? 1 : 0
    if (aArch !== bArch) return aArch - bArch
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export function isArchived(doc: DocumentRow): boolean {
  return doc.archivedAt != null
}

// ── Zählung (echte Summen aus echten Zeilen) ──────────────────────────────────
// Aus der Dokumentliste die Gesamtzahl, die Zahl der fiskalisch relevanten
// Belege und die Zahl der archivierten. Reine Reduktion — die Kopfzeile zeigt
// echte Zahlen oder den leeren Zustand, nie eine erfundene „0 als Erfolg".

export interface DocumentCounts {
  /** Gesamtzahl der (sichtbaren) Belege. */
  total: number
  /** Zahl der fiskalisch/steuerlich relevanten Belege (Rechnung + Ankaufbeleg). */
  fiscal: number
  /** Zahl der archivierten Belege. */
  archived: number
}

export function countDocuments(docs: ReadonlyArray<DocumentRow>): DocumentCounts {
  let fiscal = 0
  let archived = 0
  for (const d of docs) {
    if (CATEGORY_META[d.category].fiscal) fiscal += 1
    if (d.archivedAt) archived += 1
  }
  return { total: docs.length, fiscal, archived }
}

// ── Register-Übersicht (echte Summen, filter-unabhängig + Vollständigkeits-Wahrheit)
// Die Kopf-Kacheln und die „Alle"-/Kategorie-Chip-Zahlen DÜRFEN nicht aus der
// gefilterten oder abgeschnittenen Listen-Antwort kommen (sonst zeigt z. B. die
// „Alle"-Chip unter dem Filter „Rechnung" die Rechnungs-Zahl, oder die Kacheln
// unterzählen jenseits einer Seite). Stattdessen ziehen sie aus einer eigenen,
// filter-FREIEN Übersichts-Abfrage (alle Kategorien, inkl. archiviert):
//   • `total` ist die Server-Gesamtzahl — exakt in JEDER Registergröße.
//   • fiskalisch/archiviert/je-Kategorie werden aus den geladenen Zeilen
//     gezählt; das ist exakt, solange das Register auf eine Seite passt. Reicht
//     der Server mehr Zeilen als geladen (`truncated`), sind diese abgeleiteten
//     Teil-Summen nur untere Schranken — die UI zeigt sie dann ehrlich als
//     „mindestens" statt eine falsche genaue Zahl zu behaupten.

export interface RegisterSummary {
  /** Echte Server-Gesamtzahl aller Belege (filterfrei) — exakt bei jeder Größe. */
  total: number
  /** Aus den geladenen Zeilen gezählt (untere Schranke, wenn `truncated`). */
  fiscal: number
  /** Aus den geladenen Zeilen gezählt (untere Schranke, wenn `truncated`). */
  archived: number
  /** Anzahl je Kategorie (untere Schranke, wenn `truncated`). */
  byCategory: Readonly<Record<DocumentCategory, number>>
  /**
   * TRUE, wenn der Server mehr Belege hält, als wir für die Übersicht geladen
   * haben — dann sind alle aus Zeilen abgeleiteten Teil-Summen untere Schranken.
   * (Der `total` bleibt exakt, weil er die Server-Zählung ist.)
   */
  truncated: boolean
}

/**
 * Leitet die Register-Übersicht aus der filter-FREIEN Listen-Antwort ab. Erwartet
 * die rohen Felder der Antwort: die geladenen Zeilen, die Server-Gesamtzahl und
 * ob der Server mehr hält (`hasMore`).
 */
export function summarizeRegister(input: {
  items: ReadonlyArray<DocumentRow>
  total: number
  hasMore: boolean
}): RegisterSummary {
  const { fiscal, archived } = countDocuments(input.items)
  return {
    total: input.total,
    fiscal,
    archived,
    byCategory: countByCategory(input.items),
    truncated: input.hasMore,
  }
}

/** Anzahl je Kategorie — füttert die Zähler-Badges an den Filter-Segmenten. */
export function countByCategory(
  docs: ReadonlyArray<DocumentRow>,
): Readonly<Record<DocumentCategory, number>> {
  const counts: Record<DocumentCategory, number> = {
    RECHNUNG: 0,
    ANKAUFBELEG: 0,
    VERSANDBELEG: 0,
    EXPERTISE: 0,
    ZERTIFIKAT: 0,
    AUSWEIS: 0,
  }
  for (const d of docs) counts[d.category] += 1
  return counts
}

// ── Datum (ISO → de-DE, ehrlich null bei ungültig) ────────────────────────────

/** ISO-Zeitstempel als de-DE Datum + Uhrzeit, oder null wenn ungültig/leer. */
export function formatDocDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
