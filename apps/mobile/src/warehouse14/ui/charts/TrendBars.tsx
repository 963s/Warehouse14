/**
 * TrendBars — a vertical bar chart for a short, time-ordered series (a week of
 * daily turnover, twelve months of profit, …). The workhorse report visual.
 *
 * Built ONLY on react-native Views + the shared `GrowBar` (no react-native-svg,
 * no charting dep — the spec forbids adding one). Each datum is one column that
 * grows to its share of the series peak, with a short axis label beneath. The
 * latest (or a caller-selected) column is highlighted in brass; the rest sit in
 * a calm dim so the eye lands on "now". Columns cascade in with the kit's
 * stagger; reduced motion shows them at rest.
 *
 * Honesty (DESIGN.md §4, absolute): the chart NEVER fabricates a column.
 *   • `loading` → a Skeleton in the chart's shape (no axis that reads as zero).
 *   • `locked`  → an EmptyState explaining the aggregate isn't available, so a
 *                 missing endpoint never masquerades as a real flat week.
 *   • a genuinely empty / all-zero series → the same honest empty state.
 * Values are rendered through the caller's `formatValue` (e.g. `formatCents`),
 * so every number on screen is the real de-DE figure, never a raw unit.
 *
 * Negatives are honest too: a series with losses splits at a zero baseline —
 * positive columns grow up in brass/verdigris, negative columns grow DOWN in
 * `destructive`. A real loss is never coloured as if it were a gain.
 */
import { type ReactNode, useMemo } from "react"
import { View, Pressable } from "react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { selection } from "@/warehouse14/ui/native"
import { staggerDelay } from "@/warehouse14/ui/motion/transitions"
import { EmptyState } from "@/warehouse14/ui/EmptyState"
import { Skeleton } from "@/warehouse14/ui/Skeleton"
import { LineChart } from "lucide-react-native"
import { GrowBar } from "./GrowBar"
import { type SeriesPoint, ratios, isFlat } from "./types"

export interface TrendBarsProps {
  /** The time-ordered series, left→right (oldest→newest). */
  data: ReadonlyArray<SeriesPoint>
  /** Render a magnitude in the caller's unit as a de-DE string (e.g. formatCents). */
  formatValue: (value: number) => string
  /**
   * Colour intent for the positive bars. "primary" = brass (default),
   * "accent" = verdigris (a positive-only metric like turnover). Negative bars
   * are always `destructive`.
   */
  tone?: "primary" | "accent"
  /**
   * Index of the column to highlight (others dim). Defaults to the last column
   * ("now"). Pass `null` to highlight none (all columns full strength).
   */
  highlightIndex?: number | null
  /** Chart body height in px (bars + baseline area, excludes labels). Default 140. */
  height?: number
  /** Tapping a column calls back with its index + datum (fires a selection haptic). */
  onSelect?: (index: number, point: SeriesPoint) => void
  /** First-load state → Skeleton in the chart's shape. */
  loading?: boolean
  /**
   * The aggregate behind this chart does not exist / failed → honest locked
   * state instead of an empty axis. Overrides an empty `data`.
   */
  locked?: boolean
  /** Locked/empty copy overrides (German). */
  emptyTitle?: string
  emptyDescription?: string
}

export function TrendBars({
  data,
  formatValue,
  tone = "primary",
  highlightIndex,
  height = 140,
  onSelect,
  loading = false,
  locked = false,
  emptyTitle,
  emptyDescription,
}: TrendBarsProps): ReactNode {
  const t = useW14Theme()

  const values = useMemo(() => data.map((d) => d.value), [data])
  const fillRatios = useMemo(() => ratios(values), [values])
  const flat = isFlat(values)

  // The active column: explicit index, else the latest. `null` disables it.
  const active =
    highlightIndex === null
      ? -1
      : highlightIndex != null
        ? highlightIndex
        : data.length - 1

  if (loading) {
    return (
      <View style={{ height: height + 28 }} className="flex-row items-end gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={i} className="flex-1 items-center gap-2">
            <Skeleton
              width="70%"
              height={Math.round(height * (0.35 + ((i * 7) % 5) / 10))}
              radius="button"
            />
            <Skeleton width={18} height={10} radius="button" />
          </View>
        ))}
      </View>
    )
  }

  if (locked || data.length === 0 || flat) {
    return (
      <EmptyState
        icon={LineChart}
        title={emptyTitle ?? (locked ? "Noch keine Auswertung" : "Keine Daten im Zeitraum")}
        description={
          emptyDescription ??
          (locked
            ? "Für diesen Zeitraum liegt noch keine Auswertung vor."
            : "In diesem Zeitraum wurde nichts erfasst.")
        }
      />
    )
  }

  const posColor = tone === "accent" ? t.colors.verdigris : t.colors.primary
  const hasNegative = values.some((v) => Number.isFinite(v) && v < 0)
  // With negatives the baseline sits mid-body so columns can grow both ways;
  // with an all-positive series the baseline is the floor (full upward room).
  const upRoom = hasNegative ? height / 2 : height
  const downRoom = hasNegative ? height / 2 : 0

  return (
    <View>
      <View style={{ height }} className="flex-row items-stretch gap-2">
        {data.map((point, i) => {
          const v = point.value
          const r = fillRatios[i] ?? 0
          const isActive = i === active
          const negative = Number.isFinite(v) && v < 0
          const barColor = negative ? t.colors.destructive : posColor
          const delay = staggerDelay(i)
          const a11y = `${point.fullLabel ?? point.label ?? `Punkt ${i + 1}`}: ${formatValue(v)}`

          const column = (
            <View className="flex-1 items-center justify-center" style={{ height }}>
              {/* upper half (positive grows from baseline up) */}
              <View style={{ height: upRoom, width: "100%", justifyContent: "flex-end" }}>
                {!negative ? (
                  <View className="w-full items-center">
                    <GrowBar
                      ratio={r}
                      color={barColor}
                      direction="up"
                      thickness={Math.max(6, 18)}
                      length={upRoom}
                      delay={delay}
                      dim={active >= 0 && !isActive}
                    />
                  </View>
                ) : null}
              </View>
              {/* baseline hairline only when the series has both signs */}
              {hasNegative ? (
                <View
                  style={{ height: 1, width: "100%", backgroundColor: t.colors.border }}
                />
              ) : null}
              {/* lower half (negative grows from baseline down) */}
              {hasNegative ? (
                <View style={{ height: downRoom, width: "100%", justifyContent: "flex-start" }}>
                  {negative ? (
                    <View className="w-full items-center">
                      <GrowBar
                        ratio={r}
                        color={barColor}
                        direction="up"
                        thickness={18}
                        length={downRoom}
                        delay={delay}
                        dim={active >= 0 && !isActive}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          )

          return (
            <View key={point.key ?? i} className="flex-1 items-center">
              {onSelect ? (
                <Pressable
                  className="w-full"
                  accessibilityRole="button"
                  accessibilityLabel={a11y}
                  hitSlop={{ top: 8, bottom: 8 }}
                  onPress={() => {
                    selection()
                    onSelect(i, point)
                  }}
                >
                  {column}
                </Pressable>
              ) : (
                <View className="w-full" accessibilityLabel={a11y}>
                  {column}
                </View>
              )}
            </View>
          )
        })}
      </View>

      {/* axis labels */}
      <View className="mt-2 flex-row gap-2">
        {data.map((point, i) => {
          const isActive = i === active
          return (
            <View key={point.key ?? i} className="flex-1 items-center">
              <Text
                className="text-2xs"
                style={{
                  color: isActive ? t.colors.foreground : t.colors.mutedForeground,
                  fontFamily: isActive ? t.fonts.semibold : t.fonts.body,
                }}
                numberOfLines={1}
              >
                {point.label ?? ""}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
