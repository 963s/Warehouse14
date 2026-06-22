/**
 * GoldFlood — a CALM milestone veil (replaces the old rising-bloom + shimmer
 * sweep, which read as a gaudy "wave" and broke the official store motion
 * language).
 *
 * The store motion language (binding): entrances happen ONCE, animate ONLY
 * transform + opacity, use ONE calm change, and respect prefers-reduced-motion
 * (jump to the end). NO glow, NO bloom, NO gaudy ripple.
 *
 * So the milestone now reads as a brief, gentle full-screen veil that fades in
 * and out — a quiet "stamp" of the moment, never a rising wave. The gilt tone
 * is used as a translucent wash only (decorative; never under text). It sits
 * above content with `pointerEvents="none"` so it never blocks a tap.
 *
 * The public props (visible / onReachPeak / onDone) are UNCHANGED so the 12+
 * call sites keep working without churn.
 *
 * Haptics are intentionally NOT fired here (visual layer only); the
 * gamification module fires its single impact at onReachPeak.
 */
import { useEffect, type ReactNode } from "react"
import { StyleSheet } from "react-native"
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
  /** Flip to true to play the veil once. Re-arm by toggling false → true. */
  visible: boolean
  /**
   * Fired at the veil's peak opacity — the moment to play the haptic and
   * reveal any milestone label.
   */
  onReachPeak?: () => void
  /** Fired after the veil has fully faded out (safe to unmount / reset). */
  onDone?: () => void
}

// A quiet translucent gilt wash — decorative, never under text. Low alpha so
// content stays readable through it.
const VEIL_ALPHA = "14" // ~8% — a gentle stamp, not a flood

export function GoldFlood({ visible, onReachPeak, onDone }: GoldFloodProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()

  // 0 = hidden, 1 = veil fully faded in. Drives opacity only (no transform).
  const progress = useSharedValue(0)

  useEffect(() => {
    if (!visible) return

    // One calm sequence: fade in (curator ease-out), hold, fade out. Reduced
    // motion collapses to a near-instant tint that fades — no curve work.
    const inDur = reduceMotion ? 1 : duration.base
    const outDur = reduceMotion ? 1 : duration.slow

    progress.value = withSequence(
      withTiming(1, { duration: inDur, easing: easing.standard }, (done) => {
        "worklet"
        if (done && onReachPeak) runOnJS(onReachPeak)()
      }),
      withDelay(
        duration.base,
        withTiming(0, { duration: outDur, easing: easing.exit }, (done) => {
          "worklet"
          if (done && onDone) runOnJS(onDone)()
        }),
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion])

  const veilStyle = useAnimatedStyle(() => {
    "worklet"
    return { opacity: progress.value }
  })

  if (!visible) return null

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, veilStyle, { backgroundColor: `${t.colors.gilt}${VEIL_ALPHA}` }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  )
}

// Styles kept (empty) for back-compat with any external import; the calm veil
// needs no positioned children.
const styles = StyleSheet.create({})
