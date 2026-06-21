/**
 * Notifications — the owner's in-app alert model (Foundation phase).
 *
 * The app already has a real live substrate: the append-only `ledger_events`
 * feed (`GET /api/ledger` for history, `GET /api/sse/ledger` for the live push).
 * Every meaningful thing that happens in the business — a sale finalized, an
 * approval requested, a worker job dead-lettered, an appointment booked — lands
 * there first. The Notifications Center does NOT invent a second event source;
 * it DERIVES owner-facing notifications from those real ledger rows.
 *
 * This module is the pure, dependency-free heart of that: the `Notification`
 * model, the channel/severity vocabulary, and a single `classify()` that maps
 * one `LedgerEvent` to either a `Notification` or `null` (events the owner never
 * needs to see — e.g. a routine `product.released` — are dropped). No React, no
 * fetch, no store here — just the shape and the rules, so it is trivially
 * testable and the store/hooks/screen all agree on one contract.
 *
 * Honesty rule: a notification's title/body are built ONLY from the real event
 * type + its real payload fields (read defensively). When the payload lacks a
 * detail we fall back to a neutral phrasing — we never fabricate a number,
 * customer name, or amount the event didn't carry.
 *
 * German UI throughout; all copy lives here so the screen stays presentational.
 */
import type { LedgerEvent } from "@warehouse14/api-client"

// ── Channels ──────────────────────────────────────────────────────────────────
/**
 * The owner-facing buckets a notification falls into. These are the filter tabs
 * in the Center and the routing key a channel surface (eBay/WhatsApp/Documents)
 * subscribes to for its own live nudge. Kept deliberately small and stable.
 *
 *   approvals     — a high-value sale is paused, waiting for the owner's APPROVE.
 *   appointments  — a booking was made / moved / cancelled.
 *   fiscal        — TSE / KassenSichV / hash-chain criticals (legal weight).
 *   system        — worker dead-letter queue, anomalies — operational health.
 *   sales         — a finalized sale / Ankauf worth surfacing (high value, storno).
 *   compliance    — AML / suspicious-customer flags (GwG).
 *   channels      — eBay / WhatsApp / Documents cross-surface activity.
 */
export type NotificationChannel =
  | "approvals"
  | "appointments"
  | "fiscal"
  | "system"
  | "sales"
  | "compliance"
  | "channels"

/** Stable channel order for the filter bar + grouping. */
export const CHANNEL_ORDER: readonly NotificationChannel[] = [
  "approvals",
  "fiscal",
  "compliance",
  "system",
  "appointments",
  "sales",
  "channels",
] as const

/** Short German label for a channel chip. */
export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  approvals: "Freigaben",
  appointments: "Termine",
  fiscal: "Fiskal",
  system: "System",
  sales: "Verkäufe",
  compliance: "Compliance",
  channels: "Kanäle",
}

// ── Severity ──────────────────────────────────────────────────────────────────
/**
 * How loudly a notification should read. Drives the row accent rail + icon tint
 * (mapped to theme tokens at the edge — NEVER a hardcoded colour here):
 *
 *   critical — needs the owner now: an alert.* event or a fiscal failure. Wax-red.
 *   action   — waiting on the owner to act: a pending approval. Brass.
 *   info     — happened, good to know: a booking, a finalized sale. Verdigris/muted.
 */
export type NotificationSeverity = "critical" | "action" | "info"

/** Severity ranking for sorting ties (higher = louder). */
export const SEVERITY_WEIGHT: Record<NotificationSeverity, number> = {
  critical: 2,
  action: 1,
  info: 0,
}

// ── The model ─────────────────────────────────────────────────────────────────
/**
 * One owner-facing notification, derived from one ledger row. `read` is layered
 * on by the store (it is per-device UI state, not a server fact), so it is NOT
 * part of what `classify()` produces.
 */
export interface Notification {
  /** The ledger row id — stable, monotonic, the de-dupe + cursor key. */
  id: number
  channel: NotificationChannel
  severity: NotificationSeverity
  /** Short German headline (≤ ~48 chars). */
  title: string
  /** One-line German detail; built from the event payload, never fabricated. */
  body: string
  /** The raw event type, kept for the detail view + deep-link routing. */
  eventType: string
  /** The entity this concerns (table + id) — drives the "open" deep link. */
  entityTable: string
  entityId: string
  /** ISO-8601 — when it happened (the ledger row's created_at). */
  createdAt: string
  /** The original payload, surfaced read-only in the detail view. */
  payload: Record<string, unknown>
}

/** A notification plus the per-device read flag the store layers on. */
export interface NotificationItem extends Notification {
  read: boolean
}

// ── Payload-reading helpers (defensive — the payload is owner-trusted but loose) ─
function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

/** A non-empty string field, or `null`. Never coerces a number/object to text. */
function pstr(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = p[k]
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return null
}

/** A finite number field, or `null`. */
function pnum(p: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = p[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

/**
 * Format a decimal-EUR STRING (the form ledger payloads use, e.g. "1234.56")
 * as de-DE currency. Returns the raw string unchanged if it isn't a clean
 * number — we never guess at a malformed amount.
 */
function formatEurString(eur: string): string {
  const n = Number(eur)
  if (!Number.isFinite(n)) return eur
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n)
}

/**
 * Drop a single leading minus from a decimal-EUR string. Storno rows carry a
 * NEGATIVE `total_eur` (DB invariant), but the German body reads „über X" where
 * X is the magnitude — the word „storniert" already conveys the reversal, so a
 * „-50,00 €" would read as a double negative. Leaves a positive value untouched.
 */
function stripLeadingMinus(eur: string): string {
  return eur.replace(/^-/, "")
}

/** A short de-DE date from a "YYYY-MM-DD" business day, or the raw string. */
function formatBusinessDay(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** A short de-DE "am DD.MM. um HH:MM Uhr" from an ISO `starts_at`, or "". */
function formatAppointmentWhen(p: Record<string, unknown>): string {
  const iso = pstr(p, "starts_at", "startsAt")
  if (iso == null) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const date = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  return ` am ${date} um ${time} Uhr`
}

/**
 * Build a German appointment body: „<Kunde>: Termin <verb><wann>." The customer
 * name is rarely present in the payload (it carries `customer_id`, not a name),
 * so we degrade gracefully to „Ein Termin <verb><wann>."
 */
function appointmentBody(p: Record<string, unknown>, who: string | null, verb: string): string {
  const when = formatAppointmentWhen(p)
  if (who) return `${who}: Termin ${verb}${when}.`
  return `Ein Termin ${verb}${when}.`
}

/**
 * The money direction of a transaction event, read from the real ledger payload.
 *
 * The `transaction.finalized` / `transaction.stornoed` rows carry the enum
 * `direction` verbatim (migration 0009: `jsonb_build_object('direction',
 * NEW.direction, …)`), so it is the literal string `"VERKAUF"` (we sell — cash
 * IN) or `"ANKAUF"` (we buy from the customer — cash OUT). Conflating the two
 * misreports the money direction to the owner: a buy-in shown as a sale. We
 * default to a sale ONLY when the field is genuinely absent, and never surface
 * the raw enum token — it maps to clean German at the edge.
 */
function isAnkauf(p: Record<string, unknown>): boolean {
  return pstr(p, "direction") === "ANKAUF"
}

// ── The classifier ────────────────────────────────────────────────────────────
/**
 * The single mapping from a real ledger row to an owner notification. Returns
 * `null` for events the owner never needs surfaced (routine inventory churn,
 * KYC stamps, metal-price ticks, …) so the Center stays signal, not noise.
 *
 * Every branch reads its title/body from the event's own fields; a missing
 * detail degrades to neutral copy rather than a guess.
 */
export function classify(e: LedgerEvent): Notification | null {
  const eventType = String(e.event_type)
  const p = asRecord(e.payload)

  const base = {
    id: e.id,
    eventType,
    entityTable: e.entity_table,
    entityId: e.entity_id,
    createdAt: e.created_at,
    payload: p,
  } as const

  const make = (
    channel: NotificationChannel,
    severity: NotificationSeverity,
    title: string,
    body: string,
  ): Notification => ({ ...base, channel, severity, title, body })

  // The customer / amount snippets, when the payload carries them.
  const who = pstr(p, "customerName", "customer_name", "cashierName", "cashier_name")
  // Real ledger payloads carry the money as a decimal-EUR STRING, never cents:
  //   • transaction.finalized / .stornoed → `total_eur` (migration 0009: NEW.total_eur::text)
  //   • command.approval_requested        → `amountEur` / `totalEur` / `amount`
  //     (mirrors api-cloud approvals.ts `pamount`)
  // There is NO `*_cents` field anywhere in the real feed — reading one only ever
  // yielded null, silently dropping every amount. Read the EUR string and format
  // it the same way the daily_closing branch already does (formatEurString).
  const amountEur = pstr(
    p,
    "total_eur",
    "totalEur",
    "amountEur",
    "amount_eur",
    "amount",
  )
  const amount = amountEur != null ? formatEurString(amountEur) : null

  switch (eventType) {
    // ── Approvals (the high-value sale gate) ────────────────────────────────
    // The POS pauses a sale above threshold and the owner must APPROVE/REJECT.
    case "command.approval_requested":
      return make(
        "approvals",
        "action",
        "Freigabe angefragt",
        [
          amount ? `Verkauf über ${amount}` : "Ein Verkauf",
          who ? `· ${who}` : null,
          "wartet auf deine Freigabe.",
        ]
          .filter(Boolean)
          .join(" "),
      )
    case "command.approval_resolved":
      return make(
        "approvals",
        "info",
        pstr(p, "status") === "REJECTED" ? "Freigabe abgelehnt" : "Freigabe erteilt",
        amount ? `Verkauf über ${amount} wurde entschieden.` : "Die Freigabe wurde entschieden.",
      )

    // ── Appointments ────────────────────────────────────────────────────────
    // The REAL emitted types are `appointment.scheduled` / `.confirmed` /
    // `.checked_in` / `.rescheduled` / `.cancelled` (verified against the live
    // ledger). The payload carries `starts_at` (ISO) — surface it in German so
    // the owner sees WHEN, not just THAT. `.booked` is kept as a forward-compat
    // alias in case a later code path emits it.
    case "appointment.scheduled":
    case "appointment.booked":
      return make("appointments", "info", "Neuer Termin", appointmentBody(p, who, "wurde gebucht"))
    case "appointment.confirmed":
      return make(
        "appointments",
        "info",
        "Termin bestätigt",
        appointmentBody(p, who, "wurde bestätigt"),
      )
    case "appointment.checked_in":
      return make(
        "appointments",
        "info",
        "Gast eingecheckt",
        appointmentBody(p, who, "ist eingecheckt"),
      )
    case "appointment.rescheduled":
      return make(
        "appointments",
        "info",
        "Termin verschoben",
        appointmentBody(p, who, "wurde verschoben"),
      )
    case "appointment.cancelled":
      return make(
        "appointments",
        "info",
        "Termin abgesagt",
        who ? `${who} hat einen Termin abgesagt.` : "Ein Termin wurde abgesagt.",
      )

    // ── Z-Bon / daily closing (a real fiscal milestone) ─────────────────────
    // `daily_closing.finalized` is the legal Z-Bon being written — genuinely
    // worth the owner's eye. Read the business day + gross revenue (an EUR
    // STRING in the payload, e.g. "1.234,56" is NOT how it's stored — it's
    // "1234.56"); surface it without mis-reading it as cents.
    case "daily_closing.finalized": {
      const day = pstr(p, "business_day", "businessDay")
      const grossEur = pstr(p, "gross_verkauf_eur", "grossVerkaufEur")
      const dayLabel = day ? formatBusinessDay(day) : null
      const lead = dayLabel ? `Z-Bon für ${dayLabel} wurde erstellt` : "Der Z-Bon wurde erstellt"
      const tail = grossEur != null ? ` · Umsatz ${formatEurString(grossEur)}.` : "."
      return make("fiscal", "info", "Tagesabschluss gebucht", `${lead}${tail}`)
    }

    // ── Verkäufe & Ankäufe worth surfacing ──────────────────────────────────
    // The ledger row carries the real money `direction` (VERKAUF = cash IN,
    // ANKAUF = cash OUT). We MUST honour it: an Ankauf is a payout, not a sale.
    // Reporting a buy-in as „Verkauf abgeschlossen" shows the owner the wrong
    // money direction. Branch on it and render clean, idiomatic German for both.
    case "transaction.finalized":
      // Only a finalized transaction carrying a real amount is worth a
      // notification; the dashboard already shows the running total, so keep
      // this calm.
      if (amount == null) return null
      return isAnkauf(p)
        ? make("sales", "info", "Ankauf abgeschlossen", `Auszahlung über ${amount} wurde gebucht.`)
        : make("sales", "info", "Verkauf abgeschlossen", `Beleg über ${amount} wurde gebucht.`)
    case "transaction.stornoed": {
      // `total_eur` is negative on a storno row (DB invariant). Surface the
      // amount as an absolute value so the German reads naturally („über 50,00 €").
      const stornoAmount = amountEur != null ? formatEurString(stripLeadingMinus(amountEur)) : null
      if (isAnkauf(p)) {
        return make(
          "sales",
          "action",
          "Ankauf storniert",
          stornoAmount
            ? `Ein Ankauf über ${stornoAmount} wurde storniert.`
            : "Ein Ankauf wurde storniert.",
        )
      }
      return make(
        "sales",
        "action",
        "Storno gebucht",
        stornoAmount
          ? `Ein Verkauf über ${stornoAmount} wurde storniert.`
          : "Ein Verkauf wurde storniert.",
      )
    }
    case "transaction.returned":
      return make(
        "sales",
        "info",
        "Rückgabe gebucht",
        amount ? `Eine Rückgabe über ${amount} wurde gebucht.` : "Eine Rückgabe wurde gebucht.",
      )

    // ── Fiscal criticals (legal weight — always loud) ───────────────────────
    case "alert.tse_cert_expiry": {
      const days = pnum(p, "daysRemaining", "days_remaining")
      return make(
        "fiscal",
        days != null && days <= 7 ? "critical" : "action",
        "TSE-Zertifikat läuft ab",
        days != null
          ? `Das Signaturzertifikat läuft in ${days} Tagen ab.`
          : "Das Signaturzertifikat läuft bald ab.",
      )
    }
    case "alert.tse_critical_failure":
      return make(
        "fiscal",
        "critical",
        "TSE-Störung",
        "Die technische Sicherheitseinrichtung meldet einen kritischen Fehler.",
      )
    case "alert.hash_chain_verification_failed":
      return make(
        "fiscal",
        "critical",
        "Signaturkette gestört",
        "Die Prüfung der Beleg-Signaturkette ist fehlgeschlagen.",
      )

    // ── System health ───────────────────────────────────────────────────────
    case "alert.worker_job_dead_letter":
      return make(
        "system",
        "critical",
        "Hintergrund-Job fehlgeschlagen",
        "Ein Verarbeitungs-Job landete in der Fehlerwarteschlange (DLQ).",
      )
    case "alert.anomaly_detected":
      return make(
        "system",
        "critical",
        "Anomalie erkannt",
        pstr(p, "reason", "description") ?? "Eine ungewöhnliche Aktivität wurde erkannt.",
      )

    // ── Compliance (GwG / AML) ──────────────────────────────────────────────
    case "alert.suspicious_aml_flagged":
      return make(
        "compliance",
        "critical",
        "Geldwäsche-Verdacht",
        who
          ? `${who} wurde als verdächtig markiert (GwG).`
          : "Ein Vorgang wurde als verdächtig markiert (GwG).",
      )
    case "alert.customer_marked_suspicious":
      return make(
        "compliance",
        "action",
        "Kunde als verdächtig markiert",
        who ? `${who} wurde als verdächtig markiert.` : "Ein Kunde wurde als verdächtig markiert.",
      )
    case "alert.customer_banned":
      return make(
        "compliance",
        "action",
        "Kunde gesperrt",
        who ? `${who} wurde gesperrt.` : "Ein Kunde wurde gesperrt.",
      )

    // ── Channels (eBay) ─────────────────────────────────────────────────────
    case "alert.ebay_sale_conflict":
    case "alert.ebay_double_sale_attempt":
      return make(
        "channels",
        "critical",
        "eBay-Konflikt",
        "Ein Artikel wurde möglicherweise doppelt verkauft (eBay).",
      )

    default:
      // Everything else (routine inventory/KYC/metal churn) is dropped — the
      // Center is for what the owner must notice, not the full audit log.
      return null
  }
}

/**
 * The set of event types `classify()` can ever turn into a notification. The
 * live store passes this to the server-side `eventType` filter when the backend
 * supports per-type narrowing — but since the ledger query takes ONE eventType,
 * the store fetches unfiltered and classifies client-side. Kept exported so the
 * detail view + tests can assert coverage without re-deriving the list.
 */
export const NOTIFIED_EVENT_TYPES: readonly string[] = [
  "command.approval_requested",
  "command.approval_resolved",
  "appointment.scheduled",
  "appointment.booked",
  "appointment.confirmed",
  "appointment.checked_in",
  "appointment.rescheduled",
  "appointment.cancelled",
  "daily_closing.finalized",
  "transaction.finalized",
  "transaction.stornoed",
  "transaction.returned",
  "alert.tse_cert_expiry",
  "alert.tse_critical_failure",
  "alert.hash_chain_verification_failed",
  "alert.worker_job_dead_letter",
  "alert.anomaly_detected",
  "alert.suspicious_aml_flagged",
  "alert.customer_marked_suspicious",
  "alert.customer_banned",
  "alert.ebay_sale_conflict",
  "alert.ebay_double_sale_attempt",
] as const

// ── Relative-time (German) ────────────────────────────────────────────────────
/**
 * Normalise a server timestamp into a string the Hermes engine can parse.
 *
 * Some endpoints (the WhatsApp inbox among them) serialise instants via a
 * Postgres `::text` timestamptz, e.g. `"2026-06-21 04:28:55.106035+00"` — a
 * SPACE separator, six-digit fractional seconds and a bare `+00` offset. That is
 * NOT ISO 8601, and Hermes (the app's on-device JS runtime) only parses ISO 8601:
 * `new Date("2026-06-21 04:28:55.106035+00")` yields an Invalid Date on the
 * device (even though Node/V8 parse it leniently — which is why it slipped
 * through). The result was BLANK timestamps on every WhatsApp thread row, bubble
 * and „erledigt"-line. We turn the Postgres shape into a parseable one:
 * `space → T`, fraction clamped to three digits, bare `±HH` / `±HHMM` expanded to
 * `±HH:MM`. Idempotent for values that are already ISO (`…Z` passes through).
 */
function toParseable(value: string): string {
  return value
    .trim()
    .replace(" ", "T") // date/time separator
    .replace(/(\.\d{3})\d+/, "$1") // clamp sub-ms fraction → ms
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2") // +0200 → +02:00
    .replace(/([+-]\d{2})$/, "$1:00") // +00 → +00:00
}

/**
 * A calm German "vor … " relative time for a row's timestamp, with an absolute
 * de-DE fallback once a notification is older than a day. Pure; the screen calls
 * it on render. „gerade eben" for the first minute keeps fresh alerts feeling
 * live without a churning second-by-second counter.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(toParseable(iso)).getTime()
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
