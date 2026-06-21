/**
 * Live owner alerts — the "Jetzt"-Schicht of the Notifications Center.
 *
 * The rest of the Center is a HISTORY feed: every row is a past `ledger_events`
 * row, classified by `types.ts`. But some of what an owner most needs to notice
 * is not an event that fired once — it is the CURRENT STATE of the business right
 * now: a Verkauf paused and waiting for a Freigabe, the next Termin coming up, a
 * Hintergrund-Job stuck in the DLQ, the TSE-Zertifikat running low on Vorlauf.
 * Those are LIVE COUNTS, not log lines, and they live in the bridge snapshot
 * (`GET /api/bridge/summary`, ADMIN) the Schatzkammer dashboard already reads.
 *
 * This module is the pure heart of that live layer: a single `deriveLiveAlerts`
 * that maps ONE real `BridgeSummary` to the owner-facing alerts it warrants —
 * plus the German copy and the deep-link target each one taps through to. No
 * React, no fetch here; the section component fetches the snapshot and renders
 * what this returns, so the rules are trivially unit-testable.
 *
 * ── Honesty rule (absolute) ────────────────────────────────────────────────────
 * An alert exists ONLY because a real field in a real snapshot crossed a real
 * threshold. We never fabricate one: zero approvals → no approvals alert; a
 * `null` TSE headroom (the cert isn't readable) → no fiscal alert, not a fake
 * „0 Tage". Every number shown is the snapshot's own number, formatted de-DE.
 *
 * ── Severity mirrors the SERVER ────────────────────────────────────────────────
 * The thresholds are taken verbatim from the api-cloud `deriveStatus` that
 * already computes `systemStatus` server-side
 * (`apps/api-cloud/src/routes/bridge.ts`):
 *   • TSE cert  < 7 Tage   → the server says `alert`  → we mark `critical`.
 *   • TSE cert  ≤ 30 Tage  → the server says `watch`  → we mark `action`.
 *   • DLQ       > 0        → the server says `watch`  → `critical` (a stuck job
 *                            is operational breakage the owner must clear).
 *   • approvals > 0        → the server says `watch`  → `action` (someone is
 *                            literally waiting at the till).
 * Reusing the SAME numbers means the bell, the dashboard badge, and this list can
 * never disagree about what „dringend" means.
 *
 * German UI throughout; the screen maps severity/channel → theme tokens (never a
 * hardcoded colour here, per DESIGN.md §4).
 */
import type { BridgeSummary } from "@warehouse14/api-client"

import type { NotificationChannel, NotificationSeverity } from "./types"

// ── Server-mirrored thresholds (kept in one place so they read as the contract) ─
/** Below this many days of TSE-cert headroom the server escalates to `alert`. */
export const TSE_CRITICAL_DAYS = 7
/** At/below this many days the server is already in `watch`. */
export const TSE_WATCH_DAYS = 30

// ── The model ─────────────────────────────────────────────────────────────────
/**
 * One live, state-derived owner alert. Deliberately shaped like the history
 * `Notification` (same channel + severity vocabulary, same title/body) so the
 * section can lean on the exact same view mappings the feed rows use — one look,
 * two sources.
 */
export interface LiveAlert {
  /** Stable key for the list + de-dupe (one per kind; a kind appears at most once). */
  kind: LiveAlertKind
  channel: NotificationChannel
  severity: NotificationSeverity
  /** Short German headline. */
  title: string
  /** One-line German detail, built only from the snapshot's own numbers. */
  body: string
  /** The live count/figure this alert is about (for the row's right-hand value). */
  count: number | null
  /** Where „Öffnen" routes — a route path string the screen turns into an Href. */
  href: string | null
  /** German label for the tap-through CTA / row affordance. */
  hrefLabel: string | null
}

/** The closed set of live-alert kinds (one row each, at most once). */
export type LiveAlertKind =
  | "approvals"
  | "next_appointment"
  | "worker_dlq"
  | "tse_cert"
  | "whatsapp_unread"
  | "intake_drafts"

// ── de-DE time helpers (standalone — no import from api.ts to stay pure) ────────
/**
 * „heute um HH:MM Uhr" / „morgen um HH:MM Uhr" / „am DD.MM. um HH:MM Uhr" for the
 * next appointment, from its ISO `starts_at`. Returns null on an unparseable date
 * so the caller degrades to a count-free body rather than print „Invalid Date".
 */
export function formatNextAppointment(iso: string, now: Date = new Date()): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000)
  if (dayDiff === 0) return `heute um ${time} Uhr`
  if (dayDiff === 1) return `morgen um ${time} Uhr`
  const date = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
  return `am ${date} um ${time} Uhr`
}

/**
 * Minutes until the next appointment (>= 0), or null if it is in the past /
 * unparseable. Drives the „in N Minuten" nudge when a Termin is imminent.
 */
function minutesUntil(iso: string, now: Date): number | null {
  const d = new Date(iso).getTime()
  if (!Number.isFinite(d)) return null
  const diff = Math.round((d - now.getTime()) / 60_000)
  return diff >= 0 ? diff : null
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

// ── The derivation ─────────────────────────────────────────────────────────────
/**
 * Map a real bridge snapshot to the live alerts it warrants, in a STABLE,
 * severity-aware order (criticals first, then actions). Returns `[]` when nothing
 * needs the owner — the section then shows its calm „alles ruhig" line, never an
 * invented row.
 *
 * `now` is injectable so the appointment phrasing is deterministic under test.
 */
export function deriveLiveAlerts(summary: BridgeSummary, now: Date = new Date()): LiveAlert[] {
  const alerts: LiveAlert[] = []

  // ── TSE-Zertifikat headroom (fiscal — legal weight, mirrors deriveStatus) ────
  // Only when the cert headroom is actually READABLE (a real number). A null
  // means the cert state is unknown — we stay silent rather than fake a count.
  const tseDays = summary.tseCertDaysRemaining
  if (typeof tseDays === "number" && Number.isFinite(tseDays) && tseDays <= TSE_WATCH_DAYS) {
    const critical = tseDays < TSE_CRITICAL_DAYS
    alerts.push({
      kind: "tse_cert",
      channel: "fiscal",
      severity: critical ? "critical" : "action",
      title: "TSE-Zertifikat läuft ab",
      body:
        tseDays <= 0
          ? "Das Signaturzertifikat der TSE ist abgelaufen — bitte sofort erneuern."
          : `Das Signaturzertifikat läuft in ${tseDays} ${plural(tseDays, "Tag", "Tagen")} ab.`,
      count: tseDays,
      // No CTA: the app has no TSE/Zertifikat resolution surface yet — neither
      // `einstellungen.tsx` (Belegtext + Kategorien + Logout, no fiscal-cert
      // section) nor anywhere else. An „Öffnen" that lands on a screen which
      // can't address the alert is the „Öffnen that goes nowhere" the history
      // feed's deepLink() forbids, so we stay honest and show no tap-through —
      // exactly like the worker_dlq alert below. Renewing the cert is a
      // back-office/TSE-provider action, not an in-app one today.
      href: null,
      hrefLabel: null,
    })
  }

  // ── Worker DLQ (system — a stuck job is breakage; server: watch → we: critical)
  if (summary.workerDlqUnacked > 0) {
    const n = summary.workerDlqUnacked
    alerts.push({
      kind: "worker_dlq",
      channel: "system",
      severity: "critical",
      title: "Hintergrund-Jobs hängen",
      body: `${n} ${plural(n, "Job liegt", "Jobs liegen")} in der Fehlerwarteschlange (DLQ) und ${plural(n, "wartet", "warten")} auf Klärung.`,
      count: n,
      href: null,
      hrefLabel: null,
    })
  }

  // ── Freigaben (approvals — someone is waiting at the till; server: watch) ────
  if (summary.approvalsPending > 0) {
    const n = summary.approvalsPending
    alerts.push({
      kind: "approvals",
      channel: "approvals",
      severity: "action",
      title: plural(n, "Freigabe wartet", "Freigaben warten"),
      body: `${n} ${plural(n, "Verkauf wartet", "Verkäufe warten")} auf deine Freigabe an der Kasse.`,
      count: n,
      // No CTA: `kasse.tsx` is the Z-Bon/Schicht/closings surface — it has NO
      // Freigabe UI, and there is no approvals API wrapper in api.ts to resolve
      // one from the phone. The high-value sale gate lives on the POS / Owner
      // Control Desktop. Routing „Zur Kasse" here was an „Öffnen that goes
      // nowhere"; until a real Freigabe surface exists we surface the count
      // honestly with no dead tap-through.
      href: null,
      hrefLabel: null,
    })
  }

  // ── Nächster Termin (appointments — the calm „what's next" nudge) ────────────
  // Only when there IS a next appointment AND it is still in the future. We lead
  // with how soon it is; an imminent one (≤ 60 min) reads as an action nudge,
  // anything further out is calm info.
  if (summary.nextAppointmentAt) {
    const when = formatNextAppointment(summary.nextAppointmentAt, now)
    const mins = minutesUntil(summary.nextAppointmentAt, now)
    if (when != null && mins != null) {
      const imminent = mins <= 60
      alerts.push({
        kind: "next_appointment",
        channel: "appointments",
        severity: imminent ? "action" : "info",
        title: "Nächster Termin",
        body:
          summary.todayAppointmentCount > 1
            ? `Der nächste von ${summary.todayAppointmentCount} Terminen heute ist ${when}.`
            : `Der nächste Termin ist ${when}.`,
        count: null,
        href: "/termine",
        hrefLabel: "Zu den Terminen",
      })
    }
  }

  // ── WhatsApp ungelesen (channels — the owner's inbox is waiting) ─────────────
  if (summary.whatsappUnreadCount > 0) {
    const n = summary.whatsappUnreadCount
    alerts.push({
      kind: "whatsapp_unread",
      channel: "channels",
      severity: "info",
      title: plural(n, "WhatsApp-Nachricht", "WhatsApp-Nachrichten"),
      body: `${n} ungelesene ${plural(n, "Nachricht", "Nachrichten")} im WhatsApp-Posteingang.`,
      count: n,
      href: "/whatsapp",
      hrefLabel: "Zum Posteingang",
    })
  }

  // ── Artikel-Entwürfe (inventory — products still in the DRAFT lifecycle state) ─
  // The bridge derives this from `COUNT(*) FROM products WHERE status='DRAFT'`
  // (bridge.ts) — ANY product in the FIRST lifecycle state (DRAFT→AVAILABLE→…,
  // migration 0006), NOT specifically an Ankauf. Calling these „Ankauf-Entwürfe"
  // and routing to `/ankauf` (which only STARTS a new buy-in, it can't resume a
  // DRAFT) misrepresented the number and led nowhere. The count is real, so we
  // keep the alert — but with honest, neutral wording („Artikel-Entwürfe") and
  // no CTA, since there is no DRAFT-listing surface to tap through to yet.
  if (summary.intakeDraftsPending > 0) {
    const n = summary.intakeDraftsPending
    alerts.push({
      kind: "intake_drafts",
      channel: "sales",
      severity: "info",
      title: plural(n, "Artikel-Entwurf", "Artikel-Entwürfe"),
      body: `${n} ${plural(n, "Artikel ist", "Artikel sind")} noch im Entwurf und ${plural(n, "wartet", "warten")} auf die Veröffentlichung.`,
      count: n,
      href: null,
      hrefLabel: null,
    })
  }

  // Stable, severity-aware order: criticals first, then actions, then info —
  // within a tier the push order above (fiscal → system → approvals → …) holds.
  return alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

/** Local severity ranking for the stable sort (higher = louder, sorted first). */
const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  critical: 2,
  action: 1,
  info: 0,
}

/**
 * The loudest severity among a set of alerts, or null when there are none — the
 * section header uses it to tint its summary line + decide between the calm bell
 * and the ringing one, exactly like the history feed's `hasCriticalUnread`.
 */
export function peakSeverity(alerts: readonly LiveAlert[]): NotificationSeverity | null {
  let peak: NotificationSeverity | null = null
  for (const a of alerts) {
    if (peak == null || SEVERITY_RANK[a.severity] > SEVERITY_RANK[peak]) peak = a.severity
  }
  return peak
}
