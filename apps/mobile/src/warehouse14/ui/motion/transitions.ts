/**
 * transitions — ready-made reanimated entering/exiting animations for the
 * Owner OS. These are the ONLY enter/exit vocabularies a surface should use;
 * pass them to `Animated.View`'s `entering` / `exiting` props.
 *
 * Each builder takes an optional `reduceMotion` flag (read it once at the call
 * site via `useReduceMotion()`): when true, the animation degrades to an
 * opacity-only cross-fade with translate/scale stripped, per DESIGN.md §6.
 *
 * Reanimated also honours the OS setting on its own builders via
 * `.reduceMotion(ReduceMotion.System)`, but we additionally hand-author the
 * reduced variants so the *shape* of the degrade is intentional rather than a
 * generic fallback.
 */
import { FadeIn, FadeInDown, FadeOut, FadeOutDown, ReduceMotion } from "react-native-reanimated"
import type { BaseAnimationBuilder } from "react-native-reanimated"

import { duration, enterRise } from "./tokens"

/**
 * Content-entrance tuning — deliberately BRISKER than the token scale. A
 * screen body usually renders straight from cache the moment navigation
 * lands; at `base` (420ms) with a 70ms-per-item cascade the content visibly
 * "assembled" AFTER arrival. A 240ms fade with a 40ms step capped at 200ms
 * keeps the cascade readable while the whole body settles inside a single
 * perceptual beat, so a cached screen reads as "already there".
 */
const contentEnter = {
  /** Per-item fade+rise duration (ms). */
  durationMs: 240,
  /** Delay between consecutive items (ms). */
  staggerStep: 40,
  /** Hard ceiling on total stagger delay; items past this share the cap. */
  staggerMaxDelay: 200,
} as const

/** Anything assignable to an `entering` / `exiting` prop. */
type AnimationBuilder = BaseAnimationBuilder | typeof BaseAnimationBuilder

/**
 * Screen / large-block entrance: fade + an upward rise over `base`. The
 * standard way a freshly-presented surface settles in.
 */
export function screenEnter(reduceMotion = false): AnimationBuilder {
  if (reduceMotion) {
    return FadeIn.duration(duration.fast).reduceMotion(ReduceMotion.System)
  }
  return FadeInDown.duration(duration.base)
    .withInitialValues({ transform: [{ translateY: enterRise }] })
    .reduceMotion(ReduceMotion.Never)
}

/** Screen / large-block exit: fade + a downward fall over `slow`. */
export function screenExit(reduceMotion = false): AnimationBuilder {
  if (reduceMotion) {
    return FadeOut.duration(duration.fast).reduceMotion(ReduceMotion.System)
  }
  return FadeOutDown.duration(duration.slow).reduceMotion(ReduceMotion.Never)
}

/**
 * A single list/section item entrance: fade + 8px rise at the brisk
 * `contentEnter` tempo. Combine with `staggerDelay(index)` to cascade a list.
 * Used directly by `<Stagger>`.
 */
export function itemEnter(index = 0, reduceMotion = false): AnimationBuilder {
  if (reduceMotion) {
    // Opacity only, no translate, no per-item delay — everything cross-fades
    // together so a long list does not feel like a slow queue.
    return FadeIn.duration(duration.fast).reduceMotion(ReduceMotion.System)
  }
  return FadeInDown.duration(contentEnter.durationMs)
    .delay(staggerDelay(index))
    .withInitialValues({ transform: [{ translateY: enterRise }] })
    .reduceMotion(ReduceMotion.Never)
}

/** A single list/section item exit: fade over `fast`. */
export function itemExit(reduceMotion = false): AnimationBuilder {
  if (reduceMotion) {
    return FadeOut.duration(duration.fast).reduceMotion(ReduceMotion.System)
  }
  return FadeOut.duration(duration.fast).reduceMotion(ReduceMotion.Never)
}

/**
 * The stagger delay (ms) for the Nth item, capped so long lists stay snappy:
 * once the running total would exceed the `contentEnter` cap, every later
 * item shares the cap instead of marching further out.
 */
export function staggerDelay(index: number): number {
  if (index <= 0) return 0
  return Math.min(index * contentEnter.staggerStep, contentEnter.staggerMaxDelay)
}
