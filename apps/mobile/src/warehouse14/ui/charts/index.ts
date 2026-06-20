/**
 * Warehouse14 Owner OS — the reports / insights chart kit.
 *
 * Tiny, presentation-only chart primitives the owner's report surfaces are
 * assembled from. Built ONLY on react-native Views + the shared spine (the
 * theme, the motion tokens, `GrowBar`, the haptic vocabulary, EmptyState /
 * Skeleton) — NO react-native-svg, NO victory, NO new native dep, by design.
 * Consistency is the product: every chart scales, animates, and degrades the
 * same way, and every one obeys the honesty rule.
 *
 * Honesty rule (carried from DESIGN.md §4, absolute): a chart NEVER fabricates a
 * value. When the aggregate behind it is unavailable (`locked`), still loading
 * (`loading`), or genuinely empty / all-zero, the component renders an explicit
 * skeleton / empty / locked state — never a flat zero axis that reads like a
 * real "nothing happened". Values are always rendered through the caller's
 * de-DE `formatValue` (e.g. `formatCents`), so every number on screen is real.
 *
 *   PeriodSwitcher — the segmented Tag/Woche/Monat/Jahr control (sliding brass
 *                    thumb, selection haptic) that scopes a report's window.
 *   TrendBars      — a vertical bar chart for a short time series, with a
 *                    zero-baseline split for losses and a highlighted "now".
 *   Sparkline      — a compact, label-free trend silhouette that colours itself
 *                    honestly by direction (up=verdigris / down=red) + a delta.
 *   TopNList       — a ranked "top movers" list with proportional bars.
 *   GrowBar        — the one animated bar segment the charts share (exported so
 *                    a bespoke report visual can reuse the same grow-in).
 *   types          — the shared datum shapes (SeriesPoint / RankItem /
 *                    PeriodOption) + the pure scaling helpers.
 */
export {
  PeriodSwitcher,
  DEFAULT_PERIODS,
  type PeriodSwitcherProps,
  type DefaultPeriodId,
} from "./PeriodSwitcher"
export { TrendBars, type TrendBarsProps } from "./TrendBars"
export { Sparkline, type SparklineProps, type SparklineTrend } from "./Sparkline"
export { TopNList, type TopNListProps } from "./TopNList"
export { GrowBar, type GrowBarProps } from "./GrowBar"
export {
  type SeriesPoint,
  type RankItem,
  type PeriodOption,
  clamp01,
  ratios,
  isFlat,
} from "./types"
