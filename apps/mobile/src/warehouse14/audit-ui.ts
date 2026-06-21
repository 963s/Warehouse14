/**
 * Audit / Tagebuch — die geteilte Präsentationsschicht für das GoBD-Ereignis-
 * register (`ledger_events`). Anders als die Benachrichtigungszentrale, die nur
 * die wenigen owner-relevanten Ereignisse KURATIERT, zeigt das Tagebuch das
 * VOLLSTÄNDIGE, fortlaufende Protokoll: wer hat wann was getan. Jede Zeile ist
 * ein unveränderlicher, hash-verketteter Append-only-Eintrag (`rowHashHex`),
 * den der Server geschrieben hat. Diese Fläche ist READ-ONLY und CLIENT-ONLY
 * über `GET /api/ledger` — sie liest das Protokoll, sie verändert nichts.
 *
 * Honesty-Regel (absolut): Labels und Werte stammen NUR aus dem echten
 * Ereignistyp + den echten Payload-Feldern (defensiv gelesen). Fehlt ein Detail,
 * fällt es weg — nie wird eine Zahl, ein Name oder ein Betrag erfunden. Der
 * Ereignistyp-Raum ist OFFEN (die api-client-Typen akzeptieren ausdrücklich auch
 * unbekannte Strings): darum gibt es kuratierte deutsche Labels für die bekannten
 * Typen UND eine ehrliche, humanisierende Herleitung für jeden unbekannten
 * `domain.action`-String — nie ein roher Maschinen-String ohne Kontext.
 *
 * Reines, framework-freies Modul (keine React-Imports) — nur Daten + Mapper, so
 * wie belege-ui.ts / whatsapp-ui.ts / ebay-ui.ts. Die Bildschirme ziehen daraus.
 */
import {
  type LucideIcon,
  CalendarClock,
  FileText,
  Lock,
  Package,
  Receipt,
  ScrollText,
  Settings2,
  ShieldAlert,
  Users,
} from "lucide-react-native"

import type { BadgeProps } from "@/components/ui/badge"

export type BadgeVariant = NonNullable<BadgeProps["variant"]>

// ── Ereignis-Kategorie (die Filter-Dimension) ────────────────────────────────
// Jeder Ereignistyp ist ein `domain.action`-String (z. B. `transaction.finalized`).
// Wir bündeln die `domain`-Präfixe zu wenigen, stabilen Owner-Kategorien — die
// Chips, nach denen gefiltert wird. „alert"/„security" werden bewusst zu EINER
// Sicherheits-Kategorie zusammengezogen (sie lesen sich gleich laut), und alles
// Unbekannte fällt ehrlich in „Sonstiges", statt eine falsche Heimat zu erfinden.

export type EventCategory =
  | "sales" // Verkauf / Storno / Rückgabe / Ankauf — der fiskalische Kern
  | "inventory" // Artikel: angelegt, geändert, reserviert, archiviert
  | "customers" // Kunden + KYC/GwG-Stammdaten
  | "fiscal" // Tagesabschluss, Belegtexte, Metallpreise, Schicht/Kasse
  | "security" // alert.* + security.* — Sicherheits- & Compliance-Signale
  | "approvals" // Freigaben (command.approval_*)
  | "appointments" // Termine
  | "system" // Auth, Einstellungen, Hintergrund-Jobs, Foto-Pipeline
  | "other" // alles ehrlich Unbekannte

export interface CategoryMeta {
  category: EventCategory
  /** Kurzes deutsches Label für den Filter-Chip + die Detail-Kopfzeile. */
  label: string
  icon: LucideIcon
  /** Badge-Variante (rein optische Trennung — nie „gut/schlecht" gefärbt …). */
  variant: BadgeVariant
  /**
   * … AUSSER bei „security": ein Sicherheits-/Compliance-Signal trägt echte
   * Bedeutung und wird ruhig-rot (destructive) markiert. Das ist die einzige
   * Kategorie, die optisch laut sein darf.
   */
  emphasis: boolean
  /** Eine ruhige deutsche Erklärzeile für die Filter-/Leer-Hilfe. */
  hint: string
}

const CATEGORY_META: Readonly<Record<EventCategory, CategoryMeta>> = {
  sales: {
    category: "sales",
    label: "Handel",
    icon: Receipt,
    variant: "default",
    emphasis: false,
    hint: "Verkäufe, Stornos, Rückgaben und Ankäufe — der fiskalische Kern.",
  },
  inventory: {
    category: "inventory",
    label: "Lager",
    icon: Package,
    variant: "secondary",
    emphasis: false,
    hint: "Artikel angelegt, geändert, reserviert, umgelagert oder archiviert.",
  },
  customers: {
    category: "customers",
    label: "Kunden",
    icon: Users,
    variant: "secondary",
    emphasis: false,
    hint: "Kundenstammdaten und KYC-/GwG-Nachweise.",
  },
  fiscal: {
    category: "fiscal",
    label: "Fiskal",
    icon: ScrollText,
    variant: "default",
    emphasis: false,
    hint: "Tagesabschlüsse, Belegtexte, Metallpreise und Schicht-/Kassenbewegungen.",
  },
  security: {
    category: "security",
    label: "Sicherheit",
    icon: ShieldAlert,
    variant: "destructive",
    emphasis: true,
    hint: "Sicherheits- und Compliance-Signale (Alerts, GwG, TSE, Signaturkette).",
  },
  approvals: {
    category: "approvals",
    label: "Freigaben",
    icon: Lock,
    variant: "outline",
    emphasis: false,
    hint: "Freigabe-Anfragen und -Entscheidungen für hochwertige Vorgänge.",
  },
  appointments: {
    category: "appointments",
    label: "Termine",
    icon: CalendarClock,
    variant: "secondary",
    emphasis: false,
    hint: "Termine gebucht, bestätigt, verschoben oder abgesagt.",
  },
  system: {
    category: "system",
    label: "System",
    icon: Settings2,
    variant: "outline",
    emphasis: false,
    hint: "Anmeldungen, Einstellungen, Hintergrund-Jobs und die Foto-Pipeline.",
  },
  other: {
    category: "other",
    label: "Sonstiges",
    icon: FileText,
    variant: "outline",
    emphasis: false,
    hint: "Weitere protokollierte Ereignisse.",
  },
}

export function categoryMeta(category: EventCategory): CategoryMeta {
  return CATEGORY_META[category]
}

/**
 * Reihenfolge der Filter-Chips: der fiskalische Kern zuerst, dann die lauten
 * Sicherheits-Signale, dann der Betrieb, „Sonstiges" zuletzt.
 */
export const CATEGORY_ORDER: readonly EventCategory[] = [
  "sales",
  "fiscal",
  "security",
  "inventory",
  "customers",
  "approvals",
  "appointments",
  "system",
  "other",
] as const

/**
 * Welche `domain`-Präfixe (der Teil vor dem ersten „.") in welche Kategorie
 * fallen. Das ist die ehrliche, deterministische Heimat-Findung: ein unbekannter
 * Typ mit bekanntem Präfix (z. B. ein neues `product.foo`) landet trotzdem in
 * „Lager", ohne dass wir den Typ einzeln kennen müssen.
 */
const DOMAIN_CATEGORY: Readonly<Record<string, EventCategory>> = {
  transaction: "sales",
  ankauf: "sales",
  appraisal: "sales",
  payment_intent: "sales",
  product: "inventory",
  inventory: "inventory",
  photo: "system",
  customer: "customers",
  daily_closing: "fiscal",
  shift: "fiscal",
  cash: "fiscal",
  metal_price: "fiscal",
  belegtext: "fiscal",
  alert: "security",
  security: "security",
  command: "approvals",
  appointment: "appointments",
  auth: "system",
  user: "system",
  pin: "system",
  session: "system",
  device: "system",
  system_setting: "system",
  task: "system",
  document: "system",
  internal_task: "system",
}

/** Den `domain`-Teil eines `domain.action`-Ereignistyps (vor dem ersten „."). */
export function eventDomain(eventType: string): string {
  const dot = eventType.indexOf(".")
  return dot === -1 ? eventType : eventType.slice(0, dot)
}

/** Den `action`-Teil eines Ereignistyps (nach dem ersten „."), oder "". */
export function eventAction(eventType: string): string {
  const dot = eventType.indexOf(".")
  return dot === -1 ? "" : eventType.slice(dot + 1)
}

/** Die Kategorie eines Ereignistyps — bekannt über das Präfix, sonst „Sonstiges". */
export function eventCategory(eventType: string): EventCategory {
  return DOMAIN_CATEGORY[eventDomain(eventType)] ?? "other"
}

// ── Kuratierte deutsche Labels (für die häufigen, bekannten Typen) ────────────
// Eine genaue, ruhige deutsche Überschrift je bekanntem Ereignistyp. Fehlt der
// Typ hier, leitet `humanizeAction` aus dem `action`-Teil ein lesbares Label ab
// (nie ein roher `snake_case.string`). So bleibt die Liste auch bei einem neuen
// Backend-Ereignistyp ehrlich und lesbar, ohne hier zu lügen.

const EVENT_LABELS: Readonly<Record<string, string>> = {
  // Handel
  "transaction.finalized": "Verkauf abgeschlossen",
  "transaction.stornoed": "Storno gebucht",
  "transaction.stornoed_with_reason": "Storno gebucht",
  "transaction.returned": "Rückgabe gebucht",
  "ankauf.completed": "Ankauf abgeschlossen",
  "appraisal.accepted": "Bewertung angenommen",
  "appraisal.rejected": "Bewertung abgelehnt",
  "payment_intent.payment_failed": "Zahlung fehlgeschlagen",
  // Lager
  "product.created": "Artikel angelegt",
  "product.listed": "Artikel veröffentlicht",
  "product.updated": "Artikel geändert",
  "product.archived": "Artikel archiviert",
  "product.deleted": "Artikel gelöscht",
  "product.reserved": "Artikel reserviert",
  "product.released": "Reservierung aufgehoben",
  "product.sold": "Artikel verkauft",
  "product.location_changed": "Lagerort geändert",
  "product.photo_requested": "Foto angefordert",
  "inventory.adjusted": "Bestand korrigiert",
  "inventory.session_opened": "Inventur geöffnet",
  "inventory.session_closed_with_shrinkage": "Inventur mit Schwund abgeschlossen",
  // Kunden
  "customer.created": "Kunde angelegt",
  "customer.updated": "Kunde geändert",
  "customer.kyc_verified": "KYC geprüft",
  "customer.kyc_document_added": "KYC-Nachweis hinzugefügt",
  "customer.kyc_document_viewed": "KYC-Nachweis eingesehen",
  "customer.trust_changed": "Vertrauensstufe geändert",
  "customer.price_notes_changed": "Preisnotizen geändert",
  "customer.sanctions_checked": "Sanktionsprüfung",
  "customer.smurfing_flagged": "Smurfing-Verdacht markiert",
  // Fiskal
  "daily_closing.finalized": "Tagesabschluss gebucht",
  "shift.opened": "Schicht geöffnet",
  "shift.closed_with_variance": "Schicht mit Differenz geschlossen",
  "cash.movement_recorded": "Kassenbewegung erfasst",
  "metal_price.set": "Metallpreis gesetzt",
  "metal_price.recorded": "Metallpreis erfasst",
  "metal_price.manual_override": "Metallpreis manuell überschrieben",
  "metal_price.overridden": "Metallpreis überschrieben",
  "belegtext.published": "Belegtext veröffentlicht",
  "belegtext.updated": "Belegtext geändert",
  // Sicherheit / Compliance
  "alert.suspicious_aml_flagged": "Geldwäsche-Verdacht",
  "alert.smurfing_detected": "Smurfing erkannt",
  "alert.duress": "Duress-Alarm",
  "alert.worker_job_dead_letter": "Hintergrund-Job fehlgeschlagen",
  "alert.hash_chain_verification_failed": "Signaturkette gestört",
  "alert.anomaly_detected": "Anomalie erkannt",
  "alert.ebay_sale_conflict": "eBay-Verkaufskonflikt",
  "alert.ebay_double_sale_attempt": "eBay-Doppelverkauf",
  "alert.customer_marked_suspicious": "Kunde als verdächtig markiert",
  "alert.customer_banned": "Kunde gesperrt",
  "alert.tse_cert_expiry": "TSE-Zertifikat läuft ab",
  "alert.tse_critical_failure": "TSE-Störung",
  "security.duress_login_alert": "Duress-Anmeldung",
  "security.kyc_image_missing": "KYC-Bild fehlt",
  "security.kyc_image_sha_mismatch": "KYC-Bild-Prüfsumme abweichend",
  "security.kyc_image_tamper": "KYC-Bild manipuliert",
  // Freigaben
  "command.approval_requested": "Freigabe angefragt",
  "command.approval_resolved": "Freigabe entschieden",
  // Termine
  "appointment.scheduled": "Termin gebucht",
  "appointment.booked": "Termin gebucht",
  "appointment.confirmed": "Termin bestätigt",
  "appointment.checked_in": "Gast eingecheckt",
  "appointment.rescheduled": "Termin verschoben",
  "appointment.cancelled": "Termin abgesagt",
  // System
  "auth.pin_login": "PIN-Anmeldung",
  "auth.sign_out": "Abmeldung",
  "user.login": "Anmeldung",
  "pin.set": "PIN gesetzt",
  "pin.set_duress": "Duress-PIN gesetzt",
  "system_setting.changed": "Einstellung geändert",
  "system_setting.updated": "Einstellung geändert",
  "task.completed": "Aufgabe erledigt",
  "photo.upload_url_requested": "Foto-Upload vorbereitet",
  "photo.uploaded_via_api": "Foto hochgeladen",
  "document.uploaded": "Beleg hochgeladen",
  "document.archived": "Beleg archiviert",
  "fixed_cost.created": "Fixkosten angelegt",
  "fixed_cost.updated": "Fixkosten geändert",
  "operating_expense.created": "Ausgabe gebucht",
  "operating_expense.updated": "Ausgabe geändert",
}

/**
 * Aus einem unbekannten `action`-Teil (z. B. „some_new_thing") ein lesbares
 * deutsches-naheres Label ableiten: snake_case → Wörter, Anfangsbuchstabe groß.
 * Das ist KEINE Übersetzung — es ist die ehrliche, lesbare Form des echten
 * Maschinen-Strings, damit nie ein roher `snake_case` in der UI steht.
 */
function humanizeAction(action: string): string {
  if (!action) return "Ereignis"
  const words = action.replace(/_/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Die deutsche Überschrift eines Ereignisses — kuratiert oder ehrlich abgeleitet. */
export function eventLabel(eventType: string): string {
  const known = EVENT_LABELS[eventType]
  if (known) return known
  return humanizeAction(eventAction(eventType) || eventType)
}

/** Ob für diesen Ereignistyp ein kuratiertes Label existiert (vs. abgeleitet). */
export function hasCuratedLabel(eventType: string): boolean {
  return eventType in EVENT_LABELS
}

// ── Entitäts-Tabelle → deutsches Label ───────────────────────────────────────
// `entityTable` ist der DB-Tabellenname, an dem das Ereignis hängt. Wir
// übersetzen die bekannten in ein ruhiges deutsches Wort; ein unbekannter Name
// wird humanisiert (nie roh angezeigt).

const ENTITY_LABELS: Readonly<Record<string, string>> = {
  transactions: "Vorgang",
  products: "Artikel",
  customers: "Kunde",
  users: "Benutzer",
  devices: "Gerät",
  daily_closings: "Tagesabschluss",
  shifts: "Schicht",
  appointments: "Termin",
  metal_prices: "Metallpreis",
  belegtext_templates: "Belegtext",
  documents: "Beleg",
  internal_tasks: "Aufgabe",
  appraisals: "Bewertung",
  fixed_costs: "Fixkosten",
  operating_expenses: "Ausgabe",
  photos: "Foto",
  system_settings: "Einstellung",
  cash_movements: "Kassenbewegung",
}

export function entityLabel(entityTable: string): string {
  const known = ENTITY_LABELS[entityTable]
  if (known) return known
  // Tabellennamen sind plural-snake; humanisieren statt roh zeigen.
  const words = entityTable.replace(/_/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Eintrag"
}

// ── Kurz-IDs + Hash (ehrlich verkürzt, nie als klickbarer Link) ──────────────
// `entityId`/`actorUserId`/`deviceId` sind UUIDs, `rowHashHex` ist der hex-SHA-256
// der Zeile. Wir zeigen sie monospaced und verkürzt als Forensik-Korrelat — der
// volle Wert steht in der Detailansicht, aber nie wird ein „Öffnen" vorgetäuscht.

export function shortId(id: string | null): string | null {
  if (!id) return null
  const s = id.trim()
  if (s.length <= 10) return s || null
  return s.slice(0, 8)
}

export function shortHash(hex: string | null): string | null {
  if (!hex) return null
  const h = hex.trim().toLowerCase()
  if (h.length < 12) return h || null
  return `${h.slice(0, 8)}…${h.slice(-4)}`
}

// ── Akteur (wer) ─────────────────────────────────────────────────────────────
// Das Protokoll trägt `actorUserId` (UUID), nicht den Namen. Manche Payloads
// tragen einen Klarnamen (cashier_name o. ä.) — den nehmen wir, sonst die
// verkürzte ID, sonst ehrlich „System" (kein Akteur = trigger-/server-erzeugt).

export interface ActorInfo {
  /** Anzeigeform: Klarname, „Gerät", verkürzte ID oder „System". */
  label: string
  /** Ob ein menschlicher Akteur (actorUserId gesetzt) dahintersteht. */
  isHuman: boolean
}

export function actorInfo(
  actorUserId: string | null,
  payload: unknown,
): ActorInfo {
  const name = payloadString(payload, "cashier_name", "cashierName", "actor_name", "actorName")
  if (name) return { label: name, isHuman: true }
  if (actorUserId) {
    const short = shortId(actorUserId)
    return { label: short ? `Benutzer ${short}` : "Benutzer", isHuman: true }
  }
  return { label: "System", isHuman: false }
}

// ── Payload-Leser (defensiv — die Payload ist owner-vertraut, aber lose) ──────

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

/** Ein nicht-leeres String-Feld aus der Payload, oder null. */
export function payloadString(payload: unknown, ...keys: string[]): string | null {
  const p = asRecord(payload)
  for (const k of keys) {
    const v = p[k]
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return null
}

/**
 * Die Payload als geordnete Liste lesbarer Schlüssel/Wert-Paare für die
 * Detailansicht. Schlüssel werden humanisiert, Werte ehrlich formatiert
 * (Strings/Zahlen/Booleans direkt; Objekte/Arrays als kompaktes JSON). Nichts
 * wird erfunden — eine leere Payload ergibt eine leere Liste.
 */
export interface PayloadEntry {
  key: string
  /** Humanisierter Schlüssel (z. B. „price per gram eur"). */
  label: string
  /** Ehrlich formatierter Wert. */
  value: string
  /** Ob der Wert eine ID/Hash-artige Zeichenkette ist (→ monospaced anzeigen). */
  mono: boolean
}

const ID_KEY_RE = /(_id$|^id$|hash|sha|fingerprint|serial|uuid)/i

function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ").trim()
  return words || key
}

function formatScalar(v: unknown): { value: string; mono: boolean } {
  if (v === null) return { value: "—", mono: false }
  if (typeof v === "boolean") return { value: v ? "Ja" : "Nein", mono: false }
  if (typeof v === "number") {
    return { value: Number.isFinite(v) ? v.toLocaleString("de-DE") : String(v), mono: true }
  }
  if (typeof v === "string") {
    return { value: v, mono: v.length > 16 && !v.includes(" ") }
  }
  // Objekt/Array — kompaktes JSON, ehrlich als Rohwert markiert (monospaced).
  try {
    return { value: JSON.stringify(v), mono: true }
  } catch {
    return { value: String(v), mono: true }
  }
}

export function payloadEntries(payload: unknown): PayloadEntry[] {
  const p = asRecord(payload)
  const out: PayloadEntry[] = []
  for (const key of Object.keys(p)) {
    const { value, mono } = formatScalar(p[key])
    out.push({ key, label: humanizeKey(key), value, mono: mono || ID_KEY_RE.test(key) })
  }
  return out
}

/** Ob die Payload überhaupt anzeigbare Felder trägt. */
export function hasPayload(payload: unknown): boolean {
  return Object.keys(asRecord(payload)).length > 0
}

// ── Datum / Zeit (ISO → de-DE, ehrlich null bei ungültig) ────────────────────

/** ISO-Zeitstempel als volle de-DE Datum+Uhrzeit, oder null wenn ungültig. */
export function formatEventDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** Nur die Uhrzeit (HH:MM) eines ISO-Zeitstempels, oder null. */
export function formatEventTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

/**
 * Ein „YYYY-MM-DD"-Tagesschlüssel (lokale Zeit) für die Gruppierung der Liste
 * nach Tag. Ungültige Zeitstempel ergeben null (sie landen unter „Unbekannt").
 */
export function dayKey(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Eine ruhige deutsche Tages-Überschrift für eine Gruppe: „Heute" / „Gestern"
 * für die jüngsten zwei Tage, sonst das de-DE-Datum mit Wochentag.
 */
export function dayHeading(key: string, now: number = Date.now()): string {
  if (key === "unknown") return "Unbekanntes Datum"
  const d = new Date(`${key}T00:00:00`)
  if (Number.isNaN(d.getTime())) return key
  const today = dayKey(new Date(now).toISOString())
  const yesterday = dayKey(new Date(now - 86_400_000).toISOString())
  if (key === today) return "Heute"
  if (key === yesterday) return "Gestern"
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

/**
 * Eine kompakte deutsche „vor … "-Relativzeit für die Zeile, mit absolutem
 * de-DE-Datum als Fallback ab einem Tag. „gerade eben" in der ersten Minute.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ""
  const diffMs = Math.max(0, now - then)
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return "gerade eben"
  if (min < 60) return `vor ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.floor(hours / 24)
  if (days < 7) return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`
  return new Date(then).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

// ── Gruppierung nach Tag (neueste zuerst) ────────────────────────────────────
// Die Liste kommt vom Server schon id-absteigend (neueste zuerst). Wir gruppieren
// stabil nach Kalendertag, ohne die Reihenfolge innerhalb des Tages zu ändern.

export interface DayGroup<T> {
  /** „YYYY-MM-DD" oder „unknown". */
  key: string
  heading: string
  items: T[]
}

export function groupByDay<T>(
  items: ReadonlyArray<T>,
  getIso: (item: T) => string,
  now: number = Date.now(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  const index = new Map<string, DayGroup<T>>()
  for (const item of items) {
    const key = dayKey(getIso(item)) ?? "unknown"
    let g = index.get(key)
    if (!g) {
      g = { key, heading: dayHeading(key, now), items: [] }
      index.set(key, g)
      groups.push(g)
    }
    g.items.push(item)
  }
  return groups
}

// ── Datums-Bereichs-Filter (echte Zeitfenster, ehrlich serverseitig) ─────────
// Die Bereichs-Chips übersetzen in das `fromBusinessDay`/`toBusinessDay`-Paar des
// Endpunkts (created_at >= from, < to+1Tag). Wir rechnen die Grenzen lokal, damit
// der „Heute"-Chip wirklich heute meint, und geben „YYYY-MM-DD"-Strings zurück.

export type DateRange = "all" | "today" | "7d" | "30d"

export const DATE_RANGE_ORDER: readonly DateRange[] = ["all", "today", "7d", "30d"] as const

export const DATE_RANGE_LABELS: Readonly<Record<DateRange, string>> = {
  all: "Alle",
  today: "Heute",
  "7d": "7 Tage",
  "30d": "30 Tage",
}

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Das `{ fromBusinessDay, toBusinessDay }`-Paar für einen Bereichs-Chip, relativ
 * zu `now`. „all" gibt ein leeres Objekt (kein Filter). Beide Grenzen sind
 * inklusive Tagesgrenzen, die der Server in created_at-Bereiche übersetzt.
 */
export function dateRangeQuery(
  range: DateRange,
  now: number = Date.now(),
): { fromBusinessDay?: string; toBusinessDay?: string } {
  if (range === "all") return {}
  const today = new Date(now)
  const to = isoDay(today)
  if (range === "today") return { fromBusinessDay: to, toBusinessDay: to }
  const days = range === "7d" ? 6 : 29 // inklusive heute → 7 bzw. 30 Tage
  const from = new Date(now - days * 86_400_000)
  return { fromBusinessDay: isoDay(from), toBusinessDay: to }
}

// ── Zählung (echte Summen aus echten Zeilen) ─────────────────────────────────
// Anzahl je Kategorie aus der geladenen Seite — füttert die Zähler an den
// Filter-Chips. Reine Reduktion; keine erfundene „0 als Erfolg".

export function countByCategory<T extends { eventType: string }>(
  items: ReadonlyArray<T>,
): Readonly<Record<EventCategory, number>> {
  const counts: Record<EventCategory, number> = {
    sales: 0,
    inventory: 0,
    customers: 0,
    fiscal: 0,
    security: 0,
    approvals: 0,
    appointments: 0,
    system: 0,
    other: 0,
  }
  for (const item of items) counts[eventCategory(item.eventType)] += 1
  return counts
}
