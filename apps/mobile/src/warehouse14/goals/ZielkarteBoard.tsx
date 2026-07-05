/**
 * ZielkarteBoard — the actual treasure-board surface. Split out of the route file
 * (app/zielkarte.tsx) and loaded LAZILY (React.lazy) so its heavy import chain
 * (reanimated worklets + 15 react-native-svg instruments + the live data layer)
 * is NEVER pulled into expo-router's synchronous startup route-map. In a release
 * build expo-router evaluates every route module eagerly at boot; keeping this
 * deep chain behind a lazy import keeps the cold-start require graph shallow so
 * Hermes's native stack never overflows. The board only evaluates when the owner
 * actually opens the Zielkarte — exactly where it belongs.
 */
import { useRouter } from "expo-router"
import { ChevronLeft } from "lucide-react-native"
import { type ReactNode } from "react"
import { Pressable, RefreshControl, ScrollView, StatusBar, View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { TREASURE_COLORS as C, type GoalMetric } from "@/warehouse14/goals/treasure-data"
import { useTreasureMetrics } from "@/warehouse14/goals/treasure-data"
import { GoalsScroll, GoalTile, TreasureMapPanel } from "@/warehouse14/goals/widgets"
import { useScreenInsets } from "@/warehouse14/ui/native/useScreenInsets"

function chunkPairs(items: GoalMetric[]): GoalMetric[][] {
  const rows: GoalMetric[][] = []
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2))
  return rows
}

export default function ZielkarteBoard(): ReactNode {
  const router = useRouter()
  const insets = useScreenInsets()
  const board = useTreasureMetrics()
  const rows = chunkPairs(board.metrics)

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0908" }}>
      <StatusBar barStyle="light-content" />

      {/* Dark immersive header (this route hides the nav header). */}
      <View
        style={{
          paddingTop: insets.screen.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: "#00000088",
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Zurück"
        >
          <ChevronLeft size={26} color={C.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: C.ink,
              fontSize: 20,
              fontWeight: "800",
              letterSpacing: 0.4,
              textShadowColor: "#000",
              textShadowOffset: { width: 0, height: 1.5 },
              textShadowRadius: 2,
            }}
          >
            Zielkarte
          </Text>
          <Text style={{ color: C.inkMuted, fontSize: 11.5 }}>
            Alle Schätze, alle Ziele · live
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: insets.contentBottom + 16,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...board.refresh} tintColor={C.gilt} colors={[C.gilt]} />
        }
      >
        {board.isFirstLoad ? (
          <View style={{ paddingVertical: 80, alignItems: "center", gap: 8 }}>
            <Text style={{ color: C.gilt, fontSize: 15, fontWeight: "700" }}>
              Die Schatzkammer wird vermessen …
            </Text>
            <Text style={{ color: C.inkMuted, fontSize: 12 }}>Echte Zahlen, gleich da.</Text>
          </View>
        ) : (
          <>
            {rows.map((row, i) => (
              <Animated.View
                key={i}
                entering={FadeInDown.delay(i * 55).duration(420)}
                style={{ flexDirection: "row", gap: 12 }}
              >
                {row.map((m) => (
                  <GoalTile key={m.id} metric={m} />
                ))}
                {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
              </Animated.View>
            ))}

            <Animated.View entering={FadeInDown.delay(rows.length * 55).duration(420)}>
              <GoalsScroll bars={board.monthlyBars} />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay((rows.length + 1) * 55).duration(420)}>
              <TreasureMapPanel overall={board.overall} available={board.overallAvailable} />
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
