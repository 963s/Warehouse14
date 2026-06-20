/**
 * Warehouse14 Owner OS — the native-feel layer.
 *
 * The thin, shared layer that makes the app feel native under the finger: the
 * haptic vocabulary, safe-area paddings, the keyboard-avoidance scaffold, and
 * the gesture wiring. Every surface reaches for these so touch feedback,
 * notch/home-indicator handling, and swipes feel identical everywhere — and so
 * a screen never re-derives inset maths or hand-rolls a keyboard view.
 *
 *   haptics       — the DESIGN.md §7 vocabulary (selection / success / warning /
 *                   error / impactLight|Medium|Heavy). Degrades to a no-op when
 *                   `expo-haptics` is absent and honours the system setting.
 *   useScreenInsets — safe-area insets pre-derived into the page padding,
 *                   sticky-bar bottom, and scroll-body bottom surfaces want.
 *   KeyboardAvoidingScreen — the shared keyboard-aware scroll + sticky-footer
 *                   scaffold every input surface sits in.
 *   gestures      — the gesture-handler API re-exported (GestureDetector /
 *                   Gesture / Directions) plus the worklet→haptic bridge and the
 *                   swipe-to-dismiss preset.
 */
export {
  haptics,
  selection,
  success,
  warning,
  error,
  impactLight,
  impactMedium,
  impactHeavy,
  hapticsAvailable,
  type Haptics,
} from "./haptics"

export {
  useScreenInsets,
  type ScreenInsets,
  type ScreenInsetsOptions,
} from "./useScreenInsets"

export {
  KeyboardAvoidingScreen,
  type KeyboardAvoidingScreenProps,
} from "./KeyboardAvoidingScreen"

export {
  GestureDetector,
  Gesture,
  Directions,
  hapticOnUI,
  swipeToDismiss,
  type HapticKind,
  type SwipeToDismissOptions,
  type GestureType,
  type PanGesture,
  type TapGesture,
  type LongPressGesture,
  type FlingGesture,
} from "./gestures"
