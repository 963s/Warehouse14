/**
 * Warehouse14 Owner OS UI kit — the shared, W14-themed surface primitives the
 * owner screens are assembled from. All built on the RNR components
 * (@/components/ui/*) + the typed theme (useW14Theme); no native deps added.
 *
 *   RingGauge     — progress gauge (animated bar fallback, no react-native-svg).
 *   StatTile      — half-width KPI tile (label · value · gauge · hint).
 *   SectionCard   — titled panel with optional icon + action slot.
 *   SectionHeader — un-carded group header (title/overline · icon · action).
 *   ListRow       — tappable/static row (icon · title/subtitle · value · chevron).
 *   EmptyState    — centred placeholder (icon · title · description · CTA).
 *   Skeleton      — loading placeholder in a card/row's shape (pulse, RM-aware),
 *                   plus SkeletonText / SkeletonRow / SkeletonCard assemblies.
 *   ErrorState    — centred "couldn't load" block + Retry (offline-aware copy).
 *   InlineError   — the unified non-blocking destructive card (mutation/bg fail).
 *   QueryBoundary — the helper that turns a useQuery result into the right
 *                   state (skeleton · error+retry · empty · content); the one
 *                   wrapper every list/detail screen uses so states are uniform.
 *   ConnectionBanner / ConnectionBannerHost — the honest offline bar (mounted
 *                   once at the root, mirrors the derived connection store).
 *   FormField     — labelled input with hint + per-field error.
 *   FormScreen    — form scaffold: error/success banners + sticky save (step-up
 *                   is transparent via the global StepUpDialogHost).
 *   motion/       — the reanimated-v4 motion system (durations, easings, the
 *                   press-scale, list stagger, CountUp, the break-even GoldFlood);
 *                   re-exported here so surfaces pull one barrel.
 *   data/         — the live-data hook layer (useQuery / useMultiQuery /
 *                   useMutation / useRefreshControl) wrapping ../api: refetch-
 *                   on-focus, pull-to-refresh, polite polling, de-dupe,
 *                   optimistic writes. Re-exported so surfaces pull one barrel.
 *   native/       — the native-feel layer: the haptic vocabulary (no-op when
 *                   expo-haptics is absent), safe-area paddings (useScreenInsets),
 *                   the keyboard-avoidance scaffold (KeyboardAvoidingScreen), and
 *                   the gesture wiring (Gesture/GestureDetector + swipeToDismiss).
 */
export { RingGauge, type RingGaugeProps } from "./RingGauge"
export { StatTile, type StatTileProps, type StatTileTone } from "./StatTile"
export { SectionCard, type SectionCardProps } from "./SectionCard"
export { SectionHeader, type SectionHeaderProps } from "./SectionHeader"
export { ListRow, type ListRowProps } from "./ListRow"
export { EmptyState, type EmptyStateProps } from "./EmptyState"
export {
  Skeleton,
  SkeletonText,
  SkeletonRow,
  SkeletonCard,
  type SkeletonProps,
  type SkeletonTextProps,
  type SkeletonCardProps,
} from "./Skeleton"

// State system — the unified loading / error / empty / offline vocabulary so
// every list and detail screen renders its states the same way.
export { ErrorState, type ErrorStateProps } from "./ErrorState"
export { InlineError, type InlineErrorProps } from "./InlineError"
export {
  QueryBoundary,
  type QueryBoundaryProps,
  type QueryBoundaryEmpty,
} from "./QueryBoundary"
export { ConnectionBanner, ConnectionBannerHost } from "./ConnectionBanner"

export { FormField, type FormFieldProps } from "./FormField"
export { FormScreen, type FormScreenProps } from "./FormScreen"

// Motion system — the shared reanimated-v4 vocabulary every surface moves with.
export * from "./motion"

// Live-data layer — the shared fetch/mutate vocabulary every surface uses.
export * from "./data"

// Native-feel layer — haptics, safe-area paddings, keyboard avoidance, gestures.
// The very generic bare haptic names (success/error/…) are intentionally NOT
// re-exported here to keep the top-level barrel unambiguous; surfaces call them
// through the `haptics` namespace object (haptics.success()) or import the bare
// functions from "@/warehouse14/ui/native" directly.
export {
  haptics,
  hapticsAvailable,
  type Haptics,
  useScreenInsets,
  type ScreenInsets,
  type ScreenInsetsOptions,
  KeyboardAvoidingScreen,
  type KeyboardAvoidingScreenProps,
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
} from "./native"
