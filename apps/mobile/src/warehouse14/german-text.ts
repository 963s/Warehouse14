/**
 * The German text spine — the purification core every owner surface speaks
 * through. ONE place that turns the backend's developer vocabulary into clean,
 * human, idiomatic German.
 *
 * Two responsibilities:
 *   1. `describeError(err)` — maps EVERY `ApiErrorCode` the api-cloud can return
 *      (plus the raw CONFLICT constraint tokens its DB triggers raise, and the
 *      ajv 400 field paths) to one actionable German sentence. The English wire
 *      text — an ajv keyword, a Postgres RAISE message, a provider rejection —
 *      is NEVER surfaced to the operator.
 *   2. The enum/status LABEL REGISTRY — every status / type / kind / category /
 *      trust level / priority / tax treatment / metal / role / payment method /
 *      direction the backend uses as a SCREAMING_SNAKE or lower_snake token,
 *      mapped to its German display string. Each registry is typed as
 *      `Record<TheEnum, string>`, so the TypeScript compiler refuses to build if
 *      a backend enum gains a member we forgot to translate.
 *
 * HONESTY RULE (absolute): a label is a faithful translation of a known enum,
 * never an invented status. When `describeError` cannot recognise a conflict it
 * stays neutral and actionable rather than guessing a cause it can't prove.
 *
 * Why a Record and not a function with a default: an exhaustive `Record` is a
 * compile-time guard. A `switch` with a `default` would silently leak the raw
 * token the day the backend adds an enum member. The registry has no escape
 * hatch — every member must be present.
 */
import {
  ApiError,
  ApiNetworkError,
  type ApiErrorCode,
  type ActorRole,
  type AnkaufCondition,
  type AnkaufItemType,
  type AnkaufMetal,
  type AnkaufPayoutMethod,
  type AppointmentPatchStatus,
  type AppointmentStatus,
  type AppointmentType,
  type BelegtextKind,
  type CustomerKycStatus,
  type CustomerLanguage,
  type CustomerTrustLevel,
  type DocumentCategory,
  type EbayState,
  type PaymentMethod,
  type ProductStatus,
  type TaskPriority,
  type TaskStatus,
  type TaxTreatmentCode,
  type TransactionDirection,
  type WhatsAppMessageDirection,
  type WhatsAppOutboundStatus,
} from "@warehouse14/api-client"

// ════════════════════════════════════════════════════════════════════════════
// 1 · FEHLERTEXTE — describeError()
// ════════════════════════════════════════════════════════════════════════════

/** One ajv error entry as Fastify forwards it in a 400's `details` array. We
 *  only read the field path; the English keyword/message stays hidden. */
interface AjvErrorDetail {
  instancePath?: string
}

/**
 * German labels for the body fields the server can reject, keyed by the
 * top-level JSON path ajv reports in `instancePath` (e.g. "/dateOfBirth").
 * Spans every surface's forms — field names are unique across domains, so a
 * bad-format 400 (e.g. a due date the server reads in the wrong format) names
 * the offending field in German instead of leaking the raw English ajv text.
 */
const VALIDATION_FIELD_LABELS: Readonly<Record<string, string>> = {
  // Kunden
  fullName: "Name",
  dateOfBirth: "Geburtsdatum",
  email: "E-Mail-Adresse",
  phone: "Telefonnummer",
  address: "Adresse",
  vatId: "USt-IdNr.",
  notes: "Notiz",
  // Aufgaben
  title: "Titel",
  description: "Beschreibung",
  dueDate: "Fälligkeitsdatum",
  cancellationReason: "Abbruchgrund",
  // Verkauf / Ankauf — Geldwege
  totalEur: "Gesamtbetrag",
  negotiatedPriceEur: "Auszahlungsbetrag",
  listPriceEur: "Verkaufspreis",
  weightGrams: "Gewicht",
  payoutExternalRef: "Überweisungsreferenz",
  customerId: "Kunde",
}

/**
 * The stable Postgres-message → German-line table for CONFLICT (409) responses.
 *
 * A 409 carries the raw English `message` verbatim — a DB trigger's RAISE text,
 * a domain error, or a Postgres constraint name — which must NEVER reach the
 * operator. We match the stable token (the same tokens api-cloud's
 * `error-handler.ts` keys on) to an actionable German line. Order is
 * most-specific first; the first hit wins. Entries whose German line needs a
 * count pulled from the English message live in `describeConflict` below.
 */
const CONFLICT_TOKENS: ReadonlyArray<{ token: string; line: string }> = [
  // ── Kunden (Blind-Index-Eindeutigkeit) ────────────────────────────────────
  {
    token: "customers_email_blind_index_active_uq",
    line: "Diese E-Mail-Adresse ist bereits einem Kunden zugeordnet.",
  },
  {
    token: "customers_phone_blind_index_active_uq",
    line: "Diese Telefonnummer ist bereits einem Kunden zugeordnet.",
  },
  // ── Termine ────────────────────────────────────────────────────────────────
  {
    token: "Invalid appointment status transition",
    line: "Dieser Statuswechsel ist nicht möglich. Bitte die Termin-Ansicht aktualisieren.",
  },
  {
    token: "Selected slot is no longer available",
    line: "Dieser Termin-Slot ist nicht mehr frei. Bitte eine andere Zeit wählen.",
  },
  {
    token: "appointments_no_staff_overlap",
    line: "Zu dieser Zeit liegt bereits ein Termin. Bitte eine andere Zeit wählen.",
  },
  {
    // Day 8: a buy-in (Ankauf) was linked to an appointment that already has a
    // transaction — the partial UNIQUE refuses the second link.
    token: "appointments_one_transaction_link_uq",
    line: "Dieser Termin ist bereits mit einem Vorgang verknüpft.",
  },
  // ── Geldwege (Fiskal-Eindeutigkeit) ────────────────────────────────────────
  {
    // Storno idempotency: a second storno of the same original is refused.
    token: "transactions_one_storno_per_original_uq",
    line: "Dieser Vorgang wurde bereits storniert.",
  },
  // ── Sammlungen (Kategorien-Verwaltung) ─────────────────────────────────────
  {
    // Duplicate slug on create/rename. The operator never sees the slug as a
    // field, so name the conflict in their vocabulary (Kurzname = slug).
    token: "already exists.",
    line: "Eine Sammlung mit diesem Kurznamen gibt es bereits. Bitte einen anderen Namen wählen.",
  },
  // ── Kunden-Vertrauensstufe (KYC-Heraufstufung) ─────────────────────────────
  {
    // The ONLY 409 the KYC/Ausweis line truthfully describes: TrustConflictError
    // raises "cannot promote to {VERIFIED|VIP} without a prior physical-ID check".
    // Gate the KYC step on this token alone — never blame KYC for an unrelated
    // conflict, which would send the operator into a dead-end loop.
    token: "without a prior physical-ID check",
    line: "Aktion nicht möglich — zuerst die KYC-Prüfung (Ausweis) bestätigen.",
  },
]

/**
 * Turn a VALIDATION_ERROR's ajv detail into a field-specific German line, so a
 * server-side reject the client missed (a bad calendar date, a too-short phone)
 * names the offending field in German instead of leaking the raw English ajv
 * message. Returns null when no known field can be read — the caller then uses a
 * generic German fallback. The English `err.message` is never surfaced.
 */
function describeValidationError(err: ApiError): string | null {
  const details = err.details
  if (!Array.isArray(details)) return null
  for (const entry of details as AjvErrorDetail[]) {
    const path = entry?.instancePath
    if (typeof path !== "string" || path.length === 0) continue
    // "/dateOfBirth" → "dateOfBirth"; "/address/city" → "address".
    const field = path.split("/").filter(Boolean)[0]
    const label = field ? VALIDATION_FIELD_LABELS[field] : undefined
    if (label) return `${label} ungültig — bitte prüfen.`
  }
  return null
}

/**
 * Map a 409 CONFLICT to an actionable German line. First the count-bearing
 * cases (which read a real number out of the English message), then the static
 * token table, then a neutral honest fallback for an unrecognised conflict.
 */
function describeConflict(err: ApiError): string {
  const msg = err.message ?? ""

  // Delete refused because products still point at the category — the route
  // raises "Category … is assigned to N product(s). Unassign first." Pull the
  // count out so the line stays a real number, never a guess.
  if (msg.includes("is assigned to") && msg.includes("product(s)")) {
    const n = msg.match(/is assigned to (\d+) product/)?.[1]
    return n
      ? `Diese Sammlung ist noch ${n} Artikel${n === "1" ? "" : "n"} zugeordnet. Bitte zuerst die Zuordnung lösen.`
      : "Dieser Sammlung sind noch Artikel zugeordnet. Bitte zuerst die Zuordnung lösen."
  }
  // Delete refused because a child category exists — "Category … has N
  // subcategory/-ies. Delete or re-parent first."
  if (msg.includes("subcategory/-ies")) {
    const n = msg.match(/has (\d+) subcategory/)?.[1]
    return n
      ? `Diese Sammlung hat noch ${n} Untersammlung${n === "1" ? "" : "en"}. Bitte diese zuerst löschen oder verschieben.`
      : "Diese Sammlung hat noch Untersammlungen. Bitte diese zuerst löschen oder verschieben."
  }

  for (const { token, line } of CONFLICT_TOKENS) {
    if (msg.includes(token)) return line
  }

  // Unrecognised conflict. Stay honest: don't surface the raw English, don't
  // fabricate a cause we can't prove. A neutral, actionable German line.
  return "Aktion derzeit nicht möglich — der aktuelle Stand passt nicht mehr. Bitte aktualisieren und erneut versuchen."
}

/**
 * The fixed German line for each stable `ApiErrorCode`, EXCEPT the four codes
 * whose copy depends on the response body and so are computed in
 * `describeError`: PIN_LOCKED (countdown), UNAUTHORIZED (server message),
 * VALIDATION_ERROR (ajv field), CONFLICT (constraint token).
 *
 * Typed as a Record over those remaining codes, so adding a new `ApiErrorCode`
 * member to the api-cloud contract fails the build until it has a German line.
 */
type StaticErrorCode = Exclude<
  ApiErrorCode,
  "PIN_LOCKED" | "UNAUTHORIZED" | "VALIDATION_ERROR" | "CONFLICT"
>

const STATIC_ERROR_LINES: Readonly<Record<StaticErrorCode, string>> = {
  NOT_FOUND: "Datensatz nicht gefunden.",
  FORBIDDEN: "Keine Berechtigung für diese Aktion.",
  STEP_UP_REQUIRED: "PIN-Bestätigung erforderlich.",
  DEVICE_NOT_AUTHORIZED: "Dieses Gerät ist nicht freigegeben.",
  RATE_LIMITED: "Zu viele Versuche — bitte einen Moment warten und erneut versuchen.",
  // Fiskal- + Inventar-Codes der Geldwege — sie tragen ihren EIGENEN code.
  PRODUCT_NOT_RESERVABLE:
    "Dieser Artikel ist nicht mehr verfügbar — er wurde bereits reserviert oder verkauft.",
  CLOSING_DAY_FINALIZED:
    "Der Kassentag ist bereits abgeschlossen (Z-Bon). Eine Buchung ist erst nach dem nächsten Kassenstart möglich.",
  KYC_REQUIRED:
    "Ausweis-Identifikation erforderlich — bitte zuerst einen geprüften Kunden zuordnen.",
  SANCTIONS_BLOCK: "Sanktionslisten-Treffer — die Buchung ist gesperrt. Bitte intern prüfen.",
  STORNO_OF_STORNO: "Eine Stornierung kann nicht erneut storniert werden.",
  EXTERNAL_SERVICE_FAILED: "Der externe Dienst hat abgelehnt — die Aktion wurde nicht ausgeführt.",
  INTERNAL_ERROR:
    "Es ist ein unerwarteter Serverfehler aufgetreten. Bitte später erneut versuchen.",
}

/**
 * Map ANY thrown error to one themed, actionable German sentence. The single
 * function every surface calls to render a failure — never raw English, never a
 * SCREAMING_SNAKE code, never a fabricated success.
 */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "PIN_LOCKED": {
        // The api-cloud error-handler serializes the 423 lockout as
        // `details.lockedUntil` (an ISO string) with NO Retry-After header.
        // Derive the remaining minutes ourselves; only show the countdown when
        // it's a future instant we can trust.
        const lockedUntil = (err.details as { lockedUntil?: string } | undefined)?.lockedUntil
        const untilMs = lockedUntil ? Date.parse(lockedUntil) : NaN
        const remainingMs = Number.isFinite(untilMs) ? untilMs - Date.now() : NaN
        const mins =
          Number.isFinite(remainingMs) && remainingMs > 0 ? Math.ceil(remainingMs / 60000) : null
        return mins
          ? `PIN gesperrt — in ${mins} Min. erneut versuchen.`
          : "PIN gesperrt — bitte später erneut versuchen."
      }
      case "UNAUTHORIZED":
        // The PIN-login route returns a clean German message here ("Falsche
        // PIN."); keep it, fall back to a German default if ever empty.
        return err.message || "Falsche PIN."
      case "VALIDATION_ERROR":
        return describeValidationError(err) ?? "Eingabe ungültig — bitte die Angaben prüfen."
      case "CONFLICT":
        return describeConflict(err)
      default:
        return STATIC_ERROR_LINES[err.code]
    }
  }
  // Transport failures aren't ApiError subclasses, so their `.message` is the
  // raw English string ("Network request failed" / a TimeoutError message) on
  // React Native. Map them to German — distinguishing a timeout (reached the
  // network but didn't answer in time) from a hard offline.
  if (err instanceof ApiNetworkError) {
    const timedOut = (err.cause as { name?: string } | undefined)?.name === "TimeoutError"
    return timedOut
      ? "Zeitüberschreitung — der Server antwortet nicht. Bitte erneut versuchen."
      : "Keine Verbindung zum Server. Bitte Internetverbindung prüfen."
  }
  // A non-api error we can't classify. Stay calm and generic — never echo a raw
  // JS Error message, which could be English or a developer string.
  return "Es ist ein Fehler aufgetreten. Bitte erneut versuchen."
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · ENUM-/STATUS-REGISTER — jeder Backend-Token → ein deutsches Label
// ════════════════════════════════════════════════════════════════════════════
//
// Each registry is `Record<TheEnum, string>`, so a backend enum that gains a
// member fails the typecheck here until it has a German label. This is the one
// place a surface should reach for an enum label — never inline a token.

// ── Artikel (Produkt-Status) ─────────────────────────────────────────────────
export const PRODUCT_STATUS_LABEL: Readonly<Record<ProductStatus, string>> = {
  DRAFT: "Entwurf",
  AVAILABLE: "Verfügbar",
  RESERVED: "Reserviert",
  SOLD: "Verkauft",
}

// ── Aufgaben (Status + Priorität) ────────────────────────────────────────────
export const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  OPEN: "Offen",
  IN_PROGRESS: "In Arbeit",
  BLOCKED: "Blockiert",
  DONE: "Erledigt",
  CANCELLED: "Abgebrochen",
}

export const TASK_PRIORITY_LABEL: Readonly<Record<TaskPriority, string>> = {
  LOW: "Niedrig",
  NORMAL: "Normal",
  HIGH: "Hoch",
  URGENT: "Dringend",
}

// ── Termine (Art + Status + Folgeschritt) ────────────────────────────────────
export const APPOINTMENT_TYPE_LABEL: Readonly<Record<AppointmentType, string>> = {
  VIEWING: "Besichtigung",
  BUYBACK_EVAL: "Ankauf-Bewertung",
  CONSULTATION: "Beratung",
  PICKUP: "Abholung",
}

export const APPOINTMENT_STATUS_LABEL: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: "Geplant",
  CONFIRMED: "Bestätigt",
  CHECKED_IN: "Eingetroffen",
  IN_PROGRESS: "Läuft",
  COMPLETED: "Abgeschlossen",
  NO_SHOW: "Nicht erschienen",
  CANCELLED: "Abgesagt",
  RESCHEDULED: "Verschoben",
}

/** The status an appointment can be advanced TO (the PATCH body's enum). */
export const APPOINTMENT_NEXT_STATUS_LABEL: Readonly<Record<AppointmentPatchStatus, string>> = {
  CONFIRMED: "Bestätigen",
  CHECKED_IN: "Eingetroffen",
  IN_PROGRESS: "Starten",
  COMPLETED: "Abschließen",
  CANCELLED: "Absagen",
  NO_SHOW: "Nicht erschienen",
}

// ── Kunden (KYC-Status + Vertrauensstufe + Sprache) ──────────────────────────
export const CUSTOMER_KYC_STATUS_LABEL: Readonly<Record<CustomerKycStatus, string>> = {
  NOT_REQUIRED: "Nicht erforderlich",
  PENDING: "Ausstehend",
  CAPTURED: "Ausweis erfasst",
  VERIFIED: "Geprüft",
  EXPIRED: "Abgelaufen",
  REJECTED: "Abgelehnt",
}

export const CUSTOMER_TRUST_LEVEL_LABEL: Readonly<Record<CustomerTrustLevel, string>> = {
  NEW: "Neu",
  VERIFIED: "Verifiziert",
  VIP: "VIP",
  SUSPICIOUS: "Beobachten",
  BANNED: "Gesperrt",
}

export const CUSTOMER_LANGUAGE_LABEL: Readonly<Record<CustomerLanguage, string>> = {
  de: "Deutsch",
  en: "Englisch",
  ar: "Arabisch",
}

// ── Team (Rollen) ────────────────────────────────────────────────────────────
export const ACTOR_ROLE_LABEL: Readonly<Record<ActorRole, string>> = {
  ADMIN: "Verwaltung",
  CASHIER: "Kasse",
  READONLY: "Nur Ansicht",
}

// ── Belege (Kategorie) ───────────────────────────────────────────────────────
export const DOCUMENT_CATEGORY_LABEL: Readonly<Record<DocumentCategory, string>> = {
  AUSWEIS: "Ausweis",
  ANKAUFBELEG: "Ankaufbeleg",
  RECHNUNG: "Rechnung",
  EXPERTISE: "Expertise",
  ZERTIFIKAT: "Zertifikat",
  VERSANDBELEG: "Versandbeleg",
}

// ── eBay-Kanal (Zustand) ─────────────────────────────────────────────────────
export const EBAY_STATE_LABEL: Readonly<Record<EbayState, string>> = {
  ENTWURF: "Entwurf",
  GEPRUEFT: "Geprüft",
  ONLINE: "Online",
  VERKAUFT: "Verkauft",
  BEZAHLT: "Bezahlt",
  VERPACKT: "Verpackt",
  VERSENDET: "Versendet",
  REKLAMIERT: "Reklamiert",
  RETOURNIERT: "Retourniert",
}

// ── WhatsApp (Richtung + Versandstatus) ──────────────────────────────────────
export const WHATSAPP_DIRECTION_LABEL: Readonly<Record<WhatsAppMessageDirection, string>> = {
  inbound: "Eingegangen",
  outbound: "Gesendet",
}

export const WHATSAPP_OUTBOUND_STATUS_LABEL: Readonly<Record<WhatsAppOutboundStatus, string>> = {
  queued: "In Warteschlange",
  sent: "Gesendet",
  delivered: "Zugestellt",
  read: "Gelesen",
  failed: "Fehlgeschlagen",
}

// ── Geldwege (Richtung + Zahlart) ────────────────────────────────────────────
export const TRANSACTION_DIRECTION_LABEL: Readonly<Record<TransactionDirection, string>> = {
  VERKAUF: "Verkauf",
  ANKAUF: "Ankauf",
}

export const PAYMENT_METHOD_LABEL: Readonly<Record<PaymentMethod, string>> = {
  CASH: "Bar",
  ZVT_CARD: "Kartenzahlung",
  SUMUP: "SumUp",
  MOLLIE: "Mollie",
  STRIPE: "Stripe",
  EBAY: "eBay",
  BANK_TRANSFER: "Überweisung",
  VOUCHER: "Gutschein",
}

export const ANKAUF_PAYOUT_METHOD_LABEL: Readonly<Record<AnkaufPayoutMethod, string>> = {
  CASH: "Barauszahlung",
  BANK_TRANSFER: "Überweisung",
}

// ── Ankauf (Artikelart + Edelmetall + Zustand) ───────────────────────────────
export const ANKAUF_ITEM_TYPE_LABEL: Readonly<Record<AnkaufItemType, string>> = {
  gold_jewelry: "Goldschmuck",
  gold_coin: "Goldmünze",
  gold_bar: "Goldbarren",
  silver_jewelry: "Silberschmuck",
  silver_coin: "Silbermünze",
  silver_bar: "Silberbarren",
  platinum_jewelry: "Platinschmuck",
  platinum_coin: "Platinmünze",
  platinum_bar: "Platinbarren",
  antique: "Antiquität",
  watch: "Uhr",
  other: "Sonstiges",
}

export const ANKAUF_METAL_LABEL: Readonly<Record<AnkaufMetal, string>> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

export const ANKAUF_CONDITION_LABEL: Readonly<Record<AnkaufCondition, string>> = {
  NEW: "Neu",
  USED_EXCELLENT: "Gebraucht — sehr gut",
  USED_GOOD: "Gebraucht — gut",
  USED_FAIR: "Gebraucht — mäßig",
  ANTIQUE_RESTORED: "Antik — restauriert",
  ANTIQUE_AS_FOUND: "Antik — Fundzustand",
}

// ── Steuer (Besteuerungsart + Belegtext-Art) ─────────────────────────────────
export const TAX_TREATMENT_LABEL: Readonly<Record<TaxTreatmentCode, string>> = {
  MARGIN_25A: "Differenzbesteuerung (§25a)",
  STANDARD_19: "Standard 19 %",
  REDUCED_7: "Ermäßigt 7 %",
  INVESTMENT_GOLD_25C: "Anlagegold (§25c)",
  MIXED: "Gemischt",
  REVERSE_CHARGE_13B: "Reverse-Charge (§13b)",
}

export const BELEGTEXT_KIND_LABEL: Readonly<Record<BelegtextKind, string>> = {
  MARGIN_25A: "Differenzbesteuerung (§25a)",
  STANDARD_19: "Standard 19 %",
  REDUCED_7: "Ermäßigt 7 %",
  INVESTMENT_GOLD_25C: "Anlagegold (§25c)",
  KLEINUNTERNEHMER_19: "Kleinunternehmer (§19)",
  ANKAUFBELEG_DECLARATION: "Ankaufbeleg-Erklärung",
  GENERIC_HEADER: "Allgemeiner Kopftext",
  GENERIC_FOOTER: "Allgemeiner Fußtext",
  REVERSE_CHARGE_13B: "Reverse-Charge (§13b)",
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · Sichere Nachschlage-Helfer (für Werte, die zur Laufzeit unbekannt sein
//     können — z. B. ein Status aus einem rohen Ledger-Event-String)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Look a value up in a label registry, returning a clean fallback rather than
 * the raw token if the value is somehow unknown at runtime (e.g. a new enum
 * member arrives from a newer backend than this build expects). NEVER returns
 * the raw SCREAMING_SNAKE token — the operator sees "Unbekannt", not a leak.
 */
export function germanLabel<K extends string>(
  registry: Readonly<Record<K, string>>,
  value: string,
  fallback = "Unbekannt",
): string {
  return (registry as Record<string, string | undefined>)[value] ?? fallback
}
