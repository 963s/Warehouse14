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
 *   FormField     — labelled input with hint + per-field error.
 *   FormScreen    — form scaffold: error/success banners + sticky save (step-up
 *                   is transparent via the global StepUpDialogHost).
 *   motion/       — the reanimated-v4 motion system (durations, easings, the
 *                   press-scale, list stagger, CountUp, the break-even GoldFlood);
 *                   re-exported here so surfaces pull one barrel.
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
export { FormField, type FormFieldProps } from "./FormField"
export { FormScreen, type FormScreenProps } from "./FormScreen"

// Motion system — the shared reanimated-v4 vocabulary every surface moves with.
export * from "./motion"
