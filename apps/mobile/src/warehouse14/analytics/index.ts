/**
 * Analytics feature module — the pure brain behind the Owner-OS „Auswertungen"
 * surface (src/app/analytics.tsx).
 *
 *   derive.ts       — pure, honest reshaping of the REAL read aggregates
 *                     (daily closings, the category tree, the inventory snapshot)
 *                     into the chart kit's SeriesPoint / RankItem shapes. Money
 *                     is converted to integer cents once; no fabrication, no
 *                     gap-filling — a missing day stays a gap.
 *   analytics-ui.ts — the German copy, the period switcher options, and the
 *                     honest „bald"-tile texts that name each genuinely-missing
 *                     aggregate and the backend gap behind it.
 *
 * The screen consumes only these two files + the shared spine; nothing here
 * touches the network (that is ../api) so every function is unit-testable.
 */
export {
  eurToCents,
  type AnalyticsPeriod,
  PERIOD_DAYS,
  finalizedSeries,
  revenueTrend,
  tradingResultTrend,
  ankaufTrend,
  type FlowTotals,
  flowTotals,
  verkaufShare,
  categoryRanking,
  categoryTotal,
  type InventoryMargin,
  inventoryMargin,
} from "./derive"
export {
  ANALYTICS_PERIODS,
  periodSpanLabel,
  type BaldTileCopy,
  BALD_PROFIT_TREND,
  BALD_INVENTORY_HISTORY,
  BALD_TOP_PRODUCTS,
  COPY,
  articleCountLabel,
  dayCountLabel,
} from "./analytics-ui"
