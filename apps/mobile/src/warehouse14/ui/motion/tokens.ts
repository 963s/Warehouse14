/**
 * Motion tokens — the single source of truth for HOW the Owner OS moves.
 *
 * Mirrors DESIGN.md §6 exactly: four durations, two named timing easings, and
 * one settled emphasis spring. Every surface reaches for these and nothing
 * else, so the whole app moves the same way. No surface should inline a raw
 * duration or hand-roll a spring.
 */
import { Easing } from "react-native-reanimated"
import type { WithTimingConfig, WithSpringConfig } from "react-native-reanimated"

/**
 * Durations (ms).
 *   instant — press feedback (scale/opacity down), toggles
 *   fast    — most enter/exit, value cross-fades, chevron rotation
 *   base    — card/list item entrance, sheet content settle
 *   slow    — full-screen / sheet present + dismiss, route transitions
 */
export const duration = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 320,
} as const

export type DurationToken = keyof typeof duration

/**
 * Named easings (DESIGN.md §6).
 *   standard — enter + move: decelerate into rest.
 *   exit     — accelerate away.
 */
export const easing = {
  standard: Easing.out(Easing.cubic),
  exit: Easing.in(Easing.cubic),
} as const

/**
 * The one emphasis spring — settled, not wobbly. Used sparingly for a KPI
 * gauge filling or a celebratory pop. Timings are the default everywhere else.
 */
export const emphasisSpring: WithSpringConfig = {
  damping: 18,
  stiffness: 180,
  mass: 1,
} as const

/** Press feedback target values, shared by every pressable surface. */
export const press = {
  /** Scale the surface to this on press-in. */
  scale: 0.97,
  /** Dip opacity to this on press-in. */
  opacity: 0.9,
} as const

/** List/section entrance: fade + this many px of upward rise. */
export const enterRise = 8

/**
 * Stagger between consecutive list items (ms), and a cap so long lists never
 * feel slow — the last visible item should still land promptly.
 */
export const stagger = {
  step: 30,
  /** Hard ceiling on total stagger delay; items past this share the cap. */
  maxDelay: 240,
} as const

/** A standard timing config for a given duration token + the standard easing. */
export function timingStandard(token: DurationToken): WithTimingConfig {
  return { duration: duration[token], easing: easing.standard }
}

/** A standard timing config using the exit (accelerate-away) easing. */
export function timingExit(token: DurationToken): WithTimingConfig {
  return { duration: duration[token], easing: easing.exit }
}
