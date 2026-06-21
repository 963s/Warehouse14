/**
 * GoldFlood — the celebratory "gold flood" played once at a milestone, most of
 * all at break-even (the moment the day crosses into profit).
 *
 * A full-screen, non-interactive overlay: a gold bloom rises from the bottom,
 * a shimmer band sweeps up through it, then the whole thing fades away. Pure
 * decoration — the gold is read from the theme (`t.colors.gold`), used here
 * exactly as the tokens allow: NEVER under text, never carrying meaning a user
 * must read (DESIGN.md §4). It sits above content with `pointerEvents="none"`
 * so it never blocks a tap.
 *
 * Haptics are intentionally NOT fired here: this is the spine's visual layer
 * and `expo-haptics` is not a dependency of this module. The gamification /
 * haptics module fires its single `impactAsync(Heavy)` when GoldFlood signals
 * `onReachPeak` — pair the touch with the gold flourish at the same instant.
 *
 * Reduced motion: collapses to a brief, gentle full-screen gold tint that
 * fades — no rising bloom, no shimmer sweep, no translate.
 */
import { useEffect, type ReactNode } from "react"
import { StyleSheet, useWindowDimensions, View } from "react-native"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated"

import { useW14Theme } from "@/warehouse14/theme"
import { duration, easing } from "./tokens"
import { useReduceMotion } from "./useReduceMotion"

export interface GoldFloodProps {
  /** Flip to true to play the flood once. Re-arm by toggling false → true. */
  visible: boolean
  /**
   * Fired at the bloom's peak — the moment to play `impactAsync(Heavy)` from the
   * haptics module and reveal any milestone label.
   */
  onReachPeak?: () => void
  /** Fired after the flood has fully faded out (safe to unmount / reset). */
  onDone?: () => void
}

// Translucency of the gold layers — gold is decorative, so it bathes the
// screen rather than fully covering it. Kept as alpha suffixes on the token.
const BLOOM_ALPHA = "73" // ~45% — the rising body of the flood
const SHIMMER_ALPHA = "59" // ~35% — the brighter sweeping band

export function GoldFlood({ visible, onReachPeak, onDone }: GoldFloodProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const { height } = useWindowDimensions()

  // 0 = hidden, 1 = bloom fully risen. Drives bloom rise + overall opacity.
  const progress = useSharedValue(0)
  // Shimmer sweep position, 0 (below) → 1 (swept past top).
  const shimmer = useSharedValue(0)

  useEffect(() => {
    if (!visible) return

    if (reduceMotion) {
      // Gentle tint: fade in over `fast`, hold briefly, fade out — no motion.
      progress.value = withSequence(
        withTiming(1, { duration: duration.fast, easing: easing.standard }, (done) => {
          "worklet"
          if (done && onReachPeak) runOnJS(onReachPeak)()
        }),
        withDelay(
          duration.base,
          withTiming(0, { duration: duration.slow, easing: easing.exit }, (done) => {
            "worklet"
            if (done && onDone) runOnJS(onDone)()
          }),
        ),
      )
      return
    }

    // Bloom rises over `slow`, reaches peak (→ haptic), holds, then fades over
    // `slow` with the exit easing.
    progress.value = withSequence(
      withTiming(1, { duration: duration.slow, easing: easing.standard }, (done) => {
        "worklet"
        if (done && onReachPeak) runOnJS(onReachPeak)()
      }),
      withDelay(
        duration.base,
        withTiming(0, { duration: duration.slow, easing: easing.exit }, (done) => {
          "worklet"
          if (done && onDone) runOnJS(onDone)()
        }),
      ),
    )

    // Shimmer sweeps up once, slightly behind the bloom.
    shimmer.value = 0
    shimmer.value = withDelay(
      duration.fast,
      withTiming(1, { duration: duration.slow + duration.base, easing: easing.standard }),
    )
    // Trigger only on `visible` flips; theme/dimensions are read fresh each play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion])

  const overlayStyle = useAnimatedStyle(() => {
    "worklet"
    return { opacity: progress.value }
  })

  const bloomStyle = useAnimatedStyle(() => {
    "worklet"
    // Rises from fully below the screen to resting near the bottom third.
    const translateY = height * (1 - progress.value)
    return { transform: [{ translateY }] }
  })

  const shimmerStyle = useAnimatedStyle(() => {
    "worklet"
    // Sweeps from below the screen up past the top; fades at both ends.
    const translateY = height - shimmer.value * (height * 1.4)
    const opacity = shimmer.value <= 0 || shimmer.value >= 1 ? 0 : 1
    return { opacity, transform: [{ translateY }] }
  })

  if (!visible) return null

  if (reduceMotion) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, overlayStyle, { backgroundColor: `${t.colors.gold}40` }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    )
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, overlayStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Rising gold bloom — taller than the screen so the top edge stays soft. */}
      <Animated.View
        style={[
          styles.bloom,
          bloomStyle,
          { height: height * 1.4, backgroundColor: `${t.colors.gold}${BLOOM_ALPHA}` },
        ]}
      >
        <View
          style={[styles.bloomCore, { backgroundColor: `${t.colors.gold}${SHIMMER_ALPHA}` }]}
        />
      </Animated.View>

      {/* Shimmer band sweeping up through the bloom. */}
      <Animated.View
        style={[
          styles.shimmer,
          shimmerStyle,
          { backgroundColor: `${t.colors.gold}${SHIMMER_ALPHA}` },
        ]}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bloom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
  },
  // A brighter core concentrated at the base of the bloom.
  bloomCore: {
    height: "40%",
    width: "100%",
  },
  shimmer: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 120,
  },
})
