/**
 * Route-level animation options for React Navigation's native Stack
 * (expo-router's `Stack`, which is a fork of `@react-navigation/native-stack`).
 *
 * The native-stack API exposes string `animation` presets + a numeric
 * `animationDuration`, animated on the native thread (react-native-screens) at
 * 60fps. The presets themselves are platform-correct (iOS slide-up modal,
 * horizontal push, calm fade). Durations are tuned to PLATFORM-NATIVE speed,
 * not the content scale: an earlier build reused the content tokens
 * (base 420 / slow 650) here, which made every navigation feel slower than
 * the OS itself — the one place the house calm must NOT win over the
 * platform's muscle memory (~250ms push, ~300ms modal present).
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
 * Route-transition durations (ms) — deliberately SEPARATE from the content
 * `duration` tokens. Navigation must match the platform's own tempo (an iOS
 * push is ~250ms, a modal present ~300ms); the content scale (base 420 /
 * slow 650) is for elements settling INSIDE a screen, and reusing it here made
 * the whole app feel slower than the OS.
 */
const navDuration = {
  /** Horizontal stack push / pop. */
  push: 250,
  /** Bottom-sheet / modal present + dismiss. */
  modal: 300,
} as const

/**
 * A modal present at platform-native tempo (~300ms) — the sheet settles with
 * the curator deceleration (the platform default easing for
 * `slide_from_bottom` on iOS). Use with `presentation: "modal"` /
 * `"fullScreenModal"`.
 */
export function modalPresent() {
  return {
    animation: "slide_from_bottom" as const,
    animationDuration: navDuration.modal,
  }
}

/**
 * A standard stack push at platform-native tempo (~250ms) — a crisp horizontal
 * slide for the non-modal full-screen surfaces (aufgaben, kasse, verkauf, …).
 * The platform default easing is the curator-like deceleration.
 */
export function stackPush() {
  return {
    animation: "slide_from_right" as const,
    animationDuration: navDuration.push,
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
 * card-lift + scrim at the platform's OWN timing (no duration override; the
 * system transition is the reference feel). Use only on surfaces where the
 * native iOS feel is wanted (the primary detail sheets).
 */
export function iosModal() {
  return {
    animation: "ios" as const,
  }
}
