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
export function closingStateBadgeVariant(
  state: ClosingState,
): "default" | "secondary" | "outline" {
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

/** The most recent closing still in COUNTING — the candidate for a Z-Bon. */
export function latestCountingDay(items: readonly ClosingListItem[]): string | null {
  const counting = sortClosingsNewestFirst(items).find((c) => c.state === "COUNTING")
  return counting?.businessDay ?? null
}

// ── Fiskalischer Überblick ────────────────────────────────────────────────────
/**
 * The honest, real-number summary of the fiscal record — derived purely from the
 * fetched closings, never fabricated. Drives the trust header: how many days are
 * still open (await a Z-Bon), how many are legally sealed, and the total count of
 * TSE failures across the visible window (the one figure that, if non-zero, means
 * the audit trail needs attention).
 */
export interface FiscalOverview {
  /** Days still in COUNTING — each can be finalized with a Z-Bon. */
  openDays: number
  /** Days already sealed with a finalized Z-Bon. */
  finalizedDays: number
  /** Sum of TSE failures across all visible closings (0 = clean trail). */
  tseFailures: number
}

export function fiscalOverview(items: readonly ClosingListItem[]): FiscalOverview {
  let openDays = 0
  let finalizedDays = 0
  let tseFailures = 0
  for (const c of items) {
    if (c.state === "FINALIZED") finalizedDays += 1
    else openDays += 1
    tseFailures += c.tseFailedCount
  }
  return { openDays, finalizedDays, tseFailures }
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
