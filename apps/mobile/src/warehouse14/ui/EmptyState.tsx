/**
 * EmptyState — the centred placeholder for "nothing here yet" / "not available"
 * states: an icon in a soft disc, a title, an optional description, and an
 * optional action button. W14-themed; German copy supplied by the caller.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Inbox, type LucideIcon } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

export interface EmptyStateProps {
  title: string
  description?: string
  /** Icon shown in the disc (default: Inbox). */
  icon?: LucideIcon
  /** Optional CTA label — renders an outline button when `onAction` is set. */
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  actionLabel,
  onAction,
}: EmptyStateProps): ReactNode {
  const t = useW14Theme()
  return (
    <View className="items-center justify-center gap-3 px-6 py-10">
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1 }}
      >
        <Icon size={24} color={t.colors.mutedForeground} />
      </View>
      <Text className="text-center text-base font-semibold">{title}</Text>
      {description != null ? (
        <Text className="text-muted-foreground max-w-xs text-center text-sm">{description}</Text>
      ) : null}
      {actionLabel != null && onAction ? (
        <Button variant="outline" onPress={onAction} className="mt-1">
          <Text>{actionLabel}</Text>
        </Button>
      ) : null}
    </View>
  )
}
