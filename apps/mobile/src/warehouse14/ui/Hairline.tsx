/**
 * Hairline — the fine warm-gold rule that is the ONLY divider weight in the
 * antique system (DESIGN.md §5). A single 1px line in the theme `border`
 * (hairline-gold) colour, used to separate list rows, cap a sticky bar, or
 * underline a header. Depth in this language comes from layering + this rule,
 * never from a heavier shadow.
 *
 * On the web export the `hairline` / `hairline-t` / `hairline-b` className
 * utilities (global.css) do the same; this primitive is the native counterpart
 * for the common case of a standalone divider line in a stack (where a border on
 * a sibling would be awkward). It is decoration — hidden from accessibility.
 *
 *   <Hairline />            // a full-width horizontal rule
 *   <Hairline inset={16} /> // inset from the leading edge, list-row style
 *   <Hairline vertical />   // a vertical rule between inline items
 */
import { type ReactNode } from "react"
import { type DimensionValue, View, type ViewStyle } from "react-native"

import { useW14Theme } from "@/warehouse14/theme"

export interface HairlineProps {
  /** Render a vertical rule (1px wide) instead of the default horizontal. */
  vertical?: boolean
  /**
   * Inset the rule from the leading edge in px (horizontal: left margin;
   * vertical: top margin). Used for list-row separators that start under the
   * text, not under the leading icon. Default 0 (full-bleed).
   */
  inset?: number
  /** Length override — width for horizontal, height for vertical. Default fills. */
  length?: DimensionValue
}

export function Hairline({ vertical = false, inset = 0, length }: HairlineProps): ReactNode {
  const { colors } = useW14Theme()
  // The rule is intrinsically dynamic (orientation · inset · the theme hairline
  // colour), so its style is computed here, not inlined in JSX.
  const style: ViewStyle = vertical
    ? { width: 1, height: length ?? "100%", marginTop: inset, backgroundColor: colors.border }
    : { height: 1, width: length ?? "100%", marginLeft: inset, backgroundColor: colors.border }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    />
  )
}
