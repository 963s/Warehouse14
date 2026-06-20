/**
 * Die Schatzkammer — the owner productivity dashboard (Owner OS), the showpiece
 * surface. A gamified, gauges-on-the-books board where EVERY number is a real
 * value from a real endpoint. No fabrication: a gauge lights up ONLY when its own
 * endpoint returns real data; anything missing falls back to a locked "bald"
 * placeholder, never a fake number (DESIGN.md §4 — the honesty rule).
 *
 * Live via the shared data layer: one `useMultiQuery` fans out over every source
 * with `Promise.allSettled` semantics (a failed finance read never blanks the
 * board), refetch-on-focus, polite 30s polling, and pull-to-refresh through
 * `useRefreshControl` — so the board feels live the moment you open the tab.
 *
 * Sources (each settled independently):
 *   • bridgeApi.summary       — Tagesumsatz, Ankäufe heute, Verkäufe heute (core).
 *   • dashboard.summary       — Expertisen (pendingAppraisals).
 *   • closingsApi.list        — the streak + the "Schlage gestern" anchor quest.
 *   • financeApi.profit(day)  — Gewinn heute (netProfit, period=day).
 *   • financeApi.profit(month)+ fixedCostsApi.list — the monthly treasure map
 *     (cumulative net profit vs the month's fixed costs → break-even crossing).
 *   • financeApi.monthRevenue — Monatsumsatz.
 *   • financeApi.inventoryValue — Lagerwert (Listenwert).
 *   • financeApi.metalWeights — Gold-/Silberbestand (Gramm).
 *
 * Gamification (the shared «Spielwirtschaft»): `useGameState` folds the already
 * fetched real values into the streak · rank · seals · daily quest; the day's
 * quest is the hero, the rank + streak read as one card, and the seal wall shows
 * earned-vs-locked honestly. The monthly break-even crossing arms <GoldFlood>
 * exactly once via `useBreakEvenCelebration`, paired with the single Heavy haptic.
 *
 * Built entirely on the shared spine — motion (CountUp, Stagger, GoldFlood),
 * components (StatTile/SectionCard/RingGauge/Skeleton/InlineError), the live-data
 * hooks, haptics, and the game module. Tokens only; de-DE money/dates; German UI.
 */
import { useCallback, useMemo } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import type {
  BridgeSummary,
  ClosingListItem,
  DashboardSummary,
  InventoryValueResponse,
  MetalWeightsResponse,
  MonthRevenueResponse,
  ProfitResponse,
} from "@warehouse14/api-client"
import { Gem, Lock, MapPin, Vault } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import {
  bridgeSummary,
  dashboardSummary,
  financeMonthRevenue,
  financeProfit,
  formatCents,
  inventoryValue,
  listClosings,
  listFixedCosts,
  metalWeights,
} from "@/warehouse14/api"
import {
  QuestCard,
  RankBadge,
  SealGrid,
  StreakFlame,
  useBreakEvenCelebration,
  useGameState,
} from "@/warehouse14/game"
import {
  computeTreasureMap,
  GAUGE_TARGETS,
  monthlyFixedCostCents,
  monthStartDay,
  todayBusinessDay,
} from "@/warehouse14/schatzkammer"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  GoldFlood,
  InlineError,
  RingGauge,
  SectionCard,
  Skeleton,
  StaggerItem,
  StatTile,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

function heuteLabel(now: Date): string {
  return now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
}

function gramm(g: number): string {
  return `${g.toLocaleString("de-DE", { maximumFractionDigits: 1 })} g`
}

const POLL_MS = 30_000

/** A locked "bald verfügbar" StatTile clone for a finance gauge with no data. */
function LockedTile({ label }: { label: string }) {
  const t = useW14Theme()
  return (
    <Card className="gap-2 px-3 py-3" style={{ width: "48%" }}>
      <Text
        className="text-muted-foreground text-xs font-medium uppercase"
        style={{ letterSpacing: 0.4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View className="flex-row items-center gap-1.5 py-1.5">
        <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground text-xs">bald verfügbar</Text>
      </View>
    </Card>
  )
}

/** The first-load skeleton — the board's shape, never a mid-screen spinner. */
function SchatzkammerSkeleton() {
  return (
    <View className="gap-3.5">
      {/* header */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <Skeleton width={24} height={24} radius="button" />
          <View className="gap-1.5">
            <Skeleton width={150} height={18} />
            <Skeleton width={110} height={11} />
          </View>
        </View>
        <Skeleton width={96} height={26} radius="full" />
      </View>
      {/* hero quest */}
      <Card className="gap-3 px-4 py-4">
        <View className="flex-row items-center gap-2.5">
          <Skeleton width={32} height={32} radius="button" />
          <View className="flex-1 gap-2">
            <Skeleton width="55%" height={15} />
            <Skeleton width="80%" height={11} />
          </View>
        </View>
        <Skeleton width="40%" height={22} />
        <Skeleton height={8} radius="full" />
      </Card>
      {/* rank + streak */}
      <Card className="flex-row gap-3 px-4 py-4">
        <View className="flex-1 gap-2">
          <Skeleton width="60%" height={16} />
          <Skeleton width="80%" height={11} />
        </View>
        <View className="flex-1 gap-2">
          <Skeleton width="50%" height={16} />
          <Skeleton width="70%" height={11} />
        </View>
      </Card>
      {/* gauge grid */}
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="gap-2 px-3 py-3" style={{ width: "48%" }}>
            <Skeleton width="55%" height={11} />
            <Skeleton width="70%" height={22} />
            <Skeleton height={8} radius="full" />
          </Card>
        ))}
      </View>
    </View>
  )
}

export default function SchatzkammerScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  // One fan-out over every source. Each settles independently (allSettled inside
  // the hook), so a failed finance read leaves only that gauge locked. Polls every
  // 30s while focused + refetches on focus → the board feels live on open.
  const q = useMultiQuery(
    {
      bridge: bridgeSummary,
      dash: dashboardSummary,
      closings: listClosings,
      profitDay: () => financeProfit("day"),
      profitMonth: () => financeProfit("month"),
      monthRev: financeMonthRevenue,
      invValue: inventoryValue,
      metals: metalWeights,
      fixedCosts: () => listFixedCosts({ activeOnly: true }),
    },
    { key: "schatzkammer", pollIntervalMs: POLL_MS },
  )
  const rc = useRefreshControl(q)

  const bridge = q.results.bridge.data as BridgeSummary | null
  const dash = q.results.dash.data as DashboardSummary | null
  const closings: ClosingListItem[] = q.results.closings.data?.items ?? []
  const profitDay = q.results.profitDay.data as ProfitResponse | null
  const profitMonth = q.results.profitMonth.data as ProfitResponse | null
  const monthRev = q.results.monthRev.data as MonthRevenueResponse | null
  const invValue = q.results.invValue.data as InventoryValueResponse | null
  const metals = q.results.metals.data as MetalWeightsResponse | null
  const fixedCosts = q.results.fixedCosts.data?.items ?? null

  const now = useMemo(() => new Date(), [])
  const biz = todayBusinessDay(now)
  const monthStart = monthStartDay(now)

  // The monthly treasure map needs BOTH the month's profit AND fixed costs to be
  // honest — without both it renders a locked card rather than a half-truth.
  const hasMap = profitMonth !== null && fixedCosts !== null
  const fixedCostCents = fixedCosts ? monthlyFixedCostCents(fixedCosts, monthStart) : 0
  const targetCents = Math.round(GAUGE_TARGETS.monthlyProfitTargetEur * 100)
  const map =
    hasMap && profitMonth
      ? computeTreasureMap(profitMonth.netProfitCents, fixedCostCents, targetCents)
      : null

  // The shared «Spielwirtschaft» — streak · rank · seals · the day's quest — folded
  // from the already-fetched real values. Null inputs are honest (treated as no
  // data), never zero-filled into a fabricated win.
  const game = useGameState({
    todayRevenueCents: bridge ? bridge.todayRevenueCents : null,
    todaySalesCount: bridge ? bridge.todaySalesCount : null,
    todayAnkaufCount: bridge ? bridge.todayAnkaufCount : null,
    pendingAppraisals: dash ? dash.pendingAppraisals : null,
    closings,
    brokeEvenThisMonth: map ? map.brokeEven : false,
    businessDay: biz,
  })

  // Arm the gold flood on the real false→true break-even crossing, once per month.
  // Gated until the map has actually settled, so a transient first-load false never
  // counts as the "before" state. Pairs the bloom's peak with the single Heavy haptic.
  const flood = useBreakEvenCelebration(map ? map.brokeEven : false, monthStart, {
    enabled: map !== null,
  })

  const earnedSeals = game.seals.filter((s) => s.earned).length

  const onRetry = useCallback(() => {
    void q.refetch()
  }, [q])

  // First load: a skeleton in the board's shape, never a mid-screen spinner.
  if (q.isLoading && bridge === null) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 14 }}
      >
        <SchatzkammerSkeleton />
      </ScrollView>
    )
  }

  // Core source down with nothing to show — one honest error card with Retry.
  if (bridge === null) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <InlineError
          message={q.results.bridge.error ?? "Die Schatzkammer konnte nicht geladen werden."}
          onRetry={onRetry}
        />
      </View>
    )
  }

  const revenueEur = bridge.todayRevenueCents / 100
  const profitDayEur = profitDay ? profitDay.netProfitCents / 100 : 0
  const monthRevEur = monthRev ? monthRev.monthToDateRevenueCents / 100 : 0
  const invValueEur = invValue ? invValue.listValueCents / 100 : 0

  // A background source failed while real data is on screen → the one non-blocking
  // banner (not a full takeover). Bridge already handled above; surface the rest.
  const bgError =
    q.results.dash.error ??
    q.results.profitDay.error ??
    q.results.monthRev.error ??
    q.results.invValue.error ??
    q.results.metals.error ??
    null

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 14 }}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* a) Header — title + live rank/streak chips */}
        <StaggerItem index={0}>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-2.5">
              <Vault size={t.icon.xl - 2} color={t.colors.primary} />
              <View className="flex-1">
                <Text className="text-xl font-bold" numberOfLines={1}>
                  Die Schatzkammer
                </Text>
                <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                  Heute · {heuteLabel(now)}
                </Text>
              </View>
            </View>
            <StreakFlame streak={game.streak} size="sm" />
          </View>
        </StaggerItem>

        {bgError ? (
          <StaggerItem index={1}>
            <InlineError message={bgError} onRetry={onRetry} />
          </StaggerItem>
        ) : null}

        {/* b) Hero — today's quest (the deterministic, real-metric daily quest) */}
        <StaggerItem index={2}>
          <View className="gap-1.5">
            <QuestCard quest={game.quest} />
            <View className="flex-row items-center justify-between px-1">
              <Text className="text-muted-foreground text-2xs">Tagesumsatz heute</Text>
              <CountUp
                value={bridge.todayRevenueCents}
                format={formatCents}
                className="font-mono-medium text-sm"
                style={{ color: t.colors.primary }}
                accessibilityLabel={`Tagesumsatz heute ${formatCents(bridge.todayRevenueCents)}`}
              />
            </View>
          </View>
        </StaggerItem>

        {/* c) Rank + streak — the standing, read as one card */}
        <StaggerItem index={3}>
          <Card className="gap-4 px-4 py-4">
            <RankBadge rank={game.rank} />
            <View className="h-px w-full" style={{ backgroundColor: t.colors.border }} />
            <StreakFlame streak={game.streak} />
          </Card>
        </StaggerItem>

        {/* d) Live gauge grid (2×2) — from bridge + dashboard, count-up magnitudes */}
        <StaggerItem index={4}>
          <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
            <CountTile
              label="Tagesumsatz"
              value={bridge.todayRevenueCents}
              format={formatCents}
              ratio={revenueEur / GAUGE_TARGETS.revenueEur}
              hint={`Ziel ${GAUGE_TARGETS.revenueEur} €`}
            />
            <CountTile
              label="Ankäufe heute"
              value={bridge.todayAnkaufCount}
              ratio={bridge.todayAnkaufCount / GAUGE_TARGETS.ankaufCount}
              tone="accent"
              hint={`Ziel ${GAUGE_TARGETS.ankaufCount}`}
            />
            <CountTile
              label="Verkäufe heute"
              value={bridge.todaySalesCount}
              ratio={bridge.todaySalesCount / GAUGE_TARGETS.soldCount}
              hint={`Ziel ${GAUGE_TARGETS.soldCount}`}
            />
            {dash ? (
              <CountTile
                label="Expertisen"
                value={dash.pendingAppraisals}
                ratio={dash.pendingAppraisals / GAUGE_TARGETS.appraisals}
                tone="accent"
                hint={`Ziel ${GAUGE_TARGETS.appraisals}`}
              />
            ) : (
              <LockedTile label="Expertisen" />
            )}
          </View>
        </StaggerItem>

        {/* e) Finance gauges — each tile lights up only when its endpoint is live */}
        <StaggerItem index={5}>
          <SectionCard title="Finanzen" subtitle="Gewinn, Umsatz und Lagerwert — live aus dem System.">
            <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
              {profitDay ? (
                <CountTile
                  label="Gewinn heute"
                  value={profitDay.netProfitCents}
                  format={formatCents}
                  ratio={profitDayEur / GAUGE_TARGETS.netProfitDayEur}
                  tone={profitDay.netProfitCents >= 0 ? "accent" : "muted"}
                  hint={`Ziel ${GAUGE_TARGETS.netProfitDayEur} €`}
                />
              ) : (
                <LockedTile label="Gewinn heute" />
              )}
              {monthRev ? (
                <CountTile
                  label="Monatsumsatz"
                  value={monthRev.monthToDateRevenueCents}
                  format={formatCents}
                  ratio={monthRevEur / GAUGE_TARGETS.monthRevenueEur}
                  hint={`Ziel ${GAUGE_TARGETS.monthRevenueEur} €`}
                />
              ) : (
                <LockedTile label="Monatsumsatz" />
              )}
              {invValue ? (
                <CountTile
                  label="Lagerwert"
                  value={invValue.listValueCents}
                  format={formatCents}
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
                  hint={
                    map.brokeEven ? "Break-even erreicht" : `noch ${formatCents(map.toBreakEvenCents)}`
                  }
                />
              ) : (
                <LockedTile label="Fixkosten gedeckt" />
              )}
            </View>
          </SectionCard>
        </StaggerItem>

        {/* f) Edelmetallbestand — Gold + Silber in grams */}
        <StaggerItem index={6}>
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
                      tone="muted"
                      hint="Bestand"
                    />
                  ) : null}
                  {metals.palladiumGrams > 0 ? (
                    <StatTile
                      label="Palladiumbestand"
                      value={gramm(metals.palladiumGrams)}
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
        </StaggerItem>

        {/* g) Monthly treasure map — cumulative net profit vs fixed costs */}
        <StaggerItem index={7}>
          {map ? (
            <SectionCard
              title="Schatzkarte des Monats"
              subtitle="Erst Kosten decken, dann Gewinn heben."
              icon={MapPin}
              action={
                map.brokeEven ? (
                  <View
                    className="rounded-md px-2.5 py-1"
                    style={{ borderWidth: 1, borderColor: t.colors.verdigris }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: t.colors.verdigris }}>
                      Break-even
                    </Text>
                  </View>
                ) : (
                  <Gem size={t.icon.md} color={t.colors.primary} />
                )
              }
            >
              <View className="gap-1">
                <View className="flex-row items-end justify-between">
                  <CountUp
                    value={map.netProfitCents}
                    format={formatCents}
                    className="font-mono-medium text-2xl"
                    style={{ color: map.brokeEven ? t.colors.verdigris : t.colors.foreground }}
                    accessibilityLabel={`Monatsgewinn ${formatCents(map.netProfitCents)}`}
                  />
                  <Text className="text-muted-foreground text-xs">Ziel {formatCents(targetCents)}</Text>
                </View>

                {/* Progress toward the profit target, with the break-even flag. */}
                <View className="relative w-full py-1.5">
                  <RingGauge
                    value={map.targetProgress}
                    color={map.brokeEven ? t.colors.verdigris : t.colors.primary}
                  />
                  {map.breakEvenMarker !== null ? (
                    <View
                      className="absolute"
                      style={{
                        left: `${Math.round(map.breakEvenMarker * 100)}%`,
                        top: 6,
                        bottom: 6,
                        width: 2,
                        backgroundColor: t.colors.foreground,
                      }}
                    />
                  ) : null}
                </View>

                <View className="flex-row items-center justify-between">
                  <Text className="text-muted-foreground text-2xs">
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
                <Text className="text-muted-foreground text-sm font-semibold" numberOfLines={1}>
                  Schatzkarte des Monats · Kosten decken → Gewinn
                </Text>
                <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
              </View>
              <Text className="text-muted-foreground text-2xs">
                Break-even-Marke erscheint, sobald Monatsgewinn und Fixkosten geladen sind.
              </Text>
            </Card>
          )}
        </StaggerItem>

        {/* h) Siegelwand — earned vs locked, honestly */}
        <StaggerItem index={8}>
          <SectionCard
            title="Siegel der Werkstatt"
            subtitle="Echte Meilensteine — verdient, nie geschenkt."
            action={
              <Text className="text-muted-foreground text-xs">
                {earnedSeals} / {game.seals.length}
              </Text>
            }
          >
            <SealGrid seals={game.seals} />
          </SectionCard>
        </StaggerItem>

        {/* i) Trust line */}
        <StaggerItem index={9}>
          <Text className="text-muted-foreground text-center text-2xs">
            Jeder Wert ist eine echte Zahl aus dem System.
          </Text>
        </StaggerItem>
      </ScrollView>

      {/* Break-even celebration — the gold flood, once per month, on the real
          false→true crossing. Sits above content, never blocks a tap. */}
      <GoldFlood visible={flood.visible} onReachPeak={flood.onReachPeak} onDone={flood.onDone} />
    </View>
  )
}

/**
 * A StatTile whose value count-ups to the live magnitude (DESIGN.md §6 — "let it
 * land", never snap a KPI). The bar fill already springs inside RingGauge; this
 * rolls the displayed figure, kept honest by the caller's de-DE formatter.
 */
function CountTile({
  label,
  value,
  format,
  ratio,
  hint,
  tone = "primary",
}: {
  label: string
  value: number
  format?: (n: number) => string
  ratio: number
  hint?: string
  tone?: "primary" | "accent" | "muted"
}) {
  const t = useW14Theme()
  const toneColor =
    tone === "accent"
      ? t.colors.verdigris
      : tone === "muted"
        ? t.colors.mutedForeground
        : t.colors.primary
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0

  return (
    <Card className="gap-2 px-3 py-3" style={{ width: "48%" }}>
      <Text
        className="text-muted-foreground text-xs font-medium uppercase"
        style={{ letterSpacing: 0.4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <CountUp
        value={value}
        format={format}
        className="font-mono-medium text-2xl"
        style={{ color: toneColor }}
      />
      <RingGauge value={clamped} color={toneColor} caption={hint} />
    </Card>
  )
}
