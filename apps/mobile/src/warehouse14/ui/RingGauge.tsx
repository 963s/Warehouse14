/**
 * RingGauge — a progress gauge for the Owner OS.
 *
 * react-native-svg is NOT a dependency of apps/mobile (and the spec forbids
 * adding a native dep), so this renders the on-theme BAR fallback the
 * Schatzkammer already uses: a rounded track with a filled portion, plus an
 * optional value/label above and caption below. Same public API a future SVG
 * ring would expose (`value` 0..1, `color`, `label`, `caption`), so swapping in
 * a real ring later is a drop-in.
 *
 * Motion (DESIGN.md §6): the fill animates to its target with the one emphasis
 * spring — a KPI never snaps, it lands. The value is rendered in JetBrains Mono
 * so numbers in a column align (§3). At 100% a gold milestone shimmer flits
 * across the fill once — the one decorative use of gold, never under text.
 * Reduced motion drops the spring (fill jumps) and the shimmer.
 */
import { type ReactNode, useEffect } from "react"
import { View } from "react-native"
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { duration, easing, emphasisSpring } from "./motion/tokens"
import { useReduceMotion } from "./motion/useReduceMotion"

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

export interface RingGaugeProps {
  /** Progress ratio, 0..1 (clamped). */
  value: number
  /** Fill colour — defaults to brass (primary). Pass theme.colors.verdigris for positive. */
  color?: string
  /** Big value above the bar, e.g. a formatted amount or count. */
  label?: string
  /** Small caption under the bar, e.g. "Ziel 500 €". */
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
  const reduceMotion = useReduceMotion()
  const fill = color ?? t.colors.primary
  const ratio = clamp01(value)
  const pct = Math.round(ratio * 100)
  const atGoal = ratio >= 1

  // Animated fill width (0..1) and the gold milestone shimmer position.
  const progress = useSharedValue(reduceMotion ? ratio : 0)
  const shimmer = useSharedValue(0)

  useEffect(() => {
    if (reduceMotion) {
      progress.value = ratio
      return
    }
    // The KPI lands with the emphasis spring — settled, never wobbly.
    progress.value = withSpring(ratio, emphasisSpring)
    return () => {
      cancelAnimation(progress)
    }
  }, [ratio, reduceMotion, progress])

  useEffect(() => {
    if (reduceMotion || !atGoal) {
      shimmer.value = 0
      return
    }
    // One celebratory flit of gold across the full bar, after it lands.
    shimmer.value = 0
    shimmer.value = withDelay(
      duration.base,
      withTiming(1, { duration: duration.slow, easing: easing.standard }),
    )
    return () => {
      cancelAnimation(shimmer)
    }
  }, [atGoal, reduceMotion, shimmer])

  const fillStyle = useAnimatedStyle(() => {
    "worklet"
    return { width: `${progress.value * 100}%` }
  })

  const shimmerStyle = useAnimatedStyle(() => {
    "worklet"
    // A soft gold highlight that sweeps left→right once, then fades out.
    return {
      left: `${shimmer.value * 100 - 30}%`,
      opacity: shimmer.value > 0 && shimmer.value < 1 ? 0.5 : 0,
    }
  })

  return (
    <View className="w-full gap-1.5">
      {label != null ? (
        <Text
          className="font-mono text-2xl font-bold"
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
        <Animated.View style={[{ height: "100%", backgroundColor: fill }, fillStyle]} />
        {atGoal && !reduceMotion ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 0,
                bottom: 0,
                width: "30%",
                backgroundColor: t.colors.gold,
              },
              shimmerStyle,
            ]}
          />
        ) : null}
      </View>
      {caption != null ? (
        <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
          {caption}
        </Text>
      ) : null}
    </View>
  )
}
