/**
 * Motion tokens — the single source of truth for HOW the Owner OS moves.
 *
 * Mirrors docs/DESIGN-SYSTEM.md §5 exactly (the official store law):
 *   • ease-out "curator"  cubic-bezier(0.16, 1, 0.3, 1)  — entrances (the
 *     signature curve; the most-used easing in the app).
 *   • ease-hover          cubic-bezier(0.4, 0, 0.2, 1)   — small interactions
 *     (press, hover, toggle).
 *   • Durations: fast 180ms / base 420ms / slow 650ms.
 *   • Stagger: 70ms between consecutive items.
 * Rules (binding): enter ONCE; hover = ONE calm change; infinite motion only
 * for continuous meaning; always respect prefers-reduced-motion (jump to the
 * end); animate ONLY transform + opacity. NO glow, NO bloom, NO gaudy ripple.
 *
 * Every surface reaches for these and nothing else, so the whole app moves the
 * same way. No surface should inline a raw duration or hand-roll a spring.
 */
import { Easing } from "react-native-reanimated"
import type { WithTimingConfig, WithSpringConfig } from "react-native-reanimated"

/**
 * Durations (ms) — the official scale.
 *   instant — press feedback only (scale/opacity dip); never an entrance.
 *   fast    — small interactions (chevron rotate, value cross-fade, toggle).
 *   base    — the default entrance: card/list-item fade-in, sheet content settle.
 *   slow    — full-screen / route / sheet present + dismiss.
 */
export const duration = {
  instant: 90,
  fast: 180,
  base: 420,
  slow: 650,
} as const

export type DurationToken = keyof typeof duration

/**
 * Named easings (DESIGN-SYSTEM.md §5).
 *   standard — the curator ease-out (0.16, 1, 0.3, 1): entrances + moves.
 *              Decelerate into rest; the signature curve of the app.
 *   hover    — ease-hover (0.4, 0, 0.2, 1): small interactions (press, toggle).
 *   exit     — accelerate away on dismiss.
 */
export const easing = {
  standard: Easing.bezier(0.16, 1, 0.3, 1),
  hover: Easing.bezier(0.4, 0, 0.2, 1),
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
 * Stagger between consecutive list items (ms) — the official 70ms step. A cap
 * keeps long lists from feeling slow: the last visible item should still land
 * promptly. The cap is sized so a typical 6-row cascade (~5×70 = 350ms) plays
 * in full, while a 30-row list compresses instead of crawling.
 */
export const stagger = {
  step: 70,
  /** Hard ceiling on total stagger delay; items past this share the cap. */
  maxDelay: 600,
} as const

/** A standard timing config for a given duration token + the curator easing. */
export function timingStandard(token: DurationToken): WithTimingConfig {
  return { duration: duration[token], easing: easing.standard }
}

/** A small-interaction timing config (press/hover) for a given duration token. */
export function timingHover(token: DurationToken): WithTimingConfig {
  return { duration: duration[token], easing: easing.hover }
}

/** A standard timing config using the exit (accelerate-away) easing. */
export function timingExit(token: DurationToken): WithTimingConfig {
  return { duration: duration[token], easing: easing.exit }
}
