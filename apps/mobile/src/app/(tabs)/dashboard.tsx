/**
 * Die Schatzkammer — the owner productivity dashboard (v0, Phase 1).
 *
 * A gamified, gauges-on-the-books surface: EVERY number is a real value from a
 * real endpoint (bridge/summary + dashboard/summary + closings). No fabrication:
 * anything without a live source renders as a LOCKED placeholder ("bald
 * verfügbar"), never a fake number. The finance gauges + the treasure-map
 * break-even marker light up in a later phase when the finance backend lands.
 *
 * Layout: header → Heute hero (Tagesquest "Schlage gestern" + streak) → 2×2 live
 * gauge grid → locked finance row → locked treasure-map card → trust line.
 * Rings would need react-native-svg (not a dependency) — we use clean horizontal
 * bar gauges instead (flat, on-theme), per the spec's fallback.
 */
import { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import type { BridgeSummary, ClosingListItem, DashboardSummary } from "@warehouse14/api-client"
import { Flame, Gem, Lock, Vault } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import {
  bridgeSummary,
  dashboardSummary,
  describeError,
  formatCents,
  listClosings,
} from "@/warehouse14/api"
import {
  computeDailyQuest,
  computeStreak,
  GAUGE_TARGETS,
  todayBusinessDay,
} from "@/warehouse14/schatzkammer"
import { useW14Theme } from "@/warehouse14/theme"

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

function heuteLabel(now: Date): string {
  return now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
}

/** Flat horizontal bar gauge (no svg). `value` is a 0..1 ratio. */
function BarGauge({ value, color }: { value: number; color: string }) {
  const t = useW14Theme()
  return (
    <View
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: t.colors.border }}
    >
      <View
        style={{
          width: `${Math.round(clamp01(value) * 100)}%`,
          height: "100%",
          backgroundColor: color,
        }}
      />
    </View>
  )
}

function GaugeTile({
  label,
  value,
  ratio,
  color,
  hint,
  muted,
}: {
  label: string
  value: string
  ratio: number
  color: string
  hint: string
  muted?: boolean
}) {
  const t = useW14Theme()
  return (
    <Card className="gap-2 px-3 py-3" style={{ width: "48%" }}>
      <Text className="text-muted-foreground text-xs">{label}</Text>
      <Text
        className="text-2xl font-bold"
        style={muted ? { color: t.colors.mutedForeground } : undefined}
        numberOfLines={1}
      >
        {value}
      </Text>
      <BarGauge value={ratio} color={color} />
      <Text className="text-muted-foreground" style={{ fontSize: 10 }}>
        {hint}
      </Text>
    </Card>
  )
}

function LockedTile({ label }: { label: string }) {
  const t = useW14Theme()
  return (
    <View
      className="items-center justify-center gap-1.5 rounded-xl px-3 py-4"
      style={{ width: "48%", borderWidth: 1, borderStyle: "dashed", borderColor: t.colors.border }}
    >
      <Lock size={16} color={t.colors.mutedForeground} />
      <Text className="text-muted-foreground text-xs">{label}</Text>
    </View>
  )
}

function DividerLabel({ text }: { text: string }) {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center gap-3 pt-1">
      <View className="h-px flex-1" style={{ backgroundColor: t.colors.border }} />
      <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
        {text}
      </Text>
      <View className="h-px flex-1" style={{ backgroundColor: t.colors.border }} />
    </View>
  )
}

export default function SchatzkammerScreen() {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

  const [bridge, setBridge] = useState<BridgeSummary | null>(null)
  const [dash, setDash] = useState<DashboardSummary | null>(null)
  const [closings, setClosings] = useState<ClosingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    // Degrade per-source: bridge is the core (required); dashboard (appraisals)
    // and closings (the quest) light up only when they load — never faked.
    const [bRes, dRes, cRes] = await Promise.allSettled([
      bridgeSummary(),
      dashboardSummary(),
      listClosings(),
    ])
    if (bRes.status === "fulfilled") setBridge(bRes.value)
    else setError(describeError(bRes.reason))
    setDash(dRes.status === "fulfilled" ? dRes.value : null)
    setClosings(cRes.status === "fulfilled" ? cRes.value.items : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  if (loading) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Text className="text-muted-foreground">Lade Schatzkammer…</Text>
      </View>
    )
  }

  if (!bridge) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Card className="gap-2 border-destructive px-4 py-4">
          <Text className="text-destructive text-base font-semibold">Fehler</Text>
          <Text className="text-muted-foreground text-sm">{error ?? "Keine Daten."}</Text>
        </Card>
      </View>
    )
  }

  const now = new Date()
  const biz = todayBusinessDay(now)
  const quest = computeDailyQuest(bridge.todayRevenueCents, closings, biz)
  const streak = computeStreak(closings, biz)
  const revenueEur = bridge.todayRevenueCents / 100

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 28, gap: 14 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={t.colors.primary}
        />
      }
    >
      {/* a) Header */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <Vault size={24} color={t.colors.primary} />
          <View>
            <Text className="text-xl font-bold">Die Schatzkammer</Text>
            <Text className="text-muted-foreground text-xs">Heute · {heuteLabel(now)}</Text>
          </View>
        </View>
        <View
          className="rounded-full px-3 py-1"
          style={{ borderWidth: 1, borderColor: t.colors.primary }}
        >
          <Text className="text-xs font-semibold" style={{ color: t.colors.primary }}>
            Goldschmied
          </Text>
        </View>
      </View>

      {/* b) Heute hero — Tagesquest + streak */}
      <Card className="gap-2 px-4 py-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-semibold">Tagesquest · Schlage gestern</Text>
          {streak > 0 ? (
            <View className="flex-row items-center gap-1">
              <Flame size={14} color={t.colors.primary} />
              <Text className="text-xs font-semibold" style={{ color: t.colors.primary }}>
                {streak} Tage
              </Text>
            </View>
          ) : null}
        </View>

        <Text className="text-3xl font-bold">{formatCents(bridge.todayRevenueCents)}</Text>

        {quest.yesterdayCents === null ? (
          <Text className="text-muted-foreground text-xs">
            Noch kein Vortagswert — heute legt die Messlatte.
          </Text>
        ) : (
          <>
            <Text className="text-muted-foreground text-xs">
              gestern {formatCents(quest.yesterdayCents)}
            </Text>
            {quest.beaten ? (
              <Text className="text-sm font-semibold" style={{ color: t.colors.verdigris }}>
                geschafft
              </Text>
            ) : (
              <Text className="text-muted-foreground text-sm">
                noch {formatCents(quest.remainingCents)}
              </Text>
            )}
            <BarGauge
              value={quest.progress}
              color={quest.beaten ? t.colors.verdigris : t.colors.primary}
            />
          </>
        )}
      </Card>

      {/* c) Live gauge grid (2×2) */}
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
        <GaugeTile
          label="Tagesumsatz"
          value={formatCents(bridge.todayRevenueCents)}
          ratio={revenueEur / GAUGE_TARGETS.revenueEur}
          color={t.colors.primary}
          hint={`Ziel ${GAUGE_TARGETS.revenueEur} €`}
        />
        <GaugeTile
          label="Ankäufe heute"
          value={String(bridge.todayAnkaufCount)}
          ratio={bridge.todayAnkaufCount / GAUGE_TARGETS.ankaufCount}
          color={t.colors.verdigris}
          hint={`Ziel ${GAUGE_TARGETS.ankaufCount}`}
        />
        <GaugeTile
          label="Verkäufe heute"
          value={String(bridge.todaySalesCount)}
          ratio={bridge.todaySalesCount / GAUGE_TARGETS.soldCount}
          color={t.colors.primary}
          hint={`Ziel ${GAUGE_TARGETS.soldCount}`}
        />
        <GaugeTile
          label="Expertisen"
          value={dash ? String(dash.pendingAppraisals) : "—"}
          ratio={dash ? dash.pendingAppraisals / GAUGE_TARGETS.appraisals : 0}
          color={t.colors.verdigris}
          hint={dash ? `Ziel ${GAUGE_TARGETS.appraisals}` : "nicht verfügbar"}
          muted={!dash}
        />
      </View>

      {/* d) Locked finance row */}
      <DividerLabel text="Finanz-Modul · bald verfügbar" />
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
        <LockedTile label="Fixkosten" />
        <LockedTile label="Gewinn" />
        <LockedTile label="Gold g" />
        <LockedTile label="Monat €" />
      </View>

      {/* e) Treasure-map card — locked/preview (no fabricated %) */}
      <Card
        className="gap-2.5 px-4 py-4"
        style={{ borderWidth: 1, borderStyle: "dashed", borderColor: t.colors.border }}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm font-semibold">
            Monatsziel · Kosten decken → Gewinn
          </Text>
          <Lock size={14} color={t.colors.mutedForeground} />
        </View>
        <View className="flex-row items-center gap-2">
          <View
            className="h-3 flex-1 overflow-hidden rounded-full"
            style={{ backgroundColor: t.colors.border }}
          />
          <Gem size={18} color={t.colors.mutedForeground} />
        </View>
        <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
          Break-even-Marke erscheint mit dem Finanz-Modul.
        </Text>
      </Card>

      {/* f) Trust line */}
      <Text className="text-muted-foreground text-center" style={{ fontSize: 11 }}>
        Jeder Wert ist eine echte Zahl aus dem System.
      </Text>
    </ScrollView>
  )
}
