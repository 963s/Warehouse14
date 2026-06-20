/**
 * Pure Schatzkammer derivations — the "Schlage gestern" daily quest + the streak,
 * computed from REAL finalized daily closings. No fabrication:
 *   • "gestern" = the net Verkauf of the most recent FINALIZED business day
 *     strictly before today (closingsApi.list → netVerkaufEur, in cents).
 *   • the streak = consecutive most-recent finalized days that beat the prior day.
 *   • "heute" = today's live revenue in cents (from the bridge snapshot).
 * If there is no prior finalized day yet, yesterday is null and the quest renders
 * honestly ("noch kein Vortag") rather than inventing a number.
 */
import type { ClosingListItem, FixedCostRow } from "@warehouse14/api-client"

/**
 * v0 gauge targets (value/target rings). Sensible constant defaults.
 * TODO(phase-later): move to owner-editable settings.
 */
export const GAUGE_TARGETS = {
  /** Tagesumsatz target in EUR. */
  revenueEur: 1000,
  /** Ankäufe heute target (count). */
  ankaufCount: 10,
  /** Verkäufe heute target (count). */
  soldCount: 20,
  /** Expertisen (pending appraisals) target (count). */
  appraisals: 10,
  /** Gewinn heute target in EUR (net profit, period=day). */
  netProfitDayEur: 300,
  /** Monatsumsatz target in EUR. */
  monthRevenueEur: 25000,
  /** Lagerwert (Listenwert) reference in EUR — "Füllstand der Schatzkammer". */
  inventoryValueEur: 50000,
  /** Goldbestand reference in grams. */
  goldGrams: 500,
  /** Silberbestand reference in grams. */
  silverGrams: 2000,
  /** Monthly net-profit goal in EUR (the chest at the end of the treasure map). */
  monthlyProfitTargetEur: 5000,
} as const

export interface DailyQuest {
  /** Today's live revenue in cents (from the bridge snapshot). */
  todayCents: number
  /** Most recent finalized prior day's net Verkauf in cents, or null if none. */
  yesterdayCents: number | null
  /** True once today strictly beats yesterday (and yesterday is known). */
  beaten: boolean
  /** Cents still needed to beat yesterday (0 once beaten or yesterday unknown). */
  remainingCents: number
  /** today / yesterday, clamped to [0,1] for the progress bar (0 if no yesterday). */
  progress: number
}

function netVerkaufCents(c: ClosingListItem): number {
  // netVerkaufEur is a decimal EUR string; round to integer cents.
  return Math.round(Number(c.netVerkaufEur) * 100)
}

/**
 * Finalized closings strictly BEFORE `todayBusinessDay` (YYYY-MM-DD), oldest →
 * newest. Excluding today keeps "gestern" and the streak over completed days only.
 * Pass an empty string to include every finalized day.
 */
function finalizedBefore(closings: ClosingListItem[], todayBusinessDay: string): ClosingListItem[] {
  return closings
    .filter((c) => c.state === "FINALIZED")
    .filter((c) => todayBusinessDay === "" || c.businessDay < todayBusinessDay)
    .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
}

export function computeDailyQuest(
  todayCents: number,
  closings: ClosingListItem[],
  todayBusinessDay = "",
): DailyQuest {
  const fin = finalizedBefore(closings, todayBusinessDay)
  const last = fin[fin.length - 1]
  const yesterdayCents = last ? netVerkaufCents(last) : null
  if (yesterdayCents === null) {
    return { todayCents, yesterdayCents: null, beaten: false, remainingCents: 0, progress: 0 }
  }
  const beaten = todayCents > yesterdayCents
  const remainingCents = beaten ? 0 : Math.max(0, yesterdayCents - todayCents)
  const progress =
    yesterdayCents <= 0 ? (todayCents > 0 ? 1 : 0) : Math.min(1, todayCents / yesterdayCents)
  return { todayCents, yesterdayCents, beaten, remainingCents, progress }
}

/**
 * Consecutive most-recent finalized business days (before today) where net
 * Verkauf beat the prior finalized day. Walks back from the newest; stops at the
 * first non-beat. Returns 0 with fewer than two qualifying days.
 */
export function computeStreak(closings: ClosingListItem[], todayBusinessDay = ""): number {
  const fin = finalizedBefore(closings, todayBusinessDay)
  let streak = 0
  for (let i = fin.length - 1; i >= 1; i--) {
    const cur = fin[i]
    const prev = fin[i - 1]
    if (cur && prev && netVerkaufCents(cur) > netVerkaufCents(prev)) streak++
    else break
  }
  return streak
}

/** Local business day as YYYY-MM-DD (device tz ≈ Europe/Berlin in this app). */
export function todayBusinessDay(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// ── Finanz-Modul derivations (pure; no fabrication) ──────────────────────────

/** First day of `now`'s month as YYYY-MM-DD (the month boundary for filters). */
export function monthStartDay(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}-01`
}

/**
 * Total active monthly Fixkosten in CENTS for `monthStart` (YYYY-MM-DD). A row
 * counts when it is active on the first of the month: activeFrom ≤ monthStart and
 * (no activeTo, or activeTo ≥ monthStart). Empty list → 0 (honest: no fixed costs
 * configured yet).
 */
export function monthlyFixedCostCents(rows: FixedCostRow[], monthStart: string): number {
  return rows
    .filter((r) => r.activeFrom <= monthStart && (r.activeTo === null || r.activeTo >= monthStart))
    .reduce((sum, r) => sum + r.monthlyAmountCents, 0)
}

export interface TreasureMap {
  /** Cumulative net profit this month in cents (may be negative early on). */
  netProfitCents: number
  /** Total active monthly fixed cost in cents (the break-even line). */
  fixedCostCents: number
  /** True once cumulative net profit covers the month's fixed costs. */
  brokeEven: boolean
  /** Cents still needed to reach break-even (0 once covered). */
  toBreakEvenCents: number
  /** netProfit / fixedCost clamped to [0,1] — the bar fill toward break-even. */
  coverage: number
  /**
   * Where the break-even marker sits on a "profit" axis that runs to `targetCents`,
   * as a 0..1 fraction (so the map can place the flag). null when no target/cost.
   */
  breakEvenMarker: number | null
  /** netProfit / targetCents clamped to [0,1] — progress toward the profit goal. */
  targetProgress: number
}

/**
 * Monthly treasure map: cumulative net profit vs the month's fixed costs (the
 * break-even line) and a net-profit target. `netProfitCents` is the month's
 * netProfit from financeApi.profit({ period: "month" }); `fixedCostCents` is
 * monthlyFixedCostCents(...). `targetCents` is the owner's monthly net-profit
 * goal (the chest at the end of the map). Pure + honest: a negative profit just
 * yields 0 coverage, never a fabricated win.
 */
export function computeTreasureMap(
  netProfitCents: number,
  fixedCostCents: number,
  targetCents: number,
): TreasureMap {
  const safeProfit = Number.isFinite(netProfitCents) ? netProfitCents : 0
  const brokeEven = fixedCostCents <= 0 ? safeProfit > 0 : safeProfit >= fixedCostCents
  const toBreakEvenCents = brokeEven ? 0 : Math.max(0, fixedCostCents - safeProfit)
  const coverage =
    fixedCostCents <= 0
      ? safeProfit > 0
        ? 1
        : 0
      : Math.max(0, Math.min(1, safeProfit / fixedCostCents))
  const breakEvenMarker =
    targetCents > 0 && fixedCostCents > 0 ? Math.min(1, fixedCostCents / targetCents) : null
  const targetProgress = targetCents > 0 ? Math.max(0, Math.min(1, safeProfit / targetCents)) : 0
  return {
    netProfitCents: safeProfit,
    fixedCostCents,
    brokeEven,
    toBreakEvenCents,
    coverage,
    breakEvenMarker,
    targetProgress,
  }
}
