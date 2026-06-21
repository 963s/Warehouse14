/**
 * OfflineNotice — the inline, in-context sibling of the global ConnectionBanner.
 *
 * The banner at the app root says „you are offline" once, app-wide. This is the
 * calmer, local note a specific surface drops right above the data it's showing
 * from cache, so the operator understands — exactly where they're looking — that
 * these are the last-good numbers and what the app will do on its own:
 *
 *   „Offline — die angezeigten Daten sind der letzte bekannte Stand.
 *    Aktualisierung erfolgt automatisch, sobald wieder Verbindung besteht."
 *
 * When a surface is also holding a safe write to re-fire on reconnect (via
 * `useSafeRetry`), it passes that hook's `retryHint` so the note can add the one
 * honest line about what happens to that action — including the fiscal case,
 * where the answer is „bitte am Gerät erneut bestätigen", never an auto-retry.
 *
 * It subscribes to the connection store itself and renders NOTHING while online,
 * so a surface can mount it unconditionally. Modelled on InlineError's card +
 * fade, but in a calm muted tone (offline is expected in a patchy-LAN shop, not
 * an error). Theme tokens + motion tokens only.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { CloudOff } from "lucide-react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

import { useIsOffline } from "../ui/data/connection"
import { duration } from "../ui/motion/tokens"
import { useReduceMotion } from "../ui/motion/useReduceMotion"

const DEFAULT_BODY =
  "Die angezeigten Daten sind der letzte bekannte Stand. Aktualisierung erfolgt automatisch, sobald wieder Verbindung besteht."

export interface OfflineNoticeProps {
  /**
   * Force-show regardless of the connection store (e.g. a surface that wants the
   * note while a specific source is locked). Default: shown only while offline.
   */
  show?: boolean
  /** Override the body copy for a surface with a more specific story. */
  message?: string
  /**
   * The honest one-liner from `useSafeRetry().retryHint`, appended as a second
   * line so the note explains what happens to a held action on reconnect.
   */
  retryHint?: string
}

export function OfflineNotice({ show, message, retryHint }: OfflineNoticeProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const offline = useIsOffline()

  const visible = show ?? offline
  if (!visible) return null

  return (
    <Animated.View
      entering={FadeIn.duration(reduceMotion ? duration.fast : duration.base)}
      exiting={FadeOut.duration(duration.fast)}
    >
      <Card
        className="gap-1.5 px-4 py-3.5"
        style={{
          borderColor: t.colors.border,
          backgroundColor: t.colors.mutedForeground + "12",
        }}
        accessibilityRole="summary"
      >
        <View className="flex-row items-start gap-2.5">
          <View className="pt-0.5">
            <CloudOff size={t.icon.sm} color={t.colors.mutedForeground} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-foreground text-sm font-semibold">Offline</Text>
            <Text className="text-muted-foreground text-sm leading-5">
              {message ?? DEFAULT_BODY}
            </Text>
            {retryHint != null ? (
              <Text className="text-muted-foreground text-2xs leading-4 mt-0.5">{retryHint}</Text>
            ) : null}
          </View>
        </View>
      </Card>
    </Animated.View>
  )
}
