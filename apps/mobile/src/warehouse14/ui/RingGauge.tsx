/**
 * RingGauge — a progress gauge for the Owner OS.
 *
 * react-native-svg is NOT a dependency of apps/mobile (and the spec forbids
 * adding a native dep), so this renders the on-theme BAR fallback the
 * Schatzkammer already uses: a rounded track with a filled portion, plus an
 * optional centred value/label. Same public API a future SVG ring would expose
 * (`value` 0..1, `color`, `label`, `caption`), so swapping in a real ring later
 * is a drop-in.
 */
import { type ReactNode } from "react"
import { View } from "react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

export interface RingGaugeProps {
  /** Progress ratio, 0..1 (clamped). */
  value: number
  /** Fill colour — defaults to brass (primary). Pass theme.colors.verdigris for positive. */
  color?: string
  /** Big centred value, e.g. a formatted amount or count. */
  label?: string
  /** Small caption under the value, e.g. "Ziel 500 €". */
  caption?: string
  /** Bar thickness in px (default 8). */
  thickness?: number
  /** Render the value muted (e.g. when the source is not available). */
  muted?: boolean
}

export function RingGauge({
  value,
  color,
  label,
  caption,
  thickness = 8,
  muted = false,
}: RingGaugeProps): ReactNode {
  const t = useW14Theme()
  const fill = color ?? t.colors.primary
  const pct = Math.round(clamp01(value) * 100)

  return (
    <View className="w-full gap-1.5">
      {label != null ? (
        <Text
          className="text-2xl font-bold"
          style={muted ? { color: t.colors.mutedForeground } : undefined}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
      <View
        className="w-full overflow-hidden rounded-full"
        style={{ height: thickness, backgroundColor: t.colors.border }}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: pct, min: 0, max: 100 }}
      >
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: fill }} />
      </View>
      {caption != null ? (
        <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
          {caption}
        </Text>
      ) : null}
    </View>
  )
}
