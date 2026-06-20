/**
 * Die Schatzkammer — the owner productivity dashboard (Owner OS).
 *
 * A gamified, gauges-on-the-books surface where EVERY number is a real value
 * from a real endpoint. No fabrication: a gauge renders ONLY when its own
 * endpoint returns real data; anything missing falls back to a locked "bald"
 * placeholder, never a fake number.
 *
 * Sources (each loaded independently via Promise.allSettled so one missing
 * endpoint never blanks the others):
 *   • bridgeApi.summary      — Tagesumsatz, Ankäufe heute, Verkäufe heute (core).
 *   • dashboard.summary      — Expertisen (pendingAppraisals).
 *   • closingsApi.list       — the "Schlage gestern" quest + streak.
 *   • financeApi.profit(day) — Gewinn heute (netProfit, period=day).
 *   • financeApi.monthRevenue— Monatsumsatz.
 *   • financeApi.inventoryValue — Lagerwert (Listenwert).
 *   • financeApi.metalWeights— Gold-/Silberbestand (Gramm).
 *   • financeApi.profit(month) + fixedCostsApi.list — the monthly treasure map
 *     (cumulative net profit vs the month's fixed costs → break-even marker).
 *
 * Layout: header → Heute hero (Tagesquest + streak) → live 2×2 gauge grid →
 * Finanz section (finance gauges, locked individually until live) → metal-bestand
 * → monthly treasure map (break-even marker) → trust line.
 *
 * Built on the shared UI kit (StatTile / SectionCard / RingGauge) — no native
 * deps; the gauges are the on-theme bar fallback.
 */
import { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import type {
  BridgeSummary,
  ClosingListItem,
  DashboardSummary,
  FixedCostRow,
  InventoryValueResponse,
  MetalWeightsResponse,
  MonthRevenueResponse,
  ProfitResponse,
} from "@warehouse14/api-client"
import { Flame, Gem, Lock, MapPin, Vault } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import {
  bridgeSummary,
  dashboardSummary,
  describeError,
  financeMonthRevenue,
  financeProfit,
  formatCents,
  inventoryValue,
  listClosings,
  listFixedCosts,
  metalWeights,
} from "@/warehouse14/api"
import {
  computeDailyQuest,
  computeStreak,
  computeTreasureMap,
  GAUGE_TARGETS,
  monthlyFixedCostCents,
  monthStartDay,
  todayBusinessDay,
} from "@/warehouse14/schatzkammer"
import { useW14Theme } from "@/warehouse14/theme"
import { RingGauge, SectionCard, StatTile } from "@/warehouse14/ui"

function heuteLabel(now: Date): string {
  return now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
}

function gramm(g: number): string {
  return `${g.toLocaleString("de-DE", { maximumFractionDigits: 1 })} g`
}

/** A locked "bald verfügbar" StatTile clone for a finance gauge with no data. */
function LockedTile({ label }: { label: string }) {
  const t = useW14Theme()
  return (
    <Card className="gap-2 px-3 py-3" style={{ width: "48%" }}>
      <Text className="text-muted-foreground text-xs" numberOfLines={1}>
        {label}
      </Text>
      <View className="flex-row items-center gap-1.5 py-1">
        <Lock size={14} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground text-xs">bald verfügbar</Text>
      </View>
    </Card>
  )
}

export default function SchatzkammerScreen() {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

  // Core live sources.
  const [bridge, setBridge] = useState<BridgeSummary | null>(null)
  const [dash, setDash] = useState<DashboardSummary | null>(null)
  const [closings, setClosings] = useState<ClosingListItem[]>([])
  // Finance sources — null until their own endpoint returns real data.
  const [profitDay, setProfitDay] = useState<ProfitResponse | null>(null)
  const [profitMonth, setProfitMonth] = useState<ProfitResponse | null>(null)
  const [monthRev, setMonthRev] = useState<MonthRevenueResponse | null>(null)
  const [invValue, setInvValue] = useState<InventoryValueResponse | null>(null)
  const [metals, setMetals] = useState<MetalWeightsResponse | null>(null)
  const [fixedCosts, setFixedCosts] = useState<FixedCostRow[] | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    // Degrade per-source: bridge is the core (required). Everything else lights
    // up only when its own endpoint resolves — a rejected finance read leaves
    // that gauge locked rather than faking a number.
    const [
      bRes,
      dRes,
      cRes,
      pDayRes,
      pMonthRes,
      mRevRes,
      invRes,
      metalRes,
      fixedRes,
    ] = await Promise.allSettled([
      bridgeSummary(),
      dashboardSummary(),
      listClosings(),
      financeProfit("day"),
      financeProfit("month"),
      financeMonthRevenue(),
      inventoryValue(),
      metalWeights(),
      listFixedCosts({ activeOnly: true }),
    ])

    if (bRes.status === "fulfilled") setBridge(bRes.value)
    else setError(describeError(bRes.reason))

    setDash(dRes.status === "fulfilled" ? dRes.value : null)
    setClosings(cRes.status === "fulfilled" ? cRes.value.items : [])
    setProfitDay(pDayRes.status === "fulfilled" ? pDayRes.value : null)
    setProfitMonth(pMonthRes.status === "fulfilled" ? pMonthRes.value : null)
    setMonthRev(mRevRes.status === "fulfilled" ? mRevRes.value : null)
    setInvValue(invRes.status === "fulfilled" ? invRes.value : null)
    setMetals(metalRes.status === "fulfilled" ? metalRes.value : null)
    setFixedCosts(fixedRes.status === "fulfilled" ? fixedRes.value.items : null)
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

  // Finance derivations — only meaningful when the source loaded.
  const profitDayEur = profitDay ? profitDay.netProfitCents / 100 : 0
  const monthRevEur = monthRev ? monthRev.monthToDateRevenueCents / 100 : 0
  const invValueEur = invValue ? invValue.listValueCents / 100 : 0

  // Treasure map needs BOTH month profit AND fixed costs to be honest.
  const hasMap = profitMonth !== null && fixedCosts !== null
  const fixedCostCents = fixedCosts ? monthlyFixedCostCents(fixedCosts, monthStartDay(now)) : 0
  const targetCents = Math.round(GAUGE_TARGETS.monthlyProfitTargetEur * 100)
  const map =
    hasMap && profitMonth
      ? computeTreasureMap(profitMonth.netProfitCents, fixedCostCents, targetCents)
      : null

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 28, gap: 14 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />
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
        <View className="rounded-full px-3 py-1" style={{ borderWidth: 1, borderColor: t.colors.primary }}>
          <Text className="text-xs font-semibold" style={{ color: t.colors.primary }}>
            Goldschmied
          </Text>
        </View>
      </View>

      {/* b) Heute hero — Tagesquest "Schlage gestern" + streak */}
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
            <RingGauge
              value={quest.progress}
              color={quest.beaten ? t.colors.verdigris : t.colors.primary}
            />
          </>
        )}
      </Card>

      {/* c) Live gauge grid (2×2) — from bridge + dashboard */}
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
        <StatTile
          label="Tagesumsatz"
          value={formatCents(bridge.todayRevenueCents)}
          ratio={revenueEur / GAUGE_TARGETS.revenueEur}
          hint={`Ziel ${GAUGE_TARGETS.revenueEur} €`}
        />
        <StatTile
          label="Ankäufe heute"
          value={String(bridge.todayAnkaufCount)}
          ratio={bridge.todayAnkaufCount / GAUGE_TARGETS.ankaufCount}
          tone="accent"
          hint={`Ziel ${GAUGE_TARGETS.ankaufCount}`}
        />
        <StatTile
          label="Verkäufe heute"
          value={String(bridge.todaySalesCount)}
          ratio={bridge.todaySalesCount / GAUGE_TARGETS.soldCount}
          hint={`Ziel ${GAUGE_TARGETS.soldCount}`}
        />
        {dash ? (
          <StatTile
            label="Expertisen"
            value={String(dash.pendingAppraisals)}
            ratio={dash.pendingAppraisals / GAUGE_TARGETS.appraisals}
            tone="accent"
            hint={`Ziel ${GAUGE_TARGETS.appraisals}`}
          />
        ) : (
          <LockedTile label="Expertisen" />
        )}
      </View>

      {/* d) Finance gauges — each tile lights up only when its endpoint is live */}
      <SectionCard title="Finanzen" subtitle="Gewinn, Umsatz und Lagerwert — live aus dem System.">
        <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
          {profitDay ? (
            <StatTile
              label="Gewinn heute"
              value={formatCents(profitDay.netProfitCents)}
              ratio={profitDayEur / GAUGE_TARGETS.netProfitDayEur}
              tone={profitDay.netProfitCents >= 0 ? "accent" : "muted"}
              hint={`Ziel ${GAUGE_TARGETS.netProfitDayEur} €`}
            />
          ) : (
            <LockedTile label="Gewinn heute" />
          )}
          {monthRev ? (
            <StatTile
              label="Monatsumsatz"
              value={formatCents(monthRev.monthToDateRevenueCents)}
              ratio={monthRevEur / GAUGE_TARGETS.monthRevenueEur}
              hint={`Ziel ${GAUGE_TARGETS.monthRevenueEur} €`}
            />
          ) : (
            <LockedTile label="Monatsumsatz" />
          )}
          {invValue ? (
            <StatTile
              label="Lagerwert"
              value={formatCents(invValue.listValueCents)}
              ratio={invValueEur / GAUGE_TARGETS.inventoryValueEur}
              tone="accent"
              hint={`${invValue.availableCount} Artikel`}
            />
          ) : (
            <LockedTile label="Lagerwert" />
          )}
          {map ? (
            <StatTile
              label="Fixkosten gedeckt"
              value={`${Math.round(map.coverage * 100)} %`}
              ratio={map.coverage}
              tone={map.brokeEven ? "accent" : "primary"}
              hint={map.brokeEven ? "Break-even erreicht" : `noch ${formatCents(map.toBreakEvenCents)}`}
            />
          ) : (
            <LockedTile label="Fixkosten gedeckt" />
          )}
        </View>
      </SectionCard>

      {/* e) Metallbestand — Gold + Silber in grams */}
      <SectionCard title="Edelmetallbestand" subtitle="Gewichte aus dem Lager, in Gramm.">
        <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
          {metals ? (
            <>
              <StatTile
                label="Goldbestand"
                value={gramm(metals.goldGrams)}
                ratio={metals.goldGrams / GAUGE_TARGETS.goldGrams}
                hint={`Referenz ${GAUGE_TARGETS.goldGrams} g`}
              />
              <StatTile
                label="Silberbestand"
                value={gramm(metals.silverGrams)}
                ratio={metals.silverGrams / GAUGE_TARGETS.silverGrams}
                tone="accent"
                hint={`Referenz ${GAUGE_TARGETS.silverGrams} g`}
              />
              {metals.platinumGrams > 0 ? (
                <StatTile
                  label="Platinbestand"
                  value={gramm(metals.platinumGrams)}
                  ratio={0}
                  tone="muted"
                  hint="Bestand"
                />
              ) : null}
              {metals.palladiumGrams > 0 ? (
                <StatTile
                  label="Palladiumbestand"
                  value={gramm(metals.palladiumGrams)}
                  ratio={0}
                  tone="muted"
                  hint="Bestand"
                />
              ) : null}
            </>
          ) : (
            <>
              <LockedTile label="Goldbestand" />
              <LockedTile label="Silberbestand" />
            </>
          )}
        </View>
      </SectionCard>

      {/* f) Monthly treasure map — cumulative net profit vs fixed costs */}
      {map ? (
        <SectionCard
          title="Schatzkarte des Monats"
          subtitle="Erst Kosten decken, dann Gewinn heben."
          icon={MapPin}
          action={
            map.brokeEven ? (
              <View
                className="rounded-full px-2.5 py-1"
                style={{ borderWidth: 1, borderColor: t.colors.verdigris }}
              >
                <Text className="text-xs font-semibold" style={{ color: t.colors.verdigris }}>
                  Break-even
                </Text>
              </View>
            ) : (
              <Gem size={18} color={t.colors.primary} />
            )
          }
        >
          <View className="gap-1">
            <View className="flex-row items-end justify-between">
              <Text className="text-2xl font-bold" style={!map.brokeEven ? undefined : { color: t.colors.verdigris }}>
                {formatCents(map.netProfitCents)}
              </Text>
              <Text className="text-muted-foreground text-xs">
                Ziel {formatCents(targetCents)}
              </Text>
            </View>

            {/* Progress bar toward the profit target, with a break-even flag. */}
            <View className="relative w-full py-1.5">
              <View
                className="h-3 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: t.colors.border }}
              >
                <View
                  style={{
                    width: `${Math.round(map.targetProgress * 100)}%`,
                    height: "100%",
                    backgroundColor: map.brokeEven ? t.colors.verdigris : t.colors.primary,
                  }}
                />
              </View>
              {map.breakEvenMarker !== null ? (
                <View
                  className="absolute"
                  style={{
                    left: `${Math.round(map.breakEvenMarker * 100)}%`,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    backgroundColor: t.colors.foreground,
                  }}
                />
              ) : null}
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
                Fixkosten {formatCents(map.fixedCostCents)} (Break-even)
              </Text>
              <Text
                className="text-xs font-semibold"
                style={{ color: map.brokeEven ? t.colors.verdigris : t.colors.primary }}
              >
                {map.brokeEven ? "Kosten gedeckt" : `noch ${formatCents(map.toBreakEvenCents)}`}
              </Text>
            </View>
          </View>
        </SectionCard>
      ) : (
        <Card
          className="gap-2.5 px-4 py-4"
          style={{ borderWidth: 1, borderStyle: "dashed", borderColor: t.colors.border }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-muted-foreground text-sm font-semibold">
              Schatzkarte des Monats · Kosten decken → Gewinn
            </Text>
            <Lock size={14} color={t.colors.mutedForeground} />
          </View>
          <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
            Break-even-Marke erscheint, sobald Monatsgewinn und Fixkosten geladen sind.
          </Text>
        </Card>
      )}

      {/* g) Trust line */}
      <Text className="text-muted-foreground text-center" style={{ fontSize: 11 }}>
        Jeder Wert ist eine echte Zahl aus dem System.
      </Text>
    </ScrollView>
  )
}
