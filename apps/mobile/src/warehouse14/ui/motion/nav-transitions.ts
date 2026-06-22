/**
 * Route-level animation options for React Navigation's native Stack
 * (expo-router's `Stack`, which is a fork of `@react-navigation/native-stack`).
 *
 * The native-stack API exposes string `animation` presets + a numeric
 * `animationDuration`, animated on the native thread (react-native-screens) at
 * 60fps. We tune the durations to the house motion language
 * (DESIGN-SYSTEM.md §5): the curator ease (0.16,1,0.3,1) for entrances is the
 * platform default for these presets on iOS, so we only set the *duration* to
 * the official scale (fast 180 / base 420 / slow 650). The presets themselves
 * are platform-correct (iOS slide-up modal, horizontal push, calm fade).
 *
 * Usage:
 *   import { modalPresent, stackPush, calmFade } from "@/warehouse14/ui/motion/nav-transitions"
 *   <Stack.Screen options={{ presentation: "modal", ...modalPresent() }} />
 *   <Stack.Screen options={stackPush()} />
 *
 * These spread into the screen's `options` — they set `animation` +
 * `animationDuration` only, so they compose safely with any other option.
 */
import { duration } from "./tokens"

/**
 * A modal present tuned to `slow` (650ms) — the sheet settles with the curator
 * deceleration (the platform default easing for `slide_from_bottom` on iOS).
 * Use with `presentation: "modal"` / `"fullScreenModal"`.
 */
export function modalPresent() {
  return {
    animation: "slide_from_bottom" as const,
    animationDuration: duration.slow,
  }
}

/**
 * A standard stack push tuned to `base` (420ms) — a calm horizontal slide for
 * the non-modal full-screen surfaces (aufgaben, kasse, verkauf, …). The
 * platform default easing is the curator-like deceleration.
 */
export function stackPush() {
  return {
    animation: "slide_from_right" as const,
    animationDuration: duration.base,
  }
}

/**
 * A calm fade for surfaces where a slide would feel heavy (search, settings
 * subsections). `fade` over `fast` keeps it snappy.
 */
export function calmFade() {
  return {
    animation: "fade" as const,
    animationDuration: duration.fast,
  }
}

/**
 * iOS-native modal presentation (`ios` preset) — the platform's signature
 * card-lift + scrim, tuned to `slow`. Use only on surfaces where the native
 * iOS feel is wanted (the primary detail sheets).
 */
export function iosModal() {
  return {
    animation: "ios" as const,
    animationDuration: duration.slow,
  }
}
