/**
 * Haptics — the Owner OS's small, deliberate haptic vocabulary (DESIGN.md §7).
 *
 * Haptics confirm meaning; they are never decoration. One feeling per meaning,
 * nothing fires on scroll or on every render, and never two haptics for one
 * event. This module is the ONE place a surface reaches for touch feedback, so
 * the whole app feels identical under the finger.
 *
 *   selection()  — tap a primary control / row that navigates; toggle, segment,
 *                  picker tick.
 *   success()    — a save / create / confirm succeeded (pairs with verdigris).
 *   warning()    — a warning (PIN attempts low, approaching a lockout).
 *   error()      — a validation error / blocked action (pairs with the error
 *                  banner).
 *   impactLight()  — a light press confirm (sheet open, row expand).
 *   impactMedium() — a money-path commit on the press (sale, payout, Z-Bon).
 *   impactHeavy()  — reaching a milestone / gamification reward, ONCE, with the
 *                    gold flourish (the GoldFlood's `onReachPeak`).
 *
 * Graceful degradation: `expo-haptics` is an OPTIONAL dependency. If it is not
 * installed (or the platform has no Taptic engine), every call here is a safe
 * no-op — the surface code never branches on availability. expo-haptics itself
 * honours the device's system haptics setting, so a device with haptics off
 * also feels nothing. All triggers are fire-and-forget: we never await them and
 * never let a rejected promise surface as an unhandled rejection.
 */

/**
 * The slice of the `expo-haptics` API we use, declared locally so this file
 * type-checks whether or not the package is installed (it is not a hard dep).
 * The runtime shapes mirror expo-haptics exactly.
 */
type ImpactStyle = "light" | "medium" | "heavy"
type NotificationType = "success" | "warning" | "error"

interface ExpoHapticsModule {
  selectionAsync: () => Promise<void>
  impactAsync: (style?: unknown) => Promise<void>
  notificationAsync: (type?: unknown) => Promise<void>
  ImpactFeedbackStyle: { Light: unknown; Medium: unknown; Heavy: unknown }
  NotificationFeedbackType: { Success: unknown; Warning: unknown; Error: unknown }
}

/**
 * Resolve `expo-haptics` exactly once, lazily, behind a guarded require so a
 * missing package degrades to a no-op instead of a Metro resolution error.
 * `null` once resolution has failed; the loaded module otherwise.
 */
let resolved: ExpoHapticsModule | null | undefined
function getHaptics(): ExpoHapticsModule | null {
  if (resolved !== undefined) return resolved
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    resolved = require("expo-haptics") as ExpoHapticsModule
  } catch {
    resolved = null
  }
  return resolved
}

/** True when `expo-haptics` is available and feedback can actually be felt. */
export function hapticsAvailable(): boolean {
  return getHaptics() !== null
}

/** Run a haptic body fire-and-forget; swallow rejections so callers stay clean. */
function fire(run: (h: ExpoHapticsModule) => Promise<void>): void {
  const h = getHaptics()
  if (h === null) return
  try {
    const p = run(h)
    if (p && typeof p.then === "function") p.then(undefined, () => {})
  } catch {
    // Native call threw synchronously (no engine): stay silent.
  }
}

function impactStyleValue(h: ExpoHapticsModule, style: ImpactStyle): unknown {
  switch (style) {
    case "light":
      return h.ImpactFeedbackStyle.Light
    case "medium":
      return h.ImpactFeedbackStyle.Medium
    case "heavy":
      return h.ImpactFeedbackStyle.Heavy
  }
}

function notificationTypeValue(h: ExpoHapticsModule, type: NotificationType): unknown {
  switch (type) {
    case "success":
      return h.NotificationFeedbackType.Success
    case "warning":
      return h.NotificationFeedbackType.Warning
    case "error":
      return h.NotificationFeedbackType.Error
  }
}

/** Tap a primary control / row that navigates; toggle, segment, picker tick. */
export function selection(): void {
  fire((h) => h.selectionAsync())
}

/** A save / create / confirm succeeded. Pairs with the verdigris confirmation. */
export function success(): void {
  fire((h) => h.notificationAsync(notificationTypeValue(h, "success")))
}

/** A warning — PIN attempts low, approaching a lockout. */
export function warning(): void {
  fire((h) => h.notificationAsync(notificationTypeValue(h, "warning")))
}

/** A validation error / blocked action. Pairs with the destructive banner. */
export function error(): void {
  fire((h) => h.notificationAsync(notificationTypeValue(h, "error")))
}

/** A light press confirm — sheet open, row expand. */
export function impactLight(): void {
  fire((h) => h.impactAsync(impactStyleValue(h, "light")))
}

/** A money-path commit on the press — sale, payout, Z-Bon. */
export function impactMedium(): void {
  fire((h) => h.impactAsync(impactStyleValue(h, "medium")))
}

/** Reaching a milestone / gamification reward — fire ONCE with the gold flourish. */
export function impactHeavy(): void {
  fire((h) => h.impactAsync(impactStyleValue(h, "heavy")))
}

/**
 * The whole vocabulary as one object, for surfaces that prefer `haptics.success()`
 * over named imports. Same functions, same no-op-when-absent behaviour.
 */
export const haptics = {
  selection,
  success,
  warning,
  error,
  impactLight,
  impactMedium,
  impactHeavy,
  isAvailable: hapticsAvailable,
} as const

export type Haptics = typeof haptics
