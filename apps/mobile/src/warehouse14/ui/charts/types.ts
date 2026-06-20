/**
 * Shared vocabulary for the Owner OS reports/insights kit (`charts/`).
 *
 * These are tiny, presentation-only chart primitives — trend bars, a sparkline,
 * a top-N list, a period switcher — built ONLY on react-native Views + the
 * shared spine (no react-native-svg, no victory; the spec forbids a new native
 * dep). The same honesty rule that governs the rest of the app governs here: a
 * chart NEVER fabricates a value. When the aggregate behind it is unavailable
 * (no endpoint, an error, or genuinely no rows), the component renders an
 * explicit empty / locked state instead of an empty axis that reads like zero.
 *
 * This file is the contract every chart shares: the datum shapes and the small,
 * pure helpers (normalisation, nice maxima) so each component does not re-derive
 * the maths. Colours/spacing/motion all come from the theme + motion tokens at
 * the call site — nothing visual lives here.
 */

/**
 * One point in a time-ordered series (trend bars, sparkline).
 *
 * `value` is a plain number in the caller's own unit — cents for money, a count
 * for counts, grams for weight. The kit never assumes a unit; the caller passes
 * a `formatValue` to render labels in de-DE (e.g. `formatCents`). `value` may be
 * negative (a loss day, a net-outflow) and the kit renders that honestly.
 */
export interface SeriesPoint {
  /** Magnitude in the caller's unit (cents / count / grams). May be negative. */
  value: number
  /** Short axis label under the bar, e.g. "Mo", "01.", "Jan". Caller-formatted, de-DE. */
  label?: string
  /** Full label for accessibility / a tooltip, e.g. "Montag, 16.06." */
  fullLabel?: string
  /** Stable key for React lists; falls back to the index when absent. */
  key?: string
}

/**
 * One ranked entry in a Top-N list (best products, top customers, …).
 *
 * `value` drives the proportional bar and is shown right-aligned via the
 * caller's `formatValue`. A negative value clamps its bar to zero width but
 * still prints the real (negative) number — honesty over a tidy axis.
 */
export interface RankItem {
  /** Row title, e.g. a product name or a customer. */
  label: string
  /** Magnitude in the caller's unit; drives the bar length + the printed value. */
  value: number
  /** Optional secondary line under the label (e.g. "12 verkauft"). */
  sublabel?: string
  /** Stable key for the list; falls back to the index. */
  key?: string
}

/**
 * A selectable reporting period for the `PeriodSwitcher`. `id` is the stable
 * value the caller switches on; `label` is the short German segment caption.
 */
export interface PeriodOption<Id extends string = string> {
  id: Id
  /** Short segment caption, e.g. "Tag", "Woche", "Monat", "Jahr". */
  label: string
  /** Optional longer accessibility label, e.g. "Diese Woche". */
  a11yLabel?: string
}

/** Clamp a ratio into 0..1, treating non-finite input as 0 (honest default). */
export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

/**
 * Per-point fill ratios (0..1) for a series, scaled against a SHARED maximum so
 * bars are comparable across the chart. The reference is `max(|value|)` over the
 * series (so a series with negatives still scales sensibly), guarded against an
 * all-zero series (every ratio 0, never a divide-by-zero). Returns a parallel
 * array of magnitudes 0..1 — sign is handled by the renderer, not flattened
 * here, so a chart can split a baseline for losses if it wants to.
 */
export function ratios(values: readonly number[]): number[] {
  let peak = 0
  for (const v of values) {
    if (Number.isFinite(v)) {
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
  }
  if (peak <= 0) return values.map(() => 0)
  return values.map((v) => (Number.isFinite(v) ? clamp01(Math.abs(v) / peak) : 0))
}

/**
 * True when a series carries no real signal to chart — empty, or every value is
 * zero / non-finite. The caller uses this to choose the honest empty state over
 * a flat, zero-height axis that would read as a real "nothing sold" result only
 * by accident.
 */
export function isFlat(values: readonly number[]): boolean {
  return !values.some((v) => Number.isFinite(v) && v !== 0)
}
