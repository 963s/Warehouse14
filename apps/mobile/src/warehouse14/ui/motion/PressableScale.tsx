/**
 * PressableScale — the one press-feedback primitive for the Owner OS.
 *
 * On press-in the surface scales to 0.97 and dips opacity to 0.9 over
 * `instant`; on release it settles back over `fast` (DESIGN.md §6). The
 * gesture runs on the UI thread via a Reanimated shared value. Wrap any
 * tappable surface (card, list row, button) with this instead of hand-rolling
 * a `Pressable` opacity style, so every press feels identical.
 *
 * Implementation: a plain `Pressable` is the gesture/accessibility surface; an
 * inner `Animated.View` carries the transform. This avoids wrapping Pressable
 * itself in `createAnimatedComponent` (whose typings mis-resolve under RN's
 * overloads) while keeping all the Pressable props you expect.
 *
 * Reduced motion: skips scale/opacity entirely and renders a plain Pressable.
 */
import { type ReactNode } from "react"
import { Pressable, type PressableProps, type ViewStyle, type StyleProp } from "react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

import { duration, easing, press } from "./tokens"
import { useReduceMotion } from "./useReduceMotion"

export interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  children: ReactNode
  /** Style merged onto the animated layer. */
  style?: StyleProp<ViewStyle>
  /**
   * Override the pressed scale target. Defaults to the shared `press.scale`
   * (0.97); pass 1 to disable scale and keep only the opacity dip.
   */
  pressedScale?: number
}

export function PressableScale({
  children,
  style,
  pressedScale = press.scale,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps): ReactNode {
  const reduceMotion = useReduceMotion()
  const progress = useSharedValue(0)

  const animatedStyle = useAnimatedStyle(() => {
    "worklet"
    const scale = 1 + (pressedScale - 1) * progress.value
    const opacity = 1 + (press.opacity - 1) * progress.value
    return { transform: [{ scale }], opacity }
  })

  // Reduced motion (or disabled): a plain Pressable, no scale/opacity worklet.
  if (reduceMotion || disabled) {
    return (
      <Pressable
        style={style}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        {...rest}
      >
        {children}
      </Pressable>
    )
  }

  return (
    <Pressable
      onPressIn={(e) => {
        progress.value = withTiming(1, { duration: duration.instant, easing: easing.standard })
        onPressIn?.(e)
      }}
      onPressOut={(e) => {
        progress.value = withTiming(0, { duration: duration.fast, easing: easing.standard })
        onPressOut?.(e)
      }}
      {...rest}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  )
}
