/**
 * Die Schatzkammer — the owner productivity dashboard (Owner OS), the showpiece
 * surface. A calm, ledger-on-parchment command center where EVERY number is a
 * real value from a real endpoint. No fabrication: a row lights up ONLY when its
 * own endpoint returns real data; anything missing falls to a quiet locked
 * „bald" line, never a fake number (DESIGN.md §4 — the honesty rule).
 *
 * Composition (DESIGN-SYSTEM.md §1, §9 — kill boxes-in-boxes): depth comes from
 * the layered parchment + a single warm hairline, never stacked bordered tiles.
 * Each KPI is a BARE ledger row (eyebrow label · mono value · thin honest bar),
 * grouped under one un-carded SectionHeader and divided by Hairlines. Generous
 * whitespace, real hierarchy, intentional rhythm — a museum label, not a poster.
 *
 * Live via the shared data layer: one `useMultiQuery` fans out over every source
 * with `Promise.allSettled` semantics (a failed finance read never blanks the
 * board), refetch-on-focus, polite 30s polling, and pull-to-refresh through
 * `useRefreshControl` — so the board feels live the moment you open the tab.
 *
 * Sources (each settled independently):
 *   • bridgeApi.summary       — Tagesumsatz, Ankäufe heute, Verkäufe heute (core).
 *   • dashboard.summary       — Expertisen (pendingAppraisals).
 *   • closingsApi.list        — the streak + the „Schlage gestern" anchor quest.
 *   • financeApi.profit(day)  — Gewinn heute (netProfit, period=day).
 *   • financeApi.profit(month)+ fixedCostsApi.list — the monthly treasure map
 *     (cumulative net profit vs the month's fixed costs → break-even crossing).
 *   • financeApi.monthRevenue — Monatsumsatz.
 *   • financeApi.inventoryValue — Lagerwert (Listenwert).
 *   • financeApi.metalWeights — Gold-/Silberbestand (Gramm).
 *   • financeApi.metalRates   — Edelmetall-Kurse (Spot gegen 10-Tage-Schnitt).
 *
 * Gamification (the shared «Spielwirtschaft»): `useGameState` folds the already
 * fetched real values into the streak · rank · seals · daily quest; the day's
 * quest is the hero, the rank + streak read as one calm group, and the seal wall
 * shows earned-vs-locked honestly. The monthly break-even crossing arms
 * <GoldFlood> exactly once via `useBreakEvenCelebration`, paired with the single
 * Heavy haptic.
 *
 * Built entirely on the shared spine — motion (CountUp, Stagger, GoldFlood),
 * components (SectionHeader/Hairline/RingGauge/Skeleton/InlineError), the bespoke
 * MetalIcons, the live-data hooks, haptics, and the game module. Tokens only;
 * de-DE money/dates; German UI.
 */
import { type ReactNode, useCallback, useMemo } from "react"
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
  ArrowUp,
  BadgeEuro,
  CalendarClock,
  ChevronRight,
  CloudOff,
  Gavel,
  Hourglass,
  type LucideIcon,
  Lock,
  Megaphone,
  Radio,
  Receipt,
  ScrollText,
  Search,
  Server,
  Gauge,
  ShoppingBag,
  Trophy,
  UserPlus,
  Vault,
} from "lucide-react-native"
import Svg, { Path } from "react-native-svg"

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
  Hairline,
  haptics,
  InlineError,
  isConnectionError,
  isRateLimited,
  ListRow,
  MetalIcon,
  PaperGrain,
  PressableScale,
  SectionHeader,
  Skeleton,
  StaggerItem,
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

/**
 * The house seal — a small gilt diamond ◆. The ONE sanctioned decorative use of
 * gilt (DESIGN-SYSTEM.md §1, §6: a thread / an edge / a seal). It opens the
 * Kicker line and never sits behind text.
 */
function Diamond({ size = 8, color }: { size?: number; color: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Path d="M5 0 L10 5 L5 10 L0 5 Z" fill={color} />
    </Svg>
  )
}

/**
 * The Kicker — a gilt diamond + a small-caps tracked eyebrow. Every region opens
 * with one (DESIGN-SYSTEM.md §6). Sits directly on the canvas, no box.
 */
function Kicker({ label }: { label: string }): ReactNode {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center gap-2">
      <Diamond color={t.colors.gilt} />
      <Text
        className="text-muted-foreground text-2xs font-semibold uppercase"
        style={{ letterSpacing: 1.4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
}

/**
 * One KPI ledger row — the de-boxed unit (DESIGN-SYSTEM.md §9). A bare line:
 * a tracked eyebrow label + an optional leading glyph on the left, the mono
 * value count-up on the right, and a single thin honest progress bar beneath.
 * No card, no border — rows are separated by the parent's Hairlines alone, so
 * a column of metrics reads as one ledger, never a wall of tiles.
 *
 * `ratio` lights the bar: verdigris at/over the mark, gilt as it nears, ink
 * while it builds (functional colour carries meaning only). The value rolls,
 * never snaps (CountUp). A row is only ever rendered with real data; the locked
 * fallback is its own quiet line below.
 */
function LedgerRow({
  label,
  value,
  format,
  ratio,
  hint,
  glyph,
}: {
  label: string
  value: number
  format?: (n: number) => string
  ratio?: number
  hint?: string
  glyph?: ReactNode
}): ReactNode {
  const t = useW14Theme()
  const hasBar = ratio != null && Number.isFinite(ratio)
  const clamped = hasBar ? Math.max(0, Math.min(1, ratio as number)) : 0
  // Functional tone only: met → verdigris (alive), nearing → gilt (seal), else
  // quiet ink. Never decoration.
  const barColor =
    clamped >= 1 ? t.colors.verdigris : clamped >= 0.7 ? t.colors.gilt : t.colors.foreground

  return (
    <View className="gap-2 py-2.5">
      <View className="flex-row items-end justify-between gap-3">
        <View className="flex-1 flex-row items-center gap-2">
          {glyph != null ? glyph : null}
          <Text
            className="text-muted-foreground text-2xs font-semibold uppercase"
            style={{ letterSpacing: 1 }}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
        <CountUp
          value={value}
          format={format}
          className="font-mono-medium text-xl"
          style={{ color: t.colors.foreground }}
        />
      </View>
      {hasBar ? (
        <View className="gap-1">
          <View
            className="w-full overflow-hidden rounded-full"
            style={{ height: 4, backgroundColor: t.colors.border }}
            accessibilityRole="progressbar"
            accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
          >
            <View
              style={{ height: "100%", width: `${clamped * 100}%`, backgroundColor: barColor }}
            />
          </View>
          {hint != null ? (
            <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>
      ) : hint != null ? (
        <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

/** A locked ledger line — a quiet „bald verfügbar", never a fabricated value. */
function LockedRow({ label }: { label: string }): ReactNode {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center justify-between gap-3 py-2.5">
      <Text
        className="text-muted-foreground text-2xs font-semibold uppercase"
        style={{ letterSpacing: 1 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View className="flex-row items-center gap-1.5">
        <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground text-xs">bald verfügbar</Text>
      </View>
    </View>
  )
}

/**
 * A run of ledger rows under one SectionHeader, divided by a single Hairline —
 * the de-boxed group. The whole region sits on the parchment canvas with NO
 * outer card; depth is the layered ground + the rule, never a border box
 * (DESIGN-SYSTEM.md §1, §5, §9).
 */
function Ledger({ children }: { children: ReactNode }): ReactNode {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children]
  return (
    <View>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <Hairline /> : null}
          {child}
        </View>
      ))}
    </View>
  )
}

/**
 * The header search action — a calm raised disc that opens the global search
 * (Artikel · Kunden · Belege in one field). Mirrors the NotificationBell's
 * weight so the two header glyphs read as a pair. Spine: press-scale + the §7
 * selection haptic on navigate; tokens only.
 */
function SearchAction(): ReactNode {
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
        style={{ backgroundColor: t.colors.raised }}
      >
        <Search size={t.icon.lg} color={t.colors.primary} />
      </View>
    </PressableScale>
  )
}

/** The first-load skeleton — the board's de-boxed shape, never a mid-screen spinner. */
function SchatzkammerSkeleton(): ReactNode {
  return (
    <View className="gap-7">
      {/* header */}
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-3">
          <Skeleton width={26} height={26} radius="button" />
          <View className="gap-2">
            <Skeleton width={180} height={26} />
            <Skeleton width={120} height={11} />
          </View>
        </View>
        <Skeleton width={96} height={26} radius="full" />
      </View>
      {/* hero quest — the one raised leaf kept */}
      <View className="gap-3">
        <View className="flex-row items-center gap-3">
          <Skeleton width={32} height={32} radius="button" />
          <View className="flex-1 gap-2">
            <Skeleton width="55%" height={15} />
            <Skeleton width="80%" height={11} />
          </View>
        </View>
        <Skeleton width="40%" height={22} />
        <Skeleton height={8} radius="full" />
      </View>
      {/* ledger run */}
      <View className="gap-5">
        <Skeleton width={130} height={18} />
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="gap-2">
            <View className="flex-row items-center justify-between">
              <Skeleton width="40%" height={11} />
              <Skeleton width="28%" height={20} />
            </View>
            <Skeleton height={4} radius="full" />
          </View>
        ))}
      </View>
    </View>
  )
}

export default function SchatzkammerScreen(): ReactNode {
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

  // Re-stamp on every successful fetch (q.updatedAt) so a long-lived board does
  // not freeze its „today": across midnight/month the business day, month start,
  // date label and alert phrasing advance on the next poll instead of going stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [q.updatedAt])
  const biz = todayBusinessDay(now)
  const monthStart = monthStartDay(now)

  // The monthly treasure map needs BOTH the month's profit AND configured fixed
  // costs to be honest. fixedCostsApi.list returns an EMPTY ARRAY (not null) when a
  // shop has no fixed costs configured — so an empty list means „not yet set up",
  // NOT „0 € of fixed costs". Without a real break-even line the row renders the
  // locked „bald" placeholder rather than a contradictory 0 % / „noch 0,00 €".
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
  // counts as the „before" state. Pairs the bloom's peak with the single Heavy haptic.
  const flood = useBreakEvenCelebration(map ? map.brokeEven : false, monthStart, {
    enabled: map !== null,
  })

  // Bridge alerts — the SAME pure derivation the Notifications Center's „Jetzt"
  // section uses (live-alerts.ts), folded over the bridge snapshot THIS board
  // already holds. No second fetch; the board's 30s poll keeps both in lockstep,
  // and the thresholds mirror the server's deriveStatus — so the bell, the badge,
  // and this strip can never disagree about what „dringend" means. Honest by
  // construction: an alert exists only because a real field crossed a real
  // threshold; zero crossings → no strip at all, never an invented row.
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
          contentContainerStyle={{ padding: 20, paddingBottom: insets.contentBottom, gap: 28 }}
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
      <View className="flex-1 justify-center bg-background px-5">
        <PaperGrain />
        {waiting ? (
          <EmptyState
            icon={isRateLimited(cause) ? Hourglass : CloudOff}
            title={isRateLimited(cause) ? "Einen Moment" : "Keine Verbindung"}
            description={
              isRateLimited(cause)
                ? "Gerade sehr viele Anfragen. Die Schatzkammer lädt gleich von selbst. Du kannst es auch jetzt erneut versuchen."
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

  // The overall goal achievement — the honest average of only the live ratios we
  // actually have (never zero-filled). Used by the closing „Zielerreichung" line.
  const overallRatios = [
    profitDay ? profitDayEur / targets.netProfitDayEur : null,
    monthRev ? monthRevEur / targets.monthRevenueEur : null,
    invValue ? invValueEur / GAUGE_TARGETS.inventoryValueEur : null,
    map ? map.coverage : null,
    metals ? metals.goldGrams / GAUGE_TARGETS.goldGrams : null,
    metals ? metals.silverGrams / GAUGE_TARGETS.silverGrams : null,
    // Source presence already gates each ratio to null when absent, so a kept
    // value of exactly 0 is a REAL measurement (0 € profit, 0 g metal) — drop the
    // `> 0` that silently biased the Gesamtübersicht upward.
  ].filter((r): r is number => r != null && Number.isFinite(r))
  const overallPct =
    overallRatios.length > 0
      ? overallRatios.reduce((sum, r) => sum + r, 0) / overallRatios.length
      : 0
  const overallClamped = Math.max(0, Math.min(1, overallPct))

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.contentBottom, gap: 28 }}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* a) Header — the Kicker, the display hero title, the live chips */}
        <StaggerItem index={0}>
          <View className="gap-2.5">
            <View className="flex-row items-center justify-between">
              <Kicker label="Schatzkammer" />
              <View className="flex-row items-center gap-1.5">
                <StreakFlame streak={game.streak} size="sm" />
                <SearchAction />
                <NotificationBell />
              </View>
            </View>
            <View className="flex-row items-center gap-3">
              <Vault size={t.icon.xl} color={t.colors.primary} />
              <View className="flex-1">
                {/* The screen's hero title speaks the antique DISPLAY voice —
                    Bricolage Grotesque at the screen-title step (DESIGN-SYSTEM.md §3). */}
                <Text className="text-3xl font-display-bold leading-tight" numberOfLines={1}>
                  Die Schatzkammer
                </Text>
                <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                  Heute · {heuteLabel(now)}
                </Text>
              </View>
            </View>
          </View>
        </StaggerItem>

        {/* Offline note over the last-good board self-subscribes to the
            connection store and shows ONLY while the cloud is unreachable. The
            ledger below keeps its last real values (the data layer holds them on
            a background failure); this is the honest „letzter bekannter Stand"
            marker above them, the in-context sibling of the global banner. */}
        <OfflineNotice />

        {bgError ? (
          <StaggerItem index={1}>
            <InlineError message={bgError} onRetry={onRetry} />
          </StaggerItem>
        ) : null}

        {/* a2) Brücken-Alarme — the „Jetzt"-Schicht: what needs the owner RIGHT
            NOW (a Freigabe waiting, the next Termin, a stuck Hintergrund-Job, the
            TSE Vorlauf). Same derivation + thresholds as the Notifications Center,
            so the two never disagree. Only rendered when something actually
            crossed a threshold — silence is honest, not an invented „alles ruhig"
            card. De-boxed: a Kicker over bare alert rows, no outer panel. */}
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

        {/* b) Hero — today's quest (the deterministic, real-metric daily quest).
            The ONE raised leaf the board keeps: the hero earns the card weight. */}
        <StaggerItem index={3}>
          <View className="gap-2">
            <QuestCard quest={game.quest} />
            <View className="flex-row items-center justify-between px-1">
              <Text
                className="text-muted-foreground text-2xs font-semibold uppercase"
                style={{ letterSpacing: 1 }}
              >
                Tagesumsatz heute
              </Text>
              <CountUp
                value={bridge.todayRevenueCents}
                format={formatCents}
                className="font-mono-medium text-sm"
                style={{ color: t.colors.foreground }}
                accessibilityLabel={`Tagesumsatz heute ${formatCents(bridge.todayRevenueCents)}`}
              />
            </View>
          </View>
        </StaggerItem>

        {/* a3) Schnellzugriff — the owner's most-used money-movement + intake
            actions, one tap from the board. De-boxed: bare icon rows under a
            Kicker, divided by Hairlines — no grid of bordered cards. Pure
            navigation: the fiscal weight lives behind each surface's own
            step-up + confirm, never here. */}
        <StaggerItem index={4}>
          <View className="gap-3">
            <Kicker label="Schnellzugriff" />
            <Ledger>
              {QUICK_ACTIONS.map((a) => (
                <ListRow
                  key={a.id}
                  icon={a.icon}
                  title={a.label}
                  onPress={() => {
                    haptics.selection()
                    router.push(a.route as Href)
                  }}
                />
              ))}
            </Ledger>
          </View>
        </StaggerItem>

        {/* c) Standing — rank + streak read as one calm group (no nested box;
            a single Hairline divides the two readings). */}
        <StaggerItem index={5}>
          <View className="gap-4">
            <SectionHeader title="Dein Stand" subtitle="Rang und Serie aus echten Tagesabschlüssen." />
            <RankBadge rank={game.rank} />
            <Hairline />
            <StreakFlame streak={game.streak} />
          </View>
        </StaggerItem>

        {/* d) Heute — the live day ledger from bridge + dashboard. Bare rows,
            count-up magnitudes, one honest bar each, divided by Hairlines. */}
        <StaggerItem index={6}>
          <View className="gap-4">
            <SectionHeader title="Heute" subtitle="Umsatz, Ankäufe und Verkäufe live aus dem System." />
            <Ledger>
              <LedgerRow
                label="Tagesumsatz"
                value={bridge.todayRevenueCents}
                format={formatCents}
                ratio={revenueEur / targets.revenueEur}
                hint={`Ziel ${targets.revenueEur} €`}
              />
              <LedgerRow
                label="Ankäufe heute"
                value={bridge.todayAnkaufCount}
                ratio={bridge.todayAnkaufCount / GAUGE_TARGETS.ankaufCount}
                hint={`Orientierung ${GAUGE_TARGETS.ankaufCount}`}
              />
              <LedgerRow
                label="Verkäufe heute"
                value={bridge.todaySalesCount}
                ratio={bridge.todaySalesCount / GAUGE_TARGETS.soldCount}
                hint={`Orientierung ${GAUGE_TARGETS.soldCount}`}
              />
              {dash ? (
                <LedgerRow
                  label="Expertisen"
                  value={dash.pendingAppraisals}
                  ratio={dash.pendingAppraisals / GAUGE_TARGETS.appraisals}
                  hint={`Orientierung ${GAUGE_TARGETS.appraisals}`}
                />
              ) : (
                <LockedRow label="Expertisen" />
              )}
            </Ledger>
          </View>
        </StaggerItem>

        {/* e) Finanzen — the money ledger: real profit, revenue, inventory value,
            and the month's fixed-cost coverage. Bare rows, no panels. */}
        <StaggerItem index={7}>
          <View className="gap-4">
            <SectionHeader title="Finanzen" subtitle="Gewinn, Umsatz und Lagerwert live aus dem System." />
            <Ledger>
              {profitDay ? (
                <LedgerRow
                  label="Gewinn heute"
                  value={profitDay.netProfitCents}
                  format={formatCents}
                  ratio={profitDayEur / targets.netProfitDayEur}
                  hint={`Ziel ${targets.netProfitDayEur} €`}
                />
              ) : (
                <LockedRow label="Gewinn heute" />
              )}
              {monthRev ? (
                <LedgerRow
                  label="Monatsumsatz"
                  value={monthRev.monthToDateRevenueCents}
                  format={formatCents}
                  ratio={monthRevEur / targets.monthRevenueEur}
                  hint={`Ziel ${targets.monthRevenueEur} €`}
                />
              ) : (
                <LockedRow label="Monatsumsatz" />
              )}
              {invValue ? (
                <LedgerRow
                  label="Lagerwert"
                  value={invValue.listValueCents}
                  format={formatCents}
                  ratio={invValueEur / GAUGE_TARGETS.inventoryValueEur}
                  hint={`Orientierung ${GAUGE_TARGETS.inventoryValueEur} €`}
                />
              ) : (
                <LockedRow label="Lagerwert" />
              )}
              {map ? (
                <LedgerRow
                  label="Fixkosten gedeckt"
                  value={map.coverage * 100}
                  format={(v: number) => `${Math.round(v)} %`}
                  ratio={map.coverage}
                  hint={
                    map.brokeEven
                      ? "Diesen Monat gedeckt"
                      : `Noch ${formatCents(map.toBreakEvenCents)} bis zur Deckung`
                  }
                />
              ) : (
                <LockedRow label="Fixkosten gedeckt" />
              )}
            </Ledger>
          </View>
        </StaggerItem>

        {/* f) Edelmetallbestand — real weights in grams, each opened by its
            bespoke MetalIcon glyph (DESIGN-SYSTEM.md §6 — the engraved domain
            mark adds clarity). Bare rows, gilt only on the gold mark. */}
        <StaggerItem index={8}>
          <View className="gap-4">
            <SectionHeader title="Edelmetallbestand" subtitle="Gewichte aus dem Lager, in Gramm." />
            <Ledger>
              {metals ? (
                [
                  <LedgerRow
                    key="gold"
                    label="Goldbestand"
                    value={metals.goldGrams}
                    format={gramm}
                    ratio={metals.goldGrams / GAUGE_TARGETS.goldGrams}
                    hint={`Orientierung ${GAUGE_TARGETS.goldGrams} g`}
                    glyph={<MetalIcon metal="GOLD" size={t.icon.md} color={t.colors.gilt} />}
                  />,
                  <LedgerRow
                    key="silber"
                    label="Silberbestand"
                    value={metals.silverGrams}
                    format={gramm}
                    ratio={metals.silverGrams / GAUGE_TARGETS.silverGrams}
                    hint={`Orientierung ${GAUGE_TARGETS.silverGrams} g`}
                    glyph={<MetalIcon metal="SILBER" size={t.icon.md} color={t.colors.mutedForeground} />}
                  />,
                  metals.platinumGrams > 0 ? (
                    <LedgerRow
                      key="platin"
                      label="Platinbestand"
                      value={metals.platinumGrams}
                      format={gramm}
                      glyph={<MetalIcon metal="PLATIN" size={t.icon.md} color={t.colors.mutedForeground} />}
                    />
                  ) : null,
                  metals.palladiumGrams > 0 ? (
                    <LedgerRow
                      key="palladium"
                      label="Palladiumbestand"
                      value={metals.palladiumGrams}
                      format={gramm}
                      glyph={<MetalIcon metal="PALLADIUM" size={t.icon.md} color={t.colors.mutedForeground} />}
                    />
                  ) : null,
                ]
              ) : (
                [<LockedRow key="gold" label="Goldbestand" />, <LockedRow key="silber" label="Silberbestand" />]
              )}
            </Ledger>
          </View>
        </StaggerItem>

        {/* f2) Edelmetall-Kurse — spot vs the 10-day average, per gram. Bare
            metal rows, the arrow + colour carrying direction (meaning only). */}
        <StaggerItem index={9}>
          <View className="gap-4">
            <SectionHeader title="Edelmetall-Kurse" subtitle="Spot gegen 10-Tage-Schnitt, je Gramm." />
            <MetalRatesStrip rates={rates} />
          </View>
        </StaggerItem>

        {/* g) Schatzkarte des Monats — the break-even crossing, then the goal.
            Bare rows; only shown when the map has a real fixed-cost line. */}
        {map ? (
          <StaggerItem index={10}>
            <View className="gap-4">
              <SectionHeader
                title="Schatzkarte des Monats"
                subtitle="Erst Kosten decken, dann Gewinn heben."
              />
              <Ledger>
                <LedgerRow
                  label={map.brokeEven ? "Monatsgewinn" : "Fixkosten gedeckt"}
                  value={map.brokeEven ? map.netProfitCents : map.coverage * 100}
                  format={map.brokeEven ? formatCents : (v: number) => `${Math.round(v)} %`}
                  ratio={map.brokeEven ? map.targetProgress : map.coverage}
                  hint={
                    map.brokeEven
                      ? `Ziel ${formatCents(profitTargetCents)}`
                      : `Noch ${formatCents(map.toBreakEvenCents)} bis zur Deckung`
                  }
                />
                <LedgerRow
                  label="Fixkosten im Monat"
                  value={map.fixedCostCents}
                  format={formatCents}
                  ratio={map.coverage}
                  hint={map.brokeEven ? "Vollständig gedeckt" : "Die Break-even-Linie"}
                />
              </Ledger>
            </View>
          </StaggerItem>
        ) : null}

        {/* h) Siegel der Werkstatt — earned vs locked, honestly. De-boxed: a
            Kicker + count over the bare seal grid, no outer panel. */}
        <StaggerItem index={11}>
          <View className="gap-4">
            <SectionHeader
              title="Siegel der Werkstatt"
              subtitle="Echte Meilensteine verdient, nie geschenkt."
              action={
                <Text className="font-mono-medium text-muted-foreground text-xs">
                  {earnedSeals} / {game.seals.length}
                </Text>
              }
            />
            <SealGrid seals={game.seals} />
            <Hairline />
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
        </StaggerItem>

        {/* i) Zielerreichung — the overall standing as one honest figure, from
            only the live ratios we have. A single hero number, no box, the bar
            beneath. */}
        <StaggerItem index={12}>
          <View className="gap-4">
            <SectionHeader
              title="Zielerreichung"
              subtitle="Der Schnitt aus deinen echten Tageswerten."
            />
            <View className="flex-row items-end justify-between">
              <Text
                className="text-muted-foreground text-2xs font-semibold uppercase"
                style={{ letterSpacing: 1 }}
              >
                Gesamtübersicht
              </Text>
              <CountUp
                value={Math.round(overallClamped * 100)}
                format={(v: number) => `${Math.round(v)} %`}
                className="font-mono-medium text-3xl"
                style={{ color: overallClamped >= 1 ? t.colors.verdigris : t.colors.foreground }}
              />
            </View>
            <View
              className="w-full overflow-hidden rounded-full"
              style={{ height: 6, backgroundColor: t.colors.border }}
              accessibilityRole="progressbar"
              accessibilityValue={{ now: Math.round(overallClamped * 100), min: 0, max: 100 }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${overallClamped * 100}%`,
                  backgroundColor: overallClamped >= 1 ? t.colors.verdigris : t.colors.gilt,
                }}
              />
            </View>
          </View>
        </StaggerItem>

        {/* j) Trust line — the board's one promise, restated quietly. */}
        <StaggerItem index={13}>
          <View className="flex-row items-center justify-center gap-2">
            <Diamond color={t.colors.gilt} />
            <Text className="text-muted-foreground text-center text-2xs">
              Jeder Wert ist eine echte Zahl aus dem System.
            </Text>
          </View>
        </StaggerItem>
      </ScrollView>

      {/* Break-even celebration — the gold flood, once per month, on the real
          false→true crossing. Sits above content, never blocks a tap. */}
      <GoldFlood visible={flood.visible} onReachPeak={flood.onReachPeak} onDone={flood.onDone} />
    </View>
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
function BridgeAlertRow({ alert, onPress }: { alert: LiveAlert; onPress: () => void }): ReactNode {
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
    <View className="flex-row">
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
 * the Notifications Center, so the two can never disagree. De-boxed: a Kicker +
 * count over bare alert rows divided by Hairlines, no outer panel. The caller
 * only renders this when `alerts` is non-empty, so there is no fabricated „all
 * calm" row here — silence on the board IS the calm state.
 */
function BridgeAlertsStrip({
  alerts,
  peak,
  onOpen,
}: {
  alerts: readonly LiveAlert[]
  peak: NotificationSeverity | null
  onOpen: (alert: LiveAlert) => void
}): ReactNode {
  const t = useW14Theme()
  const peakColor = peak ? alertSeverityColor(peak, t) : t.colors.verdigris
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-2.5">
          <Radio size={t.icon.md} color={t.colors.primary} />
          <View className="flex-1">
            <Text className="text-lg font-display-semibold leading-tight" numberOfLines={1}>
              Jetzt
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={2}>
              Was gerade deine Aufmerksamkeit braucht live aus dem System.
            </Text>
          </View>
        </View>
        <View
          className="flex-row items-center justify-center self-center rounded-full"
          style={{
            backgroundColor: peakColor + "1f",
            minWidth: 28,
            height: 28,
            paddingHorizontal: 8,
          }}
        >
          <Text className="font-mono-medium text-2xs font-bold" style={{ color: peakColor }}>
            {alerts.length}
          </Text>
        </View>
      </View>
      <View>
        {alerts.map((alert, i) => (
          <View key={alert.kind}>
            {i > 0 ? <Hairline /> : null}
            <View className="py-2">
              <BridgeAlertRow alert={alert} onPress={() => onOpen(alert)} />
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

// ── Schnellzugriff (quick-actions) ───────────────────────────────────────────
/**
 * The owner's most-used jumps, one tap from the board. Pure navigation — the
 * fiscal weight (TSE/§25a, step-up + confirm) lives entirely behind each target
 * surface, never fired from here. Rendered as bare `ListRow`s under a Kicker,
 * divided by Hairlines (no grid of bordered cards).
 */
const QUICK_ACTIONS: readonly { id: string; route: string; label: string; icon: LucideIcon }[] = [
  { id: "zielkarte", route: "/zielkarte", label: "Zielkarte", icon: Gauge },
  { id: "ankauf", route: "/ankauf", label: "Ankauf", icon: ShoppingBag },
  { id: "kasse", route: "/kasse", label: "Kasse & Z-Bon", icon: Receipt },
  { id: "kunde-neu", route: "/customer/neu", label: "Neuer Kunde", icon: UserPlus },
]

// ── Edelmetall-Kurse (spot vs 10-day average) ────────────────────────────────
/** German metal labels, local to the board (no cross-feature import). */
const METAL_LABEL_DE: Record<MetalKind, string> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

/** The bespoke MetalIcon kind per wire MetalKind, so each rate row is engraved. */
const METAL_ICON_KIND: Record<MetalKind, "GOLD" | "SILBER" | "PLATIN" | "PALLADIUM"> = {
  gold: "GOLD",
  silver: "SILBER",
  platinum: "PLATIN",
  palladium: "PALLADIUM",
}

/** Format a €/g decimal string as de-DE „12,3456 €/g" (4 dp matches the wire). */
function pricePerGram(decimal: string): string {
  const n = Number(decimal)
  if (!Number.isFinite(n)) return "kein Kurs"
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/g`
}

/**
 * One metal's rate row: the bespoke metal glyph + German name on the left, the
 * spot per gram + a direction arrow on the right. Both points are REAL numbers
 * from /api/metal-prices/rates — the arrow + colour carry the spot-vs-average
 * direction (meaning only). A metal whose spot or average is unreadable is
 * skipped by the caller, so this only ever renders a fully-known row.
 */
function MetalRateRow({
  metal,
  label,
  avg,
  current,
}: {
  metal: MetalKind
  label: string
  avg: string
  current: string
}): ReactNode {
  const t = useW14Theme()
  const avgN = Number(avg)
  const curN = Number(current)
  const rising = curN > avgN
  const falling = curN < avgN
  const arrowColor = rising
    ? t.colors.verdigris
    : falling
      ? t.colors.destructive
      : t.colors.mutedForeground
  const glyphColor = metal === "gold" ? t.colors.gilt : t.colors.mutedForeground
  return (
    // ONE calm line per metal: engraved glyph + name on the left, price + arrow
    // on the right. No nested boxes — the honest data only.
    <View className="flex-row items-center justify-between py-2.5">
      <View className="flex-row items-center gap-2">
        <MetalIcon metal={METAL_ICON_KIND[metal]} size={t.icon.md} color={glyphColor} />
        <Text className="text-sm font-medium">{label}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <ArrowUp
          size={t.icon.sm}
          color={arrowColor}
          style={{ transform: [{ rotate: rising ? "0deg" : falling ? "180deg" : "90deg" }] }}
        />
        <Text className="font-mono-medium text-sm" style={{ color: t.colors.foreground }}>
          {pricePerGram(current)}
        </Text>
      </View>
    </View>
  )
}

function MetalRatesStrip({ rates }: { rates: MetalRatesResponse | null }): ReactNode {
  const t = useW14Theme()
  // Only rows where BOTH the spot AND the 10-day average are readable — those are
  // the only ones we can draw an honest avg→spot direction for. Everything else is
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
          Kurse werden geladen, bald verfügbar.
        </Text>
      </View>
    )
  }

  if (rows.length === 0) {
    // The endpoint answered but no metal has both a spot and a 10-day average yet.
    return (
      <Text className="text-muted-foreground text-sm">
        Noch keine Kurse mit Vergleichswert. Sobald genug Verlauf vorliegt, erscheint der Trend hier.
      </Text>
    )
  }

  return (
    <View>
      {rows.map((r, i) => (
        <View key={r.metal}>
          {i > 0 ? <Hairline /> : null}
          <MetalRateRow
            metal={r.metal}
            label={METAL_LABEL_DE[r.metal]}
            avg={r.avg10dPricePerGramEur as string}
            current={r.currentPricePerGramEur as string}
          />
        </View>
      ))}
    </View>
  )
}
