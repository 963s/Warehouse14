/**
 * SectionCard — a titled panel: header row (icon · title · optional subtitle ·
 * optional right-hand action slot) over its children. The standard container
 * for a labelled group of rows/fields on an owner surface.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import type { LucideIcon } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

export interface SectionCardProps {
  title: string
  /** Optional German one-liner under the title. */
  subtitle?: string
  /** Optional leading icon (brass). */
  icon?: LucideIcon
  /** Optional right-aligned slot (e.g. a small Button or Badge). */
  action?: ReactNode
  children?: ReactNode
}

export function SectionCard({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
}: SectionCardProps): ReactNode {
  const t = useW14Theme()
  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-row items-center gap-2.5">
          {Icon ? (
            // The icon sits directly — no tinted chip box (that was a
            // box-in-box). A bare ink glyph reads calmer + more premium.
            <Icon size={t.icon.md} color={t.colors.foreground} />
          ) : null}
          <View className="flex-1">
            {/* In-card section title stays Inter at the section step (DESIGN-SYSTEM.md §3
                keeps the small in-card header Inter, not the display voice). */}
            <Text className="text-base font-semibold" numberOfLines={1}>
              {title}
            </Text>
            {subtitle != null ? (
              <Text className="text-muted-foreground text-xs" numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {action != null ? <View>{action}</View> : null}
      </View>
      {children != null ? <View className="gap-2.5">{children}</View> : null}
    </Card>
  )
}
