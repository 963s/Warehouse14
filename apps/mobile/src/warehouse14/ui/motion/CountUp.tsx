/**
 * CountUp — animate a number to a new value and render it through a formatter.
 *
 * Used for KPI counters and money: the value rolls from its previous figure to
 * the new one over `base` with the emphasis spring, never snapping (DESIGN.md
 * §6 — "let it land"). The displayed string always comes from the caller's
 * `format` (e.g. `formatCents`), so the value stays honest and de-DE — CountUp
 * animates the magnitude, not a fake number.
 *
 * Because the animated figure lives on the UI thread, each frame's rounded
 * value is bridged back to React state via `runOnJS` and re-formatted. The
 * bridge only fires when the rounded integer actually changes, so it does not
 * thrash on sub-unit frames. Reduced motion sets the final value immediately.
 */
import { useEffect, useState, type ReactNode } from "react"
import { type StyleProp, type TextStyle } from "react-native"
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { emphasisSpring, timingStandard } from "./tokens"
import { useReduceMotion } from "./useReduceMotion"

export interface CountUpProps {
  /** Target numeric value (e.g. cents, or a plain count). */
  value: number
  /** Format the rolling number into the shown string. Defaults to integer. */
  format?: (n: number) => string
  /**
   * Spring the count (emphasis) or ease it (timing). Springs suit a celebratory
   * KPI; timing suits a calm value refresh. Default "spring".
   */
  motion?: "spring" | "timing"
  /** className passed to the underlying themed Text. */
  className?: string
  style?: StyleProp<TextStyle>
  /** numberOfLines on the Text (default 1 — KPIs never wrap). */
  numberOfLines?: number
  /** Accessibility label override; defaults to the final formatted value. */
  accessibilityLabel?: string
}

const identity = (n: number): string => String(Math.round(n))

export function CountUp({
  value,
  format = identity,
  motion = "spring",
  className,
  style,
  numberOfLines = 1,
  accessibilityLabel,
}: CountUpProps): ReactNode {
  const reduceMotion = useReduceMotion()
  const animated = useSharedValue(value)
  // The current rounded magnitude in JS state; formatting happens at render so
  // the worklet only ever ships a number across the bridge (no JS closure runs
  // on the UI thread).
  const [shown, setShown] = useState<number>(() => Math.round(value))

  useEffect(() => {
    if (reduceMotion) {
      animated.value = value
      setShown(Math.round(value))
      return
    }
    animated.value =
      motion === "timing"
        ? withTiming(value, timingStandard("base"))
        : withSpring(value, emphasisSpring)
    // `value` is the dependency; `format`/`motion` are stable in practice and
    // intentionally excluded so a new inline formatter does not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduceMotion])

  // Bridge the UI-thread figure to JS only when the rounded integer changes.
  useAnimatedReaction(
    () => Math.round(animated.value),
    (current, previous) => {
      "worklet"
      if (current !== previous) {
        runOnJS(setShown)(current)
      }
    },
  )

  return (
    <Text
      className={className}
      style={style}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel ?? format(value)}
    >
      {format(shown)}
    </Text>
  )
}
