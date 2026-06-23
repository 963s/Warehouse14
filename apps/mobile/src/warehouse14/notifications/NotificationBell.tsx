/**
 * NotificationBell — a header bell that shows the LIVE unread notification count
 * and opens the Notifications Center on tap. Drop it into any screen's header /
 * top bar; it subscribes to the same live store the Center does (which keeps the
 * one shared transport alive while it is mounted), so the badge is always honest
 * and never a stale snapshot.
 *
 * Spine: the §6 press-scale, the §7 selection haptic on navigate, theme tokens
 * only (the badge is ink; a critical-unread bell rings in wax-red). The badge
 * shows a real count from real ledger events, it renders nothing at zero, never
 * a fabricated 0.
 */
import { View } from "react-native"
import { type Href, useRouter } from "expo-router"
import { Bell, BellRing } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { haptics, PressableScale } from "@/warehouse14/ui"

import { useNotifications } from "./useNotifications"

export interface NotificationBellProps {
  /** Icon size override (defaults to the kit's `lg`). */
  size?: number
  /** Where to route on tap. Defaults to the Center. */
  href?: Href
}

export function NotificationBell({ size, href }: NotificationBellProps) {
  const t = useW14Theme()
  const router = useRouter()
  const { unread, hasCriticalUnread } = useNotifications()
  const iconSize = size ?? t.icon.lg

  // A critical unread bell rings in wax-red; otherwise it is a calm ink bell.
  const tint = hasCriticalUnread ? t.colors.destructive : t.colors.foreground
  const Icon = hasCriticalUnread ? BellRing : Bell

  return (
    <PressableScale
      onPress={() => {
        haptics.selection()
        router.push(href ?? ("/benachrichtigungen" as Href))
      }}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Benachrichtigungen, ${unread} ungelesen` : "Benachrichtigungen"
      }
    >
      {/* Bare bell (no tinted disc — box-free). The unread count sits as a
          fixed-size circular badge on top, never stretched by the parent. */}
      <View className="h-10 w-10 items-center justify-center">
        <Icon size={iconSize} color={tint} />
        {unread > 0 ? (
          <View
            className="absolute items-center justify-center rounded-full"
            style={{
              top: 2,
              right: 2,
              minWidth: 18,
              height: 18,
              paddingHorizontal: 4,
              backgroundColor: tint,
              borderWidth: 1.5,
              borderColor: t.colors.background,
            }}
          >
            <Text className="text-2xs font-bold" style={{ color: t.colors.card }}>
              {unread > 99 ? "99+" : unread}
            </Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  )
}
