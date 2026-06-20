/**
 * ListRow — a single row: optional leading icon · title (+ optional subtitle) ·
 * optional right-hand value or slot · optional chevron. Tappable when `onPress`
 * is given (Pressable, ≥44px target), otherwise a static row. The generic
 * building block for list-shaped owner surfaces.
 */
import { type ReactNode } from "react"
import { Pressable, View } from "react-native"
import { ChevronRight, type LucideIcon } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

export interface ListRowProps {
  title: string
  subtitle?: string
  /** Leading icon. */
  icon?: LucideIcon
  /** Pre-formatted right-hand value (e.g. an amount). Ignored when `right` is set. */
  value?: string
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
      {Icon ? <Icon size={18} color={t.colors.primary} /> : null}
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
        <Text className="text-sm font-medium" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {showChevron ? <ChevronRight size={18} color={t.colors.mutedForeground} /> : null}
    </View>
  )

  if (!onPress) return body
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      {body}
    </Pressable>
  )
}
