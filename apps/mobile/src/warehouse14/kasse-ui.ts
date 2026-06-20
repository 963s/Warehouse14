/**
 * Kasse-UI — presentation helpers for the Kasse-Fläche (src/app/kasse.tsx).
 *
 * READ-FIRST FISCAL SAFETY: this surface mostly READS the fiscal record — the
 * open Schicht (shifts.getCurrent) and the finalized Tagesabschlüsse
 * (closingsApi.list). The ONLY mutation is the Z-Bon finalize, which is gated
 * behind step-up + a clear confirm dialog and never fires automatically.
 *
 * Money on the wire here is EUR DECIMAL STRINGS (netVerkaufEur, varianceEur, …),
 * NOT integer cents — so the screen formats them with `formatEur`, never
 * `formatCents`. This module owns the label/state/sorting logic so the screen
 * stays declarative; nothing here touches the network.
 */
import type { ClosingListItem, ShiftStatus } from "@warehouse14/api-client"

// ── Closing state (COUNTING | FINALIZED) ──────────────────────────────────────
export type ClosingState = ClosingListItem["state"]

export const CLOSING_STATE_LABELS: Record<ClosingState, string> = {
  COUNTING: "Offen",
  FINALIZED: "Abgeschlossen",
}

/** Badge variant per closing state — FINALIZED is the legally-sealed Z-Bon. */
export function closingStateBadgeVariant(state: ClosingState): "default" | "secondary" | "outline" {
  return state === "FINALIZED" ? "default" : "outline"
}

// ── Shift status ──────────────────────────────────────────────────────────────
export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  OPEN: "Geöffnet",
  CLOSED: "Geschlossen",
}

// ── Cash-variance tone ────────────────────────────────────────────────────────
export type VarianceTone = "primary" | "accent" | "muted"

/**
 * Map a cash-variance EUR string to a colour intent for a StatTile:
 *   • null / unzählbar → muted (no blind count yet)
 *   • exactly 0,00     → accent (verdigris — the till balances)
 *   • anything else     → primary (brass — a difference to review; we do NOT
 *     paint it destructive, a variance is a fact to inspect, not an error)
 */
export function varianceTone(eur: string | null): VarianceTone {
  if (eur == null) return "muted"
  const value = Number(eur)
  if (!Number.isFinite(value)) return "muted"
  return value === 0 ? "accent" : "primary"
}

// ── Business-day formatting ───────────────────────────────────────────────────
/** Format an ISO businessDay (YYYY-MM-DD) as a de-DE weekday + date. */
export function formatBusinessDay(isoDay: string): string {
  // businessDay is a calendar day; parse as local midnight to avoid TZ drift.
  const d = new Date(`${isoDay}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDay
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

/** Format an ISO-8601 timestamp as a de-DE date + time, or null when absent. */
export function formatTimestamp(iso: string | null): string | null {
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

// ── Closings ordering ─────────────────────────────────────────────────────────
/**
 * Newest business day first. The backend does NOT guarantee order (see
 * api.ts#listClosings), so the screen always sorts before rendering.
 */
export function sortClosingsNewestFirst(items: readonly ClosingListItem[]): ClosingListItem[] {
  return [...items].sort((a, b) => b.businessDay.localeCompare(a.businessDay))
}

/**
 * Is the current trading day still unsealed? TRUE when there is NO daily_closings
 * row for `today` yet — the normal state of an active till before its Z-Bon.
 *
 * The backend only ever writes FINALIZED rows (no COUNTING state is ever
 * produced), so "is today open?" cannot be read from a row's state — it must be
 * read from the ABSENCE of today's row. This is the honest source of the
 * "Offene Tage" / "Tagesabschluss ausstehend" signal.
 */
export function isTodayOpen(items: readonly ClosingListItem[], todayBusinessDay: string): boolean {
  return !items.some((c) => c.businessDay === todayBusinessDay)
}

// ── Fiskalischer Überblick ────────────────────────────────────────────────────
/**
 * The honest, real-number summary of the fiscal record — derived purely from the
 * fetched closings (+ the current business day), never fabricated. Drives the
 * trust header: whether the current day still awaits its Z-Bon, how many days are
 * already legally sealed, and the count of TSE failures the record reports.
 *
 * HONESTY: "open days" is NOT "rows in COUNTING state" — the backend never
 * produces a COUNTING row, so that would always read 0 and falsely claim "alles
 * abgeschlossen" while an active till runs unsealed. Instead it is derived from
 * the ABSENCE of today's closing row: a trading day with no daily_closings row is
 * genuinely open and unsealed. `todayBusinessDay` may be omitted (empty string)
 * when the current day cannot be determined — then we make no open-day claim.
 */
export interface FiscalOverview {
  /** TRUE when the current trading day has no Z-Bon yet (genuinely unsealed). */
  todayOpen: boolean
  /** Days already sealed with a finalized Z-Bon. */
  finalizedDays: number
  /**
   * Sum of TSE failures the record reports across visible closings. NOTE: the
   * backend currently hardcodes tse_failed_count to 0 on every finalize (the
   * Fiskaly failure source is not yet wired), so a 0 here means "no failure
   * recorded", NOT a verified-complete TSE protocol — the UI must not present it
   * as a positive "lückenlos" guarantee.
   */
  tseFailures: number
}

export function fiscalOverview(
  items: readonly ClosingListItem[],
  todayBusinessDay = "",
): FiscalOverview {
  let finalizedDays = 0
  let tseFailures = 0
  for (const c of items) {
    if (c.state === "FINALIZED") finalizedDays += 1
    tseFailures += c.tseFailedCount
  }
  const todayOpen = todayBusinessDay !== "" && isTodayOpen(items, todayBusinessDay)
  return { todayOpen, finalizedDays, tseFailures }
}

// ── Export file naming ────────────────────────────────────────────────────────
export type ExportKind = "datev" | "kassenbericht"

export const EXPORT_LABELS: Record<ExportKind, string> = {
  datev: "DATEV-Export",
  kassenbericht: "Kassenbericht",
}

/** A stable, human cache filename for a shared CSV, e.g. "DATEV_2026-06-19.csv". */
export function exportFileName(kind: ExportKind, businessDay: string): string {
  const prefix = kind === "datev" ? "DATEV" : "Kassenbericht"
  return `${prefix}_${businessDay}.csv`
}
