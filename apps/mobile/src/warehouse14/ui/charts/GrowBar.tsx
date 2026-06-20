/**
 * GrowBar — the one animated bar segment every chart in the kit is built from.
 *
 * A single rounded fill that grows from nothing to its `ratio` (0..1) of the
 * track along one axis. Vertical (`direction="up"`) for TrendBars, horizontal
 * (`direction="right"`) for the TopN bars and the Sparkline columns. Centralised
 * here so the grow-in feels identical wherever a bar appears, and so the
 * reduced-motion degrade is decided in one place.
 *
 * Motion (DESIGN.md §6): the fill eases to its target over `base` with the
 * standard easing, delayed by the caller's stagger so a row/column cascade in.
 * Reduced motion renders the bar at its final size immediately (no grow, no
 * delay). The bar is purely decorative — it carries no text — so a value/label
 * is always rendered by the parent alongside it (honesty: the number is real,
 * the bar only depicts it).
 */
import { type ReactNode, useEffect } from "react"
import { type DimensionValue } from "react-native"
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated"

import { duration, easing } from "@/warehouse14/ui/motion/tokens"
import { useReduceMotion } from "@/warehouse14/ui/motion/useReduceMotion"
import { clamp01 } from "./types"

export interface GrowBarProps {
  /** Fill fraction along the grow axis, 0..1 (clamped). */
  ratio: number
  /** Fill colour (already resolved from the theme by the caller). */
  color: string
  /** Which way the bar grows. "up" = vertical column, "right" = horizontal bar. */
  direction?: "up" | "right"
  /**
   * Bar thickness (the cross-axis size) — width for "up", height for "right".
   * A number is px; "100%" fills the parent cross-axis (e.g. a silhouette column).
   */
  thickness?: DimensionValue
  /** Track length along the grow axis. Number = px; "100%" fills the parent. */
  length?: DimensionValue
  /** Corner radius in px (defaults to a pill at the grow end). */
  radius?: number
  /** Stagger delay before this bar grows, in ms. */
  delay?: number
  /** Dim the fill (e.g. an inactive column behind a highlighted one). */
  dim?: boolean
}

export function GrowBar({
  ratio,
  color,
  direction = "up",
  thickness = 8,
  length = "100%",
  radius,
  delay = 0,
  dim = false,
}: GrowBarProps): ReactNode {
  const reduceMotion = useReduceMotion()
  const target = clamp01(ratio)
  const progress = useSharedValue(reduceMotion ? target : 0)

  useEffect(() => {
    if (reduceMotion) {
      progress.value = target
      return
    }
    progress.value = withDelay(
      delay,
      withTiming(target, { duration: duration.base, easing: easing.standard }),
    )
    return () => {
      cancelAnimation(progress)
    }
  }, [target, delay, reduceMotion, progress])

  const isVertical = direction === "up"

  const fillStyle = useAnimatedStyle(() => {
    "worklet"
    const pct = `${progress.value * 100}%` as const
    // Keep a single, consistently-shaped return so the animated-style typing
    // resolves (a union of {height}|{width} does not satisfy DefaultStyle).
    return isVertical ? { height: pct } : { width: pct }
  })

  // The grow end is rounded into a pill; default to half the thickness when it's
  // a known px number, else a small fixed radius (a percent thickness has no px).
  const r = radius ?? (typeof thickness === "number" ? thickness / 2 : 1)

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        isVertical
          ? { width: thickness, height: length as DimensionValue, justifyContent: "flex-end" }
          : { height: thickness, width: length as DimensionValue, justifyContent: "flex-start" },
      ]}
    >
      <Animated.View
        style={[
          {
            backgroundColor: color,
            opacity: dim ? 0.4 : 1,
            borderRadius: r,
          },
          isVertical ? { width: "100%" } : { height: "100%" },
          fillStyle,
        ]}
      />
    </Animated.View>
  )
}
