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
 * Default denominators for the value rings.
 *
 * Honesty rule (DESIGN.md §4): the displayed VALUES are always real numbers from
 * real endpoints. These constants are the ring DENOMINATORS, and they split into
 * two honest kinds:
 *   • OWNER-EDITABLE GOALS — revenueEur, netProfitDayEur, monthRevenueEur,
 *     monthlyProfitTargetEur. These seed `DEFAULT_DASHBOARD_TARGETS` in
 *     preferences.ts; the owner overrides them in Einstellungen. A surface reads
 *     them via `useDashboardTargets()` and may honestly label them „Ziel".
 *   • HOUSE REFERENCES — ankaufCount, soldCount, appraisals, inventoryValueEur,
 *     goldGrams, silverGrams. Not yet owner-editable, so a surface must present
 *     them as a reference („Orientierung"/„Referenz"), never as an owner's „Ziel".
 * TODO(phase-later): make the reference set owner-editable too, then they become
 * real Ziele as well.
 */
export const GAUGE_TARGETS = {
  /** Tagesumsatz goal in EUR (owner-editable default). */
  revenueEur: 1000,
  /** Ankäufe heute fill reference (count). */
  ankaufCount: 10,
  /** Verkäufe heute fill reference (count). */
  soldCount: 20,
  /** Expertisen (pending appraisals) fill reference (count). */
  appraisals: 10,
  /** Gewinn heute goal in EUR (net profit, period=day; owner-editable default). */
  netProfitDayEur: 300,
  /** Monatsumsatz goal in EUR (owner-editable default). */
  monthRevenueEur: 25000,
  /** Lagerwert (Listenwert) reference in EUR — "Füllstand der Schatzkammer". */
  inventoryValueEur: 50000,
  /** Goldbestand reference in grams. */
  goldGrams: 500,
  /** Silberbestand reference in grams. */
  silverGrams: 2000,
  /** Monatlicher Gewinn-Ziel in EUR (owner-editable default; the chest at the map's end). */
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
  /**
   * Gross margin this month = netProfit + fixedCost (revenue − Ankauf − variable
   * expenses, BEFORE fixed costs). This is what is measured against the fixed
   * costs for the "Fixkosten gedeckt" gauge.
   */
  grossMarginCents: number
  /** True once the month is in the black — netProfit ≥ 0, i.e. fixed costs covered. */
  brokeEven: boolean
  /** Cents of net profit still needed to reach break-even (0 once in the black). */
  toBreakEvenCents: number
  /**
   * grossMargin / fixedCost clamped to [0,1] — the share of the month's fixed
   * costs already earned back. Reaches 1.0 exactly at break-even (netProfit = 0).
   */
  coverage: number
  /**
   * netProfit / target clamped to [0,1] — progress toward the owner's monthly
   * net-profit goal, past break-even. 0 when no positive target is supplied
   * (so a surface without an owner goal simply doesn't draw this axis).
   */
  targetProgress: number
}

/**
 * Monthly treasure map: cumulative gross margin vs the month's fixed costs (the
 * break-even line). `netProfitCents` is the month's netProfit from
 * financeApi.profit({ period: "month" }) — which ALREADY has the full month's
 * fixed costs subtracted (apps/api-cloud/src/routes/finance.ts, fixedScale=1.0).
 * `fixedCostCents` is monthlyFixedCostCents(...). `targetProfitCents` is the
 * owner's OWN monthly net-profit goal (from preferences) — pass 0 to omit it.
 *
 * Because fixed costs are already netted out, TRUE break-even is netProfit ≥ 0,
 * NOT netProfit ≥ fixedCost (that would require earning ~2× fixed costs first).
 * The "Fixkosten gedeckt" gauge measures gross margin (netProfit + fixedCost)
 * against the fixed-cost line, so it fills to 100 % exactly when netProfit hits 0;
 * `targetProgress` then tracks real net profit toward the owner's own goal.
 *
 * Pure + honest: a negative profit just yields partial coverage, never a fabricated
 * win, and the target axis is the owner's real number (or absent).
 */
export function computeTreasureMap(
  netProfitCents: number,
  fixedCostCents: number,
  targetProfitCents = 0,
): TreasureMap {
  const safeProfit = Number.isFinite(netProfitCents) ? netProfitCents : 0
  const safeFixed = Number.isFinite(fixedCostCents) ? Math.max(0, fixedCostCents) : 0
  const safeTarget = Number.isFinite(targetProfitCents) ? Math.max(0, targetProfitCents) : 0
  const grossMarginCents = safeProfit + safeFixed
  const brokeEven = safeProfit >= 0
  const toBreakEvenCents = brokeEven ? 0 : -safeProfit
  const coverage =
    safeFixed <= 0
      ? brokeEven
        ? 1
        : 0
      : Math.max(0, Math.min(1, grossMarginCents / safeFixed))
  const targetProgress =
    safeTarget > 0 ? Math.max(0, Math.min(1, safeProfit / safeTarget)) : 0
  return {
    netProfitCents: safeProfit,
    fixedCostCents: safeFixed,
    grossMarginCents,
    brokeEven,
    toBreakEvenCents,
    coverage,
    targetProgress,
  }
}
