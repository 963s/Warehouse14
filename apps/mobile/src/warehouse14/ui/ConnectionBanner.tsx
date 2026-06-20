/**
 * ConnectionBanner — the slim, honest "you're offline" bar.
 *
 * The mobile app has no NetInfo native module, so this banner does NOT probe
 * the OS. It mirrors the `connection` store, which the live-data layer feeds
 * with the real outcome of every read: when the last transport attempt failed
 * to reach the cloud (or the circuit is open), the store flips to `offline`
 * and this bar slides down. The moment any request succeeds again, it slides
 * away. So the bar is never a guess — it states exactly what the app just
 * experienced.
 *
 *   <ConnectionBannerHost />  — mount ONCE at the app root (above the router).
 *                                It floats under the status bar, over content,
 *                                and shows/hides itself off the store.
 *
 * Copy is calm, not alarming — offline is an expected state in a shop with a
 * patchy LAN, and the data layer keeps showing the last good data underneath.
 */
import { type ReactNode } from "react"
import { Platform, StyleSheet, View } from "react-native"
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { CloudOff } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { useConnection } from "./data/connection"
import { duration } from "./motion/tokens"
import { useReduceMotion } from "./motion/useReduceMotion"

const OFFLINE_LABEL = "Offline — Daten werden lokal gehalten"

/**
 * The visual bar. Rendered only while offline by the Host; kept separate so it
 * can also be dropped inline into a specific surface if ever wanted.
 */
export function ConnectionBanner(): ReactNode {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReduceMotion()

  // A muted destructive wash — present enough to notice, calm enough to ignore
  // while you keep working off the last good data underneath.
  const bg = t.colors.destructive + (t.isDark ? "26" : "1A")

  return (
    <Animated.View
      // Slide down from under the status bar on appear, retract on disappear.
      // Reduced motion degrades to a plain cross-fade via the System flag.
      entering={
        reduceMotion
          ? FadeInUp.duration(duration.fast)
          : FadeInUp.duration(duration.base)
      }
      exiting={
        reduceMotion
          ? FadeOutUp.duration(duration.fast)
          : FadeOutUp.duration(duration.fast)
      }
      pointerEvents="none"
      style={[
        styles.container,
        {
          paddingTop: insets.top + 6,
          backgroundColor: bg,
          borderBottomColor: t.colors.destructive + "40",
        },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={OFFLINE_LABEL}
    >
      <View style={styles.row}>
        <CloudOff size={t.icon.xs} color={t.colors.destructive} />
        <Text className="text-sm font-medium" style={{ color: t.colors.destructive }}>
          {OFFLINE_LABEL}
        </Text>
      </View>
    </Animated.View>
  )
}

/**
 * Mount ONCE at the app root. Subscribes to the connection store and renders the
 * bar only while offline; absent (and zero-cost) while online.
 */
export function ConnectionBannerHost(): ReactNode {
  const { status } = useConnection()
  if (status !== "offline") return null
  return <ConnectionBanner />
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    paddingBottom: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    // Subtle lift so the bar reads as floating over content, not inline.
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
})
