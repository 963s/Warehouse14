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
            <View
              className="h-8 w-8 items-center justify-center rounded-md"
              style={{ backgroundColor: t.colors.primary + "1f" }}
            >
              <Icon size={18} color={t.colors.primary} />
            </View>
          ) : null}
          <View className="flex-1">
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
