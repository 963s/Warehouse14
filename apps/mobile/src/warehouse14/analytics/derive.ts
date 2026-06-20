/**
 * Pure Analytics derivations — turn the REAL Owner-OS read aggregates into the
 * chart kit's datum shapes (`SeriesPoint` / `RankItem`), with zero fabrication.
 *
 * The honesty rule (DESIGN.md §4) is the whole point of this file. Every number
 * a chart renders has to trace back to a real endpoint, so the derivations here
 * only ever RESHAPE real data — they never invent, interpolate, or back-fill a
 * value to make a chart look fuller. Where a series would otherwise have a gap
 * (no closing finalized for a day), the gap stays a gap (it is simply absent
 * from the closings list); we never paint a fabricated 0 that would read as a
 * real "nothing happened" day. The screen's chart components carry the explicit
 * empty / locked state for the genuinely-empty case.
 *
 * Data sources (all already wrapped in ../api):
 *   • closings  — closingsApi.list(): finalized daily Z-Bons. The only true
 *                 day-over-day TIME SERIES we have. Each row carries
 *                 netVerkaufEur / netAnkaufEur (decimal EUR strings) and
 *                 verkauf/ankauf counts, keyed by businessDay (YYYY-MM-DD).
 *   • categoryTree — categoriesApi.tree(): the taxonomy with a productCount per
 *                 node. Gives an honest "inventory by category" distribution
 *                 (a count of items currently filed under each leaf), NOT a
 *                 sales ranking — there is no per-product sales aggregate
 *                 endpoint yet, so the screen labels this honestly.
 *
 * Money convention: closings expose EUR DECIMAL STRINGS; we convert to integer
 * CENTS once, here (mirroring schatzkammer.netVerkaufCents), so every chart can
 * format with the same de-DE `formatCents`.
 */
import type {
  CategoryNode,
  CategoryTreeResponse,
  ClosingListItem,
} from "@warehouse14/api-client"
import type { RankItem, SeriesPoint } from "@/warehouse14/ui"

// ── Money: EUR decimal string → integer cents (single, shared conversion) ────
/** Round a decimal EUR string to integer cents. Non-finite input → 0 (honest). */
export function eurToCents(eur: string | null | undefined): number {
  if (eur == null) return 0
  const n = Number(eur)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// ── Reporting window ─────────────────────────────────────────────────────────
/** The trend windows the Analytics surface offers. */
export type AnalyticsPeriod = "week" | "month" | "quarter"

/** How many of the most-recent finalized days each window charts. */
export const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  week: 7,
  month: 30,
  quarter: 90,
}

// ── Short de-DE axis labels (the chart's own micro-captions) ─────────────────
/** Cache one formatter per pattern (toLocaleString is not free on RN/Hermes). */
const weekdayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short" })
const dayMonthFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" })
const fullDayFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
})

/** Parse an ISO business day (YYYY-MM-DD) as local midnight (no TZ drift). */
function parseDay(isoDay: string): Date | null {
  const d = new Date(`${isoDay}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The short axis label under a bar. A week window reads best as weekdays
 * (Mo · Di · …); longer windows as day.month (16.06.) so the columns stay
 * unambiguous across month boundaries. Falls back to the raw ISO on a bad date.
 */
function axisLabel(isoDay: string, period: AnalyticsPeriod): string {
  const d = parseDay(isoDay)
  if (!d) return isoDay
  return period === "week" ? weekdayFmt.format(d) : dayMonthFmt.format(d)
}

/** The full accessibility label for a column, e.g. "Montag, 16.06.". */
function fullDayLabel(isoDay: string): string {
  const d = parseDay(isoDay)
  return d ? fullDayFmt.format(d) : isoDay
}

// ── Closings → the daily time series ─────────────────────────────────────────
/**
 * Finalized closings, oldest → newest, capped to the last `days` rows.
 *
 * Only FINALIZED days are charted — a day still COUNTING has provisional totals
 * that would move, so charting it would show a number that later changes
 * (dishonest by §4). We sort by businessDay and keep the tail so the window is
 * always the most-recent completed days. No gap-filling: a missing day is simply
 * not in the list, and the chart's own empty state covers a fully-empty window.
 */
export function finalizedSeries(
  closings: readonly ClosingListItem[],
  days: number,
): ClosingListItem[] {
  return closings
    .filter((c) => c.state === "FINALIZED")
    .slice()
    .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
    .slice(-Math.max(1, days))
}

/** One column = one finalized day's net Verkauf (revenue), in cents. */
export function revenueTrend(
  closings: readonly ClosingListItem[],
  period: AnalyticsPeriod,
): SeriesPoint[] {
  const rows = finalizedSeries(closings, PERIOD_DAYS[period])
  return rows.map((c) => ({
    value: eurToCents(c.netVerkaufEur),
    label: axisLabel(c.businessDay, period),
    fullLabel: fullDayLabel(c.businessDay),
    key: c.businessDay,
  }))
}

/**
 * One column = a finalized day's NET TRADING RESULT in cents: net Verkauf minus
 * net Ankauf. This is an honest "trading margin" (money in from sales less money
 * out for buy-ins) and CAN go negative on a heavy buy-in day — the chart renders
 * that below the zero baseline. It is deliberately NOT labelled "Gewinn": true
 * net profit also subtracts operating expenses + allocated fixed costs, which
 * the closings do not carry and no per-day endpoint exposes. The screen names
 * this „Handelsergebnis" and keeps the real profit trend behind a „bald"-tile.
 */
export function tradingResultTrend(
  closings: readonly ClosingListItem[],
  period: AnalyticsPeriod,
): SeriesPoint[] {
  const rows = finalizedSeries(closings, PERIOD_DAYS[period])
  return rows.map((c) => ({
    value: eurToCents(c.netVerkaufEur) - eurToCents(c.netAnkaufEur),
    label: axisLabel(c.businessDay, period),
    fullLabel: fullDayLabel(c.businessDay),
    key: c.businessDay,
  }))
}

/** One column = a finalized day's net ANKAUF (buy-in payout), in cents. */
export function ankaufTrend(
  closings: readonly ClosingListItem[],
  period: AnalyticsPeriod,
): SeriesPoint[] {
  const rows = finalizedSeries(closings, PERIOD_DAYS[period])
  return rows.map((c) => ({
    value: eurToCents(c.netAnkaufEur),
    label: axisLabel(c.businessDay, period),
    fullLabel: fullDayLabel(c.businessDay),
    key: c.businessDay,
  }))
}

// ── Ankauf vs Verkauf — the window totals + the per-day split ────────────────
export interface FlowTotals {
  /** Sum of net Verkauf over the window, in cents. */
  verkaufCents: number
  /** Sum of net Ankauf over the window, in cents. */
  ankaufCents: number
  /** verkauf − ankauf, in cents (the window's net trading result). */
  netCents: number
  /** Count of VERKAUF transactions over the window. */
  verkaufCount: number
  /** Count of ANKAUF transactions over the window. */
  ankaufCount: number
  /** Number of finalized days the totals span (0 → the window is empty). */
  dayCount: number
}

/** Sum net Verkauf / Ankauf (cents) + the transaction counts over the window. */
export function flowTotals(
  closings: readonly ClosingListItem[],
  period: AnalyticsPeriod,
): FlowTotals {
  const rows = finalizedSeries(closings, PERIOD_DAYS[period])
  let verkaufCents = 0
  let ankaufCents = 0
  let verkaufCount = 0
  let ankaufCount = 0
  for (const c of rows) {
    verkaufCents += eurToCents(c.netVerkaufEur)
    ankaufCents += eurToCents(c.netAnkaufEur)
    verkaufCount += c.verkaufCount ?? 0
    ankaufCount += c.ankaufCount ?? 0
  }
  return {
    verkaufCents,
    ankaufCents,
    netCents: verkaufCents - ankaufCents,
    verkaufCount,
    ankaufCount,
    dayCount: rows.length,
  }
}

/**
 * The share of the window's gross flow that is VERKAUF, in 0..1. Used to draw
 * the single Ankauf↔Verkauf balance bar honestly: when both are zero (empty
 * window) the ratio is 0 and the caller shows the empty state rather than a
 * misleading half-full bar.
 */
export function verkaufShare(totals: FlowTotals): number {
  const gross = Math.abs(totals.verkaufCents) + Math.abs(totals.ankaufCents)
  if (gross <= 0) return 0
  return Math.max(0, Math.min(1, Math.abs(totals.verkaufCents) / gross))
}

// ── Category tree → an inventory-by-category ranking ─────────────────────────
/**
 * Flatten the 2-level category tree to its LEAF nodes carrying products, then
 * roll each leaf's count up under its display path. We rank by `productCount`
 * (items currently filed under the node) — an honest snapshot of where the
 * inventory sits, NOT a sales ranking. A leaf with 0 products is dropped (it
 * would only add a zero-width bar). Roots that are pure containers (no own
 * products, only children) contribute through their children, not themselves.
 */
export function categoryRanking(tree: CategoryTreeResponse | null): RankItem[] {
  if (!tree) return []
  const items: RankItem[] = []
  const pushNode = (node: CategoryNode, parentName: string | null): void => {
    const count = node.productCount ?? 0
    if (count > 0) {
      items.push({
        label: node.nameDe,
        value: count,
        sublabel: parentName ?? undefined,
        key: node.id,
      })
    }
    for (const child of node.children ?? []) pushNode(child, node.nameDe)
  }
  for (const root of tree.roots ?? []) pushNode(root, null)
  // Highest count first; the chart slices to its own limit.
  return items.sort((a, b) => b.value - a.value)
}

/** Total products counted across the ranking (honest "N Artikel verteilt"). */
export function categoryTotal(items: readonly RankItem[]): number {
  return items.reduce((sum, it) => sum + (Number.isFinite(it.value) ? it.value : 0), 0)
}

// ── Inventory value snapshot — the unrealised margin in the vault ────────────
export interface InventoryMargin {
  listValueCents: number
  acquisitionCostCents: number
  /** listValue − acquisitionCost: the unrealised gross margin sitting in stock. */
  unrealisedMarginCents: number
  /** margin / listValue in 0..1 — the share of the shelf price that is margin. */
  marginRatio: number
  availableCount: number
}

/**
 * Derive the unrealised margin from the current inventory-value snapshot
 * (listValueCents = sum of list prices, acquisitionValueCents = sum of what we
 * paid). This is a POINT-IN-TIME figure — there is no inventory-value HISTORY
 * endpoint, so the screen shows this as a snapshot and keeps the "value over
 * time" trend behind an honest „bald"-tile.
 */
export function inventoryMargin(
  listValueCents: number,
  acquisitionCostCents: number,
  availableCount: number,
): InventoryMargin {
  const list = Number.isFinite(listValueCents) ? listValueCents : 0
  const cost = Number.isFinite(acquisitionCostCents) ? acquisitionCostCents : 0
  const margin = list - cost
  const ratio = list > 0 ? Math.max(0, Math.min(1, margin / list)) : 0
  return {
    listValueCents: list,
    acquisitionCostCents: cost,
    unrealisedMarginCents: margin,
    marginRatio: ratio,
    availableCount: Number.isFinite(availableCount) ? availableCount : 0,
  }
}
