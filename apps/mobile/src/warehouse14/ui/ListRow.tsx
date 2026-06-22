/**
 * ListRow — a single row: optional leading icon · title (+ optional subtitle) ·
 * optional right-hand value or slot · optional chevron. Tappable when `onPress`
 * is given (the shared `PressableScale`, ≥44px target), otherwise a static row.
 * The generic building block for list-shaped owner surfaces.
 *
 * Tappable rows press with the spine's one feedback (scale 0.97 + opacity dip on
 * the UI thread, reduced-motion aware) — never a hand-rolled opacity, so every
 * row in the app presses identically (DESIGN-SYSTEM.md §5). A leading icon sits
 * bare (no chip) for a calm, native target. Pass `mono` to render a right-hand
 * value in JetBrains Mono so amounts in a column align (§3).
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { ChevronRight, type LucideIcon } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { PressableScale } from "./motion/PressableScale"

export interface ListRowProps {
  title: string
  subtitle?: string
  /** Leading icon. */
  icon?: LucideIcon
  /** Pre-formatted right-hand value (e.g. an amount). Ignored when `right` is set. */
  value?: string
  /** Render the right-hand `value` in JetBrains Mono (use for money/numeric columns). */
  mono?: boolean
  /** Arbitrary right-hand slot (e.g. a Badge) — wins over `value`. */
  right?: ReactNode
  /** Tap handler — when set the row is pressable and shows a chevron by default. */
  onPress?: () => void
  /** Force-hide the chevron even when pressable. */
  hideChevron?: boolean
  /** Dim the whole row (e.g. disabled / unavailable). */
  muted?: boolean
}

export function ListRow({
  title,
  subtitle,
  icon: Icon,
  value,
  mono = false,
  right,
  onPress,
  hideChevron = false,
  muted = false,
}: ListRowProps): ReactNode {
  const t = useW14Theme()
  const showChevron = !!onPress && !hideChevron && right == null

  const body = (
    <View
      className="min-h-[44px] flex-row items-center gap-3 py-2"
      style={muted ? { opacity: 0.55 } : undefined}
    >
      {Icon ? (
        // The leading icon sits directly — no tinted chip box (box-free). A
        // bare ink glyph is calmer and reads as a native list target.
        <View className="h-7 w-7 items-center justify-center">
          <Icon size={t.icon.md} color={t.colors.foreground} />
        </View>
      ) : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle != null ? (
          <Text className="text-muted-foreground text-xs" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right != null ? (
        right
      ) : value != null ? (
        <Text
          className={mono ? "font-mono-medium text-sm" : "text-sm font-medium"}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {showChevron ? <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} /> : null}
    </View>
  )

  if (!onPress) return body
  return (
    <PressableScale accessibilityRole="button" onPress={onPress}>
      {body}
    </PressableScale>
  )
}
