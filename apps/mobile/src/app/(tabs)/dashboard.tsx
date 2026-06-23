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
  MetalKind,
  MetalRatesResponse,
  MetalWeightsResponse,
  MonthRevenueResponse,
  ProfitResponse,
} from "@warehouse14/api-client"
import { type Href, useRouter } from "expo-router"
import {
  BadgeEuro,
  CalendarClock,
  ChevronRight,
  CloudOff,
  Gavel,
  Gem,
  Hourglass,
  type LucideIcon,
  Lock,
  MapPin,
  Megaphone,
  Radio,
  Receipt,
  ScrollText,
  Search,
  Server,
  ShoppingBag,
  ShoppingCart,
  Trophy,
  UserPlus,
  Vault,
} from "lucide-react-native"

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
  metalRates,
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
  deriveLiveAlerts,
  type LiveAlert,
  type NotificationChannel,
  type NotificationSeverity,
  NotificationBell,
  peakSeverity,
} from "@/warehouse14/notifications"
import { OfflineNotice } from "@/warehouse14/offline"
import { useDashboardTargets } from "@/warehouse14/preferences"
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
  EmptyState,
  GoldFlood,
  haptics,
  InlineError,
  isConnectionError,
  isRateLimited,
  ListRow,
  PaperGrain,
  PressableScale,
  RingGauge,
  SectionCard,
  SectionHeader,
  Skeleton,
  Sparkline,
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

/**
 * The header search action — a calm brass disc that opens the global search
 * (Artikel · Kunden · Belege in one field). Mirrors the NotificationBell's
 * weight so the two header glyphs read as a pair. Spine: press-scale + the §7
 * selection haptic on navigate; tokens only.
 */
function SearchAction() {
  const t = useW14Theme()
  const router = useRouter()
  return (
    <PressableScale
      onPress={() => {
        haptics.selection()
        router.push("/suche" as Href)
      }}
      accessibilityRole="button"
      accessibilityLabel="Suche öffnen"
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: t.colors.primary + "14" }}
      >
        <Search size={t.icon.lg} color={t.colors.primary} />
      </View>
    </PressableScale>
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
            <Skeleton width={170} height={24} />
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
  const router = useRouter()
  const insets = useScreenInsets()
  // The owner's OWN goals (Einstellungen → preferences) — the same store Finanzen
  // reads. These are the only denominators we may honestly label „Ziel"; the rest
  // stay house references („Orientierung"/„Referenz").
  const targets = useDashboardTargets()

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
      rates: metalRates,
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
  const rates = q.results.rates.data as MetalRatesResponse | null
  const fixedCosts = q.results.fixedCosts.data?.items ?? null

  const now = useMemo(() => new Date(), [])
  const biz = todayBusinessDay(now)
  const monthStart = monthStartDay(now)

  // The monthly treasure map needs BOTH the month's profit AND configured fixed
  // costs to be honest. fixedCostsApi.list returns an EMPTY ARRAY (not null) when a
  // shop has no fixed costs configured — so an empty list means "not yet set up",
  // NOT "0 € of fixed costs". Without a real break-even line the card renders the
  // locked "bald" placeholder rather than a contradictory 0 % / "noch 0,00 €".
  const fixedCostCents = fixedCosts ? monthlyFixedCostCents(fixedCosts, monthStart) : 0
  const hasMap = profitMonth !== null && fixedCosts !== null && fixedCostCents > 0
  const profitTargetCents = Math.round(targets.monthlyProfitTargetEur * 100)
  const map =
    hasMap && profitMonth
      ? computeTreasureMap(profitMonth.netProfitCents, fixedCostCents, profitTargetCents)
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

  // Bridge alerts — the SAME pure derivation the Notifications Center's „Jetzt"
  // section uses (live-alerts.ts), folded over the bridge snapshot THIS board
  // already holds. No second fetch; the board's 30s poll keeps both in lockstep,
  // and the thresholds mirror the server's deriveStatus — so the bell, the badge,
  // and this strip can never disagree about what „dringend" means. Honest by
  // construction: an alert exists only because a real field crossed a real
  // threshold; zero crossings → the calm „alles ruhig" line, never an invented row.
  const alerts = useMemo(() => (bridge ? deriveLiveAlerts(bridge, now) : []), [bridge, now])
  const alertPeak = useMemo(() => peakSeverity(alerts), [alerts])

  const earnedSeals = game.seals.filter((s) => s.earned).length

  const onRetry = useCallback(() => {
    void q.refetch()
  }, [q])

  // First load: a skeleton in the board's shape, never a mid-screen spinner.
  if (q.isLoading && bridge === null) {
    return (
      <View className="flex-1 bg-background">
        <PaperGrain />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 14 }}
        >
          <SchatzkammerSkeleton />
        </ScrollView>
      </View>
    )
  }

  // Core source down with nothing to show. A rate-limit or an offline blip is a
  // TRANSIENT wait, not a fault the owner caused — so present it as a calm „gleich
  // wieder da" empty state (no red error), and reserve the destructive InlineError
  // for a genuine server failure. The transport layer already backed the 429 off
  // and honoured Retry-After, so reaching here at all means it stayed busy.
  if (bridge === null) {
    const cause = q.results.bridge.errorCause
    const waiting = isRateLimited(cause) || isConnectionError(cause)
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <PaperGrain />
        {waiting ? (
          <EmptyState
            icon={isRateLimited(cause) ? Hourglass : CloudOff}
            title={isRateLimited(cause) ? "Einen Moment" : "Keine Verbindung"}
            description={
              isRateLimited(cause)
                ? "Gerade sehr viele Anfragen die Schatzkammer lädt gleich von selbst. Du kannst es auch jetzt erneut versuchen."
                : "Die Cloud ist gerade nicht erreichbar. Sobald die Verbindung steht, hier erneut versuchen."
            }
            actionLabel="Erneut versuchen"
            onAction={onRetry}
          />
        ) : (
          <InlineError
            message={q.results.bridge.error ?? "Die Schatzkammer konnte nicht geladen werden."}
            onRetry={onRetry}
          />
        )}
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
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 14 }}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* a) Header title + live rank/streak chips */}
        <StaggerItem index={0}>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-2.5">
              <Vault size={t.icon.xl - 2} color={t.colors.primary} />
              <View className="flex-1">
                {/* The screen's hero title speaks the antique DISPLAY voice —
                    Bricolage Grotesque at the screen-title step (DESIGN-SYSTEM.md §3). */}
                <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
                  Die Schatzkammer
                </Text>
                <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                  Heute · {heuteLabel(now)}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center gap-1.5">
              <StreakFlame streak={game.streak} size="sm" />
              <SearchAction />
              <NotificationBell />
            </View>
          </View>
        </StaggerItem>

        {/* Offline note over the last-good board self-subscribes to the
            connection store and shows ONLY while the cloud is unreachable. The
            gauges below keep their last real values (the data layer holds them on
            a background failure); this is the honest letzter bekannter Stand"
            marker above them, the in-context sibling of the global banner. */}
        <OfflineNotice />

        {bgError ? (
          <StaggerItem index={1}>
            <InlineError message={bgError} onRetry={onRetry} />
          </StaggerItem>
        ) : null}

        {/* a2) Brücken-Alarme the Jetzt"-Schicht: what needs the owner RIGHT NOW
            (a Freigabe waiting, the next Termin, a stuck Hintergrund-Job, the TSE
            Vorlauf). Same derivation + thresholds as the Notifications Center, so
            the two never disagree. Only rendered when something actually crossed a
            threshold silence is honest, not an invented alles ruhig" card. */}
        {alerts.length > 0 ? (
          <StaggerItem index={2}>
            <BridgeAlertsStrip
              alerts={alerts}
              peak={alertPeak}
              onOpen={(alert) => {
                if (alert.href == null) return
                haptics.selection()
                router.push(alert.href as Href)
              }}
            />
          </StaggerItem>
        ) : null}

        {/* a3) Schnellzugriff the owner's most-used money-movement + intake
            actions, one tap from the board. Pure navigation: the fiscal weight
            lives behind each surface's own step-up + confirm, never here. */}
        <StaggerItem index={3}>
          <QuickActions
            onOpen={(route) => {
              haptics.selection()
              router.push(route as Href)
            }}
          />
        </StaggerItem>

        {/* b) Hero today's quest (the deterministic, real-metric daily quest) */}
        <StaggerItem index={4}>
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

        {/* c) Rank + streak the standing, read as one card */}
        <StaggerItem index={5}>
          <Card className="gap-4 px-4 py-4">
            <RankBadge rank={game.rank} />
            <View className="h-px w-full" style={{ backgroundColor: t.colors.border }} />
            <StreakFlame streak={game.streak} />
          </Card>
        </StaggerItem>

        {/* d) Live gauge grid (2×2) from bridge + dashboard, count-up magnitudes */}
        <StaggerItem index={6}>
          <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
            <CountTile
              label="Tagesumsatz"
              value={bridge.todayRevenueCents}
              format={formatCents}
              ratio={revenueEur / targets.revenueEur}
              hint={`Ziel ${targets.revenueEur} €`}
            />
            <CountTile
              label="Ankäufe heute"
              value={bridge.todayAnkaufCount}
              ratio={bridge.todayAnkaufCount / GAUGE_TARGETS.ankaufCount}
              tone="accent"
              hint={`Orientierung ${GAUGE_TARGETS.ankaufCount}`}
            />
            <CountTile
              label="Verkäufe heute"
              value={bridge.todaySalesCount}
              ratio={bridge.todaySalesCount / GAUGE_TARGETS.soldCount}
              hint={`Orientierung ${GAUGE_TARGETS.soldCount}`}
            />
            {dash ? (
              <CountTile
                label="Expertisen"
                value={dash.pendingAppraisals}
                ratio={dash.pendingAppraisals / GAUGE_TARGETS.appraisals}
                tone="accent"
                hint={`Orientierung ${GAUGE_TARGETS.appraisals}`}
              />
            ) : (
              <LockedTile label="Expertisen" />
            )}
          </View>
        </StaggerItem>

        {/* e) Finance gauges each tile lights up only when its endpoint is live.
            Un-boxed: SectionHeader on the canvas, tiles directly below (one border
            layer, not SectionCard>Card>tile = box-in-box). */}
        <StaggerItem index={7}>
          <SectionHeader title="Finanzen" subtitle="Gewinn, Umsatz und Lagerwert live aus dem System." />
          <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
              {profitDay ? (
                <CountTile
                  label="Gewinn heute"
                  value={profitDay.netProfitCents}
                  format={formatCents}
                  ratio={profitDayEur / targets.netProfitDayEur}
                  tone={profitDay.netProfitCents >= 0 ? "accent" : "muted"}
                  hint={`Ziel ${targets.netProfitDayEur} €`}
                />
              ) : (
                <LockedTile label="Gewinn heute" />
              )}
              {monthRev ? (
                <CountTile
                  label="Monatsumsatz"
                  value={monthRev.monthToDateRevenueCents}
                  format={formatCents}
                  ratio={monthRevEur / targets.monthRevenueEur}
                  hint={`Ziel ${targets.monthRevenueEur} €`}
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
        </StaggerItem>

        {/* f) Edelmetallbestand Gold + Silber in grams. Un-boxed (SectionHeader
            on canvas, tiles directly below). */}
        <StaggerItem index={8}>
          <SectionHeader title="Edelmetallbestand" subtitle="Gewichte aus dem Lager, in Gramm." />
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
        </StaggerItem>

        {/* f2) Edelmetall-Kurse the spot vs the time-weighted 10-day average per
            gram, straight from /api/metal-prices/rates. The trend has exactly the
            two REAL points the endpoint gives (avg10d → spot), so the sparkline is
            an honest two-point silhouette, not an invented curve. A metal with no
            readable rate is simply skipped; an unreadable response shows the locked
            placeholder never a fabricated price. */}
        <StaggerItem index={9}>
          <SectionCard
            title="Edelmetall-Kurse"
            subtitle="Spot gegen den 10-Tage-Schnitt, je Gramm live aus dem System."
            icon={Gem}
          >
            <MetalRatesStrip rates={rates} />
          </SectionCard>
        </StaggerItem>

        {/* g) Monthly treasure map cumulative net profit vs fixed costs */}
        <StaggerItem index={10}>
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
                  <Text className="text-muted-foreground text-xs">
                    {map.brokeEven
                      ? `Ziel ${formatCents(profitTargetCents)}`
                      : `Fixkosten ${formatCents(map.fixedCostCents)}`}
                  </Text>
                </View>

                {/* Before break-even the bar fills with fixed-cost coverage (gross
                    margin / fixed → 100 % exactly when netProfit hits 0); once in
                    the black it tracks the owner's OWN profit goal. Both are real. */}
                <View className="w-full py-1.5">
                  <RingGauge
                    value={map.brokeEven ? map.targetProgress : map.coverage}
                    color={map.brokeEven ? t.colors.verdigris : t.colors.primary}
                  />
                </View>

                <View className="flex-row items-center justify-between">
                  <Text className="text-muted-foreground text-2xs">
                    {map.brokeEven
                      ? "Fixkosten gedeckt der Monat ist im Plus"
                      : `Fixkosten zu ${Math.round(map.coverage * 100)} % gedeckt`}
                  </Text>
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: map.brokeEven ? t.colors.verdigris : t.colors.primary }}
                  >
                    {map.brokeEven
                      ? "Break-even erreicht"
                      : `noch ${formatCents(map.toBreakEvenCents)}`}
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

        {/* h) Siegelwand earned vs locked, honestly */}
        <StaggerItem index={11}>
          <SectionCard
            title="Siegel der Werkstatt"
            subtitle="Echte Meilensteine verdient, nie geschenkt."
            action={
              <Text className="text-muted-foreground text-xs">
                {earnedSeals} / {game.seals.length}
              </Text>
            }
          >
            <SealGrid seals={game.seals} />
            <View style={{ marginTop: 4 }}>
              <ListRow
                icon={Trophy}
                title="Erfolge ansehen"
                subtitle="Aufstieg, Serien-Historie und Meilensteine im Detail."
                onPress={() => {
                  haptics.selection()
                  router.push("/erfolge" as Href)
                }}
              />
            </View>
          </SectionCard>
        </StaggerItem>

        {/* i) Trust line */}
        <StaggerItem index={12}>
          <Text className="text-muted-foreground text-center text-2xs">
            Jeder Wert ist eine echte Zahl aus dem System.
          </Text>
        </StaggerItem>
      </ScrollView>

      {/* Break-even celebration the gold flood, once per month, on the real
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

// ── Brücken-Alarme (the dashboard „Jetzt"-Schicht) ───────────────────────────
/**
 * The channel → glyph + severity → token maps, kept local to the board (the
 * Notifications Center owns its own copies; sharing a presentation map across
 * features would couple them). Same vocabulary, so the two surfaces read alike.
 */
const ALERT_CHANNEL_ICON: Record<NotificationChannel, LucideIcon> = {
  approvals: Gavel,
  appointments: CalendarClock,
  fiscal: ScrollText,
  system: Server,
  sales: BadgeEuro,
  compliance: ScrollText,
  channels: Megaphone,
}

function alertSeverityColor(
  severity: NotificationSeverity,
  t: ReturnType<typeof useW14Theme>,
): string {
  switch (severity) {
    case "critical":
      return t.colors.destructive
    case "action":
      return t.colors.primary
    case "info":
      return t.colors.verdigris
  }
}

/** One compact live-alert row — severity rail, channel disc, count chip, chevron. */
function BridgeAlertRow({ alert, onPress }: { alert: LiveAlert; onPress: () => void }) {
  const t = useW14Theme()
  const accent = alertSeverityColor(alert.severity, t)
  const Icon = ALERT_CHANNEL_ICON[alert.channel]
  const tappable = alert.href != null
  const a11y = `${alert.title}. ${alert.body}.${tappable && alert.hrefLabel ? ` ${alert.hrefLabel}.` : ""}`

  const body = (
    <View className="flex-row items-center gap-3 py-0.5">
      <View
        className="h-9 w-9 items-center justify-center rounded-md"
        style={{ backgroundColor: accent + "1f" }}
      >
        <Icon size={t.icon.md} color={accent} />
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {alert.title}
          </Text>
          {alert.count != null ? (
            <View
              className="min-w-[20px] items-center justify-center rounded-full px-1.5"
              style={{ height: 18, backgroundColor: accent }}
            >
              <Text
                className="text-2xs font-bold"
                style={{ color: t.colors.primaryForeground }}
                numberOfLines={1}
              >
                {alert.count > 99 ? "99+" : alert.count}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-muted-foreground text-sm" numberOfLines={2}>
          {alert.body}
        </Text>
      </View>
      {tappable ? <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} /> : null}
    </View>
  )

  return (
    <View className="flex-row overflow-hidden rounded-md">
      <View style={{ width: 3, borderRadius: 2, backgroundColor: accent }} />
      <View className="flex-1 pl-3">
        {tappable ? (
          <PressableScale accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress}>
            {body}
          </PressableScale>
        ) : (
          <View accessibilityRole="text" accessibilityLabel={a11y}>
            {body}
          </View>
        )}
      </View>
    </View>
  )
}

/**
 * The dashboard's „Jetzt"-strip — the live owner alerts the board surfaces from
 * the bridge snapshot it already holds. Same `deriveLiveAlerts` + thresholds as
 * the Notifications Center, so the two can never disagree. The caller only
 * renders this when `alerts` is non-empty, so there is no fabricated „all calm"
 * row here — silence on the board IS the calm state.
 */
function BridgeAlertsStrip({
  alerts,
  peak,
  onOpen,
}: {
  alerts: readonly LiveAlert[]
  peak: NotificationSeverity | null
  onOpen: (alert: LiveAlert) => void
}) {
  const t = useW14Theme()
  const peakColor = peak ? alertSeverityColor(peak, t) : t.colors.verdigris
  return (
    <SectionCard
      title="Jetzt"
      subtitle="Was gerade deine Aufmerksamkeit braucht live aus dem System."
      icon={Radio}
      action={
        // Fixed-size circular badge — self-center so the parent's flex never
        // stretches it vertically. Fixed height + aspect ratio guarantees a
        // perfect circle regardless of the parent's align-items.
        <View
          className="flex-row items-center justify-center self-center rounded-full"
          style={{
            backgroundColor: peakColor + "1f",
            minWidth: 28,
            height: 28,
            paddingHorizontal: 8,
          }}
        >
          <Text className="text-2xs font-bold" style={{ color: peakColor }}>
            {alerts.length}
          </Text>
        </View>
      }
    >
      {alerts.map((alert) => (
        <BridgeAlertRow key={alert.kind} alert={alert} onPress={() => onOpen(alert)} />
      ))}
    </SectionCard>
  )
}

// ── Schnellzugriff (quick-actions) ───────────────────────────────────────────
/**
 * The owner's most-used jumps, one tap from the board. Pure navigation — the
 * fiscal weight (TSE/§25a, step-up + confirm) lives entirely behind each target
 * surface, never fired from here. A 2×2 grid of tap targets ≥ 44 px, each a soft
 * brass disc + label, pressed with the spine's one feedback.
 */
const QUICK_ACTIONS: readonly { id: string; route: string; label: string; icon: LucideIcon }[] = [
  { id: "verkauf", route: "/verkauf", label: "Verkauf", icon: ShoppingCart },
  { id: "ankauf", route: "/ankauf", label: "Ankauf", icon: ShoppingBag },
  { id: "kasse", route: "/kasse", label: "Kasse & Z-Bon", icon: Receipt },
  { id: "kunde-neu", route: "/customer/neu", label: "Neuer Kunde", icon: UserPlus },
]

function QuickActions({ onOpen }: { onOpen: (route: string) => void }) {
  const t = useW14Theme()
  return (
    <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
      {QUICK_ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <PressableScale
            key={a.id}
            onPress={() => onOpen(a.route)}
            accessibilityRole="button"
            accessibilityLabel={`${a.label} öffnen`}
            style={{ width: "48%" }}
          >
            <Card className="min-h-[44px] flex-row items-center gap-3 px-3 py-3">
              {/* Bare icon no tinted chip (the chip was offset/clipped on some
                  devices). Ink glyph, calm, matches ListRow + SectionCard. */}
              <Icon size={t.icon.md} color={t.colors.foreground} />
              <Text className="flex-1 text-sm font-semibold" numberOfLines={1}>
                {a.label}
              </Text>
            </Card>
          </PressableScale>
        )
      })}
    </View>
  )
}

// ── Edelmetall-Kurse (spot vs 10-day average) ────────────────────────────────
/** German metal labels, local to the board (no cross-feature import). */
const METAL_LABEL_DE: Record<MetalKind, string> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

/** Format a €/g decimal string as de-DE „12,3456 €/g" (4 dp matches the wire). */
function pricePerGram(decimal: string): string {
  const n = Number(decimal)
  if (!Number.isFinite(n)) return "—"
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/g`
}

/** Signed de-DE percent delta of `current` vs `avg`, e.g. „+1,4 %" — or null. */
function pctDelta(avg: number, current: number): string | null {
  if (!Number.isFinite(avg) || !Number.isFinite(current) || avg <= 0) return null
  const pct = ((current - avg) / avg) * 100
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : ""
  return `${sign}${Math.abs(pct).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`
}

/**
 * One metal's rate row: the spot per gram, an honest two-point sparkline of the
 * time-weighted 10-day average → the current spot, and the signed de-DE delta.
 * Both points are REAL numbers from /api/metal-prices/rates — the sparkline is a
 * true two-point silhouette, never an invented curve. A metal whose spot or
 * average is unreadable is skipped by the caller, so this only ever renders a
 * fully-known row.
 */
function MetalRateRow({
  label,
  avg,
  current,
}: {
  label: string
  avg: string
  current: string
}) {
  const t = useW14Theme()
  const avgN = Number(avg)
  const curN = Number(current)
  const delta = pctDelta(avgN, curN)
  return (
    <View className="gap-1.5 py-1">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-semibold">{label}</Text>
        <Text className="font-mono-medium text-base" style={{ color: t.colors.foreground }}>
          {pricePerGram(current)}
        </Text>
      </View>
      <Sparkline
        data={[avgN, curN]}
        height={24}
        delta={delta ?? undefined}
        accessibilityLabel={`${label}: 10-Tage-Schnitt ${pricePerGram(avg)}, aktuell ${pricePerGram(current)}`}
      />
      <Text className="text-muted-foreground text-2xs">
        10-Tage-Schnitt {pricePerGram(avg)}
      </Text>
    </View>
  )
}

function MetalRatesStrip({ rates }: { rates: MetalRatesResponse | null }) {
  const t = useW14Theme()
  // Only rows where BOTH the spot AND the 10-day average are readable — those are
  // the only ones we can draw an honest avg→spot trend for. Everything else is
  // simply absent (no fabricated price, no flat zero baseline).
  const rows = useMemo(
    () =>
      (rates?.rates ?? []).filter(
        (r) => r.currentPricePerGramEur != null && r.avg10dPricePerGramEur != null,
      ),
    [rates],
  )

  if (rates == null) {
    // The rates endpoint isn't readable → the locked placeholder, never a price.
    return (
      <View className="flex-row items-center gap-1.5 py-1">
        <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground text-sm" style={{ flexShrink: 1 }}>
          bald verfügbar Kurse werden geladen.
        </Text>
      </View>
    )
  }

  if (rows.length === 0) {
    // The endpoint answered but no metal has both a spot and a 10-day average yet.
    return (
      <Text className="text-muted-foreground text-sm">
        Noch keine Kurse mit Vergleichswert sobald genug Verlauf vorliegt, erscheint der Trend hier.
      </Text>
    )
  }

  return (
    <View className="gap-1">
      {rows.map((r, i) => (
        <View key={r.metal}>
          {i > 0 ? (
            <View className="h-px w-full" style={{ backgroundColor: t.colors.border, marginVertical: 4 }} />
          ) : null}
          <MetalRateRow
            label={METAL_LABEL_DE[r.metal]}
            avg={r.avg10dPricePerGramEur as string}
            current={r.currentPricePerGramEur as string}
          />
        </View>
      ))}
    </View>
  )
}
