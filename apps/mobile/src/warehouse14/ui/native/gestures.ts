/**
 * Gesture helpers — the shared, native-feeling gesture vocabulary, built on
 * react-native-gesture-handler v2 (the `Gesture` builder API) and Reanimated v4.
 *
 * The goal is that swipes, drags and long-presses feel identical across every
 * owner surface and run on the UI thread. Surfaces compose a `Gesture.*` builder
 * inside a `GestureDetector` (both re-exported here so a surface pulls one
 * barrel and never reaches past the spine). On top of the raw builders this adds
 * the one thing the bare API lacks for our look-and-feel: a worklet-safe bridge
 * to fire a spine haptic from inside a gesture callback.
 *
 *   GestureDetector, Gesture, Directions — re-exported gesture-handler API.
 *   hapticOnUI(kind) — call from a `'worklet'` gesture callback to fire the
 *     matching spine haptic on the JS thread (selection / impactLight / …). This
 *     is the bridge that makes a swipe-to-dismiss or a long-press "click" under
 *     the finger without leaving the UI thread or hand-wiring `runOnJS`.
 *   swipeToDismiss({ onDismiss, … }) — a horizontal Pan gesture preset for the
 *     row swipe-to-act pattern, already wired to a light haptic on activate and
 *     calling `onDismiss` once the threshold is crossed.
 *
 * These are intentionally logic-light: a surface still owns the animated style
 * (translate / opacity) it drives from the gesture, so the motion stays in the
 * caller where the design lives. This file only standardises the gesture wiring
 * and the touch feedback.
 */
import { GestureDetector, Gesture, Directions } from "react-native-gesture-handler"
import { runOnJS } from "react-native-reanimated"

import {
  selection as hapticSelection,
  success as hapticSuccess,
  warning as hapticWarning,
  error as hapticError,
  impactLight,
  impactMedium,
  impactHeavy,
} from "./haptics"

// Re-export the gesture-handler surface so callers pull one barrel.
export { GestureDetector, Gesture, Directions }
export type {
  GestureType,
  PanGesture,
  TapGesture,
  LongPressGesture,
  FlingGesture,
} from "react-native-gesture-handler"

/** The spine haptics callable by name from a worklet bridge. */
export type HapticKind =
  | "selection"
  | "success"
  | "warning"
  | "error"
  | "impactLight"
  | "impactMedium"
  | "impactHeavy"

const HAPTIC_BY_KIND: Record<HapticKind, () => void> = {
  selection: hapticSelection,
  success: hapticSuccess,
  warning: hapticWarning,
  error: hapticError,
  impactLight,
  impactMedium,
  impactHeavy,
}

/** Fire a spine haptic by name on the JS thread (used by the worklet bridge). */
function fireHapticByKind(kind: HapticKind): void {
  HAPTIC_BY_KIND[kind]()
}

/**
 * Fire a spine haptic from inside a `'worklet'` gesture callback. Bridges to the
 * JS thread via `runOnJS` so a UI-thread gesture (Pan/LongPress/Tap) can still
 * give the right touch feedback. Call it from within the worklet, e.g.
 *
 *   const pan = Gesture.Pan().onStart(() => { 'worklet'; hapticOnUI('impactLight') })
 */
export function hapticOnUI(kind: HapticKind): void {
  "worklet"
  runOnJS(fireHapticByKind)(kind)
}

export interface SwipeToDismissOptions {
  /** Run once the swipe crosses `threshold` and the gesture ends. */
  onDismiss: () => void
  /**
   * Horizontal travel (px) past which release triggers `onDismiss`.
   * Defaults to 96.
   */
  threshold?: number
  /**
   * Optional live update with the current horizontal translation (px) on every
   * frame, so the caller can drive its own translate/opacity animated style.
   * Runs on the UI thread — keep it a `'worklet'`.
   */
  onUpdate?: (translationX: number) => void
  /** Restrict to one direction: "left" | "right". Default: either. */
  direction?: "left" | "right"
  /** Fire a light haptic the moment the swipe activates (default true). */
  haptic?: boolean
}

/**
 * The horizontal swipe-to-act preset for list rows. Returns a configured Pan
 * `Gesture` you drop into a `GestureDetector`; the caller drives the visual
 * translation from `onUpdate` and reacts to `onDismiss`. Activation fires a
 * light haptic so the row "catches" under the finger.
 */
export function swipeToDismiss(options: SwipeToDismissOptions) {
  const { onDismiss, threshold = 96, onUpdate, direction, haptic = true } = options

  return Gesture.Pan()
    .activeOffsetX(direction === "left" ? [-12, Infinity] : direction === "right" ? [-Infinity, 12] : [-12, 12])
    .onStart(() => {
      "worklet"
      if (haptic) runOnJS(impactLight)()
    })
    .onUpdate((e) => {
      "worklet"
      onUpdate?.(e.translationX)
    })
    .onEnd((e) => {
      "worklet"
      const passed =
        direction === "left"
          ? e.translationX <= -threshold
          : direction === "right"
            ? e.translationX >= threshold
            : Math.abs(e.translationX) >= threshold
      if (passed) runOnJS(onDismiss)()
    })
}
