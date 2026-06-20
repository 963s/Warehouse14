/**
 * Sparkline — a compact, label-free trend glyph for a series, sized to sit
 * inline next to a KPI ("how is this number trending?").
 *
 * react-native-svg is not a dependency (and a new native dep is forbidden), so
 * the line is drawn as a dense row of thin micro-columns — a filled-area
 * silhouette of the series. At sparkline scale this reads as a trend line while
 * staying pure react-native Views. The columns share the kit's scaling and grow
 * in together; reduced motion renders them at rest.
 *
 * Tone is derived HONESTLY from the trend, not decoration: when the series ends
 * above where it started it's verdigris (up), below it's `destructive` (down),
 * flat it's muted — unless the caller pins a `tone`. An optional `delta` caption
 * (already formatted de-DE by the caller, e.g. "+12,5 %") sits to the right in
 * the matching colour.
 *
 * Honesty: an empty / all-zero series renders a single muted baseline rule and
 * an optional "—" — never a fabricated wiggle. The caller passes `locked` when
 * the aggregate behind it doesn't exist, which renders the same calm baseline.
 */
import { type ReactNode, useMemo } from "react"
import { View } from "react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { GrowBar } from "./GrowBar"
import { type SeriesPoint, ratios, isFlat } from "./types"

export type SparklineTrend = "up" | "down" | "flat"

export interface SparklineProps {
  /** Time-ordered series, left→right. Values in the caller's own unit. */
  data: ReadonlyArray<SeriesPoint> | ReadonlyArray<number>
  /** Pixel height of the silhouette (default 32). Width fills the parent. */
  height?: number
  /**
   * Pin the colour intent instead of deriving it from the trend direction.
   * Omit to let the sparkline colour itself honestly (up=verdigris, down=red).
   */
  tone?: "primary" | "accent" | "destructive" | "muted"
  /** Optional pre-formatted delta caption (de-DE), e.g. "+12,5 %" or "−40 €". */
  delta?: string
  /** The aggregate behind this isn't available → calm baseline, no fake trend. */
  locked?: boolean
  /** Accessibility label for the whole glyph (German). */
  accessibilityLabel?: string
}

function toPoints(data: SparklineProps["data"]): SeriesPoint[] {
  return data.map((d, i) =>
    typeof d === "number" ? { value: d, key: String(i) } : d,
  )
}

/** The honest trend direction: compare the last real value to the first. */
function trendOf(values: readonly number[]): SparklineTrend {
  const real = values.filter((v) => Number.isFinite(v))
  if (real.length < 2) return "flat"
  const first = real[0]
  const last = real[real.length - 1]
  if (last > first) return "up"
  if (last < first) return "down"
  return "flat"
}

export function Sparkline({
  data,
  height = 32,
  tone,
  delta,
  locked = false,
  accessibilityLabel,
}: SparklineProps): ReactNode {
  const t = useW14Theme()

  const points = useMemo(() => toPoints(data), [data])
  const values = useMemo(() => points.map((p) => p.value), [points])
  const fillRatios = useMemo(() => ratios(values), [values])
  const flat = isFlat(values)
  const trend = useMemo(() => trendOf(values), [values])

  const color = useMemo(() => {
    if (tone === "primary") return t.colors.primary
    if (tone === "accent") return t.colors.verdigris
    if (tone === "destructive") return t.colors.destructive
    if (tone === "muted") return t.colors.mutedForeground
    // Derived honestly from the trend.
    if (trend === "up") return t.colors.verdigris
    if (trend === "down") return t.colors.destructive
    return t.colors.mutedForeground
  }, [tone, trend, t.colors])

  // Empty / locked / flat → a single calm baseline rule, never a fake wiggle.
  if (locked || points.length === 0 || flat) {
    return (
      <View
        className="flex-row items-center gap-2"
        accessibilityLabel={accessibilityLabel ?? "Kein Trend verfügbar"}
      >
        <View
          style={{ flex: 1, height: 1, backgroundColor: t.colors.border }}
        />
        {delta != null ? (
          <Text className="text-2xs" style={{ color: t.colors.mutedForeground }}>
            {delta}
          </Text>
        ) : (
          <Text className="text-2xs" style={{ color: t.colors.mutedForeground }}>
            —
          </Text>
        )}
      </View>
    )
  }

  return (
    <View
      className="flex-row items-center gap-2"
      accessibilityLabel={
        accessibilityLabel ??
        `Trend ${trend === "up" ? "steigend" : trend === "down" ? "fallend" : "gleichbleibend"}`
      }
    >
      <View
        className="flex-1 flex-row items-end"
        style={{ height, gap: 1 }}
      >
        {points.map((p, i) => (
          <View key={p.key ?? i} className="flex-1 justify-end" style={{ height }}>
            <GrowBar
              ratio={Math.max(0.04, fillRatios[i] ?? 0)}
              color={color}
              direction="up"
              thickness="100%"
              length={height}
              radius={1}
            />
          </View>
        ))}
      </View>
      {delta != null ? (
        <Text className="font-mono text-2xs" style={{ color }} numberOfLines={1}>
          {delta}
        </Text>
      ) : null}
    </View>
  )
}
