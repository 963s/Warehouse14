/**
 * Skeleton — the loading placeholder for the Owner OS.
 *
 * DESIGN.md §6 says loading shows a skeleton in the card's SHAPE, never a
 * spinner mid-screen, and cross-fades into data over `fast`. This is that
 * placeholder: a theme-`border`-tinted block that breathes (a calm opacity
 * pulse on the UI thread) so it reads as "loading", not as a real value — the
 * honesty rule in physical form. Under "reduce motion" it holds a single static
 * dim, no pulse.
 *
 * Compose skeletons into the shape of whatever is loading: a `SkeletonText`
 * line for a row title, a `SkeletonText` block for a paragraph, or a bare
 * `Skeleton` sized to a value/gauge. `SkeletonRow` and `SkeletonCard` assemble
 * the two shapes the spine uses most, so a loading surface matches the loaded
 * one to the pixel.
 */
import { type ReactNode, useEffect } from "react"
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native"
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated"

import { Card } from "@/components/ui/card"
import { useW14Theme } from "@/warehouse14/theme"
import { duration, easing } from "./motion/tokens"
import { useReduceMotion } from "./motion/useReduceMotion"

export interface SkeletonProps {
  /** Width — a number (px) or a percentage string. Default fills the parent. */
  width?: DimensionValue
  /** Height in px. Default 14 (one body line). */
  height?: number
  /** Corner radius — defaults to the `button` (8) radius; pass "full" for a pill/disc. */
  radius?: "button" | "card" | "full"
  /** Extra style merged onto the block. */
  style?: StyleProp<ViewStyle>
}

export function Skeleton({
  width = "100%",
  height = 14,
  radius = "button",
  style,
}: SkeletonProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const progress = useSharedValue(0)

  useEffect(() => {
    if (reduceMotion) return
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: duration.slow * 2, easing: easing.standard }),
        withTiming(0, { duration: duration.slow * 2, easing: easing.standard }),
      ),
      -1,
      false,
    )
    return () => {
      cancelAnimation(progress)
    }
  }, [reduceMotion, progress])

  const pulse = useAnimatedStyle(() => {
    "worklet"
    // Breathe between a resting and a slightly brighter dim — never to full, so
    // a skeleton can never be mistaken for content.
    return { opacity: 0.5 + 0.35 * progress.value }
  })

  const borderRadius =
    radius === "full" ? 999 : radius === "card" ? t.radii.card : t.radii.button

  const block: ViewStyle = {
    width,
    height,
    borderRadius,
    backgroundColor: t.colors.border,
  }

  // Reduced motion: a static dim block, no breathing.
  if (reduceMotion) {
    return <View style={[block, { opacity: 0.7 }, style]} accessibilityElementsHidden />
  }
  return <Animated.View style={[block, pulse, style]} accessibilityElementsHidden />
}

export interface SkeletonTextProps {
  /** Number of lines (default 1). The last line is shorter for a natural ragged edge. */
  lines?: number
  /** Per-line height in px (default 13). */
  lineHeight?: number
  /** Width of the block when `lines` is 1, else the width of full lines. */
  width?: DimensionValue
}

/** A stack of text-line skeletons; the final line is foreshortened. */
export function SkeletonText({
  lines = 1,
  lineHeight = 13,
  width = "100%",
}: SkeletonTextProps): ReactNode {
  const count = Math.max(1, Math.floor(lines))
  return (
    <View style={{ gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          width={i === count - 1 && count > 1 ? "62%" : width}
        />
      ))}
    </View>
  )
}

/** A ListRow-shaped skeleton: a leading disc, two text lines, a value block. */
export function SkeletonRow(): ReactNode {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center gap-3 py-2" style={{ minHeight: t.touch.min }}>
      <Skeleton width={20} height={20} radius="full" />
      <View className="flex-1 gap-2">
        <Skeleton width="64%" height={13} />
        <Skeleton width="40%" height={11} />
      </View>
      <Skeleton width={56} height={14} />
    </View>
  )
}

export interface SkeletonCardProps {
  /** How many SkeletonRows to stack in the body (default 3). */
  rows?: number
}

/** A SectionCard-shaped skeleton: header line over a few SkeletonRows. */
export function SkeletonCard({ rows = 3 }: SkeletonCardProps): ReactNode {
  const count = Math.max(1, Math.floor(rows))
  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-center gap-2.5">
        <Skeleton width={18} height={18} radius="button" />
        <Skeleton width="46%" height={15} />
      </View>
      <View className="gap-2.5">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </View>
    </Card>
  )
}
