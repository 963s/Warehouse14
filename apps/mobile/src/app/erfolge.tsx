/**
 * Erfolge — the owner's whole gamification history, on one surface.
 *
 * The Schatzkammer shows TODAY's standing; this screen opens up the PAST and the
 * ladder ahead. Four honest sections, every number from a real finalized closing
 * (closingsApi.list → netVerkaufEur) or a live finance read:
 *
 *   • Aufstieg     — the full rank ladder (RankLadder): where you stand, what is
 *                    locked, and the real progress toward the next tier. Reaching a
 *                    new tier THIS session arms the gold flood + the single Heavy
 *                    haptic, exactly once per rank (useRankUpCelebration).
 *   • Serien-Historie — every streak run the shop has ever held (StreakHistoryList),
 *                    longest-first, each with its real date span and peak rank.
 *   • Meilensteine — the chronological timeline of rank-ups + seals earned
 *                    (AchievementTimeline), newest first, each on the real day it
 *                    happened.
 *   • Siegel       — the brass seal wall (SealGrid), earned-vs-locked honestly,
 *                    including the monthly break-even seal from the live state.
 *
 * The history is derived purely from the finalized closings (computeGameHistory);
 * the live game state (streak · rank · seals) is folded via useGameState from the
 * same real reads the dashboard uses, so the two surfaces always agree. With no
 * finalized history yet the screen shows an honest „Noch keine Geschichte"-state,
 * never a flattering one.
 *
 * Built entirely on the shared spine — the game module, the data layer
 * (useMultiQuery with per-source honesty + refetch-on-focus + polite polling +
 * pull-to-refresh), motion (Stagger, GoldFlood), components (SectionCard /
 * SealGrid / EmptyState / Skeleton / InlineError), and the §7 haptics. READ-ONLY:
 * no money moves here, so there is no step-up. Tokens only; de-DE; German UI.
 */
import { useCallback, useMemo } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import type {
  BridgeSummary,
  ClosingListItem,
  DashboardSummary,
  ProfitResponse,
} from "@warehouse14/api-client"
import { Sparkles, Trophy } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import {
  bridgeSummary,
  dashboardSummary,
  financeProfit,
  listClosings,
  listFixedCosts,
} from "@/warehouse14/api"
import {
  AchievementTimeline,
  buildMilestoneTimeline,
  computeGameHistory,
  ERFOLGE_COPY,
  RankLadder,
  SealGrid,
  StreakHistoryList,
  useGameState,
  useRankUpCelebration,
} from "@/warehouse14/game"
import { useDashboardTargets } from "@/warehouse14/preferences"
import {
  computeTreasureMap,
  monthlyFixedCostCents,
  monthStartDay,
  todayBusinessDay,
} from "@/warehouse14/schatzkammer"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  GoldFlood,
  haptics,
  InlineError,
  PaperGrain,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

const POLL_MS = 60_000

/** The first-load skeleton — the surface's shape, never a mid-screen spinner. */
function ErfolgeSkeleton() {
  return (
    <View className="gap-5">
      <View className="gap-1.5">
        <Skeleton width={150} height={26} />
        <Skeleton width="80%" height={12} />
      </View>
      {/* rank ladder */}
      <View className="gap-3 rounded-xl border border-border p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={i} className="flex-row items-center gap-3">
            <Skeleton width={36} height={36} radius="button" />
            <View className="flex-1 gap-1.5">
              <Skeleton width="45%" height={15} />
              <Skeleton width="70%" height={11} />
            </View>
          </View>
        ))}
      </View>
      {/* streak history */}
      <View className="gap-3 rounded-xl border border-border p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} className="gap-2">
            <Skeleton width="55%" height={15} />
            <Skeleton height={6} radius="full" />
          </View>
        ))}
      </View>
    </View>
  )
}

export default function ErfolgeScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const targets = useDashboardTargets()

  // One fan-out over the sources the game needs. Each settles independently
  // (allSettled inside the hook), so a failing finance read never blanks the
  // history — closings alone already drive the ladder + runs + timeline.
  const q = useMultiQuery(
    {
      closings: listClosings,
      bridge: bridgeSummary,
      dash: dashboardSummary,
      profitMonth: () => financeProfit("month"),
      fixedCosts: () => listFixedCosts({ activeOnly: true }),
    },
    { key: "erfolge", pollIntervalMs: POLL_MS },
  )
  const rc = useRefreshControl(q)

  const closings: ClosingListItem[] = q.results.closings.data?.items ?? []
  const bridge = q.results.bridge.data as BridgeSummary | null
  const dash = q.results.dash.data as DashboardSummary | null
  const profitMonth = q.results.profitMonth.data as ProfitResponse | null
  const fixedCosts = q.results.fixedCosts.data?.items ?? null

  const now = useMemo(() => new Date(), [])
  const biz = todayBusinessDay(now)
  const monthStart = monthStartDay(now)

  // The monthly break-even — only honest when BOTH the month's profit AND a real
  // fixed-cost line exist (an empty fixed-cost list means "not set up", not 0 €).
  const fixedCostCents = fixedCosts ? monthlyFixedCostCents(fixedCosts, monthStart) : 0
  const hasMap = profitMonth !== null && fixedCosts !== null && fixedCostCents > 0
  const profitTargetCents = Math.round(targets.monthlyProfitTargetEur * 100)
  const map =
    hasMap && profitMonth
      ? computeTreasureMap(profitMonth.netProfitCents, fixedCostCents, profitTargetCents)
      : null

  // The live game state — the SAME derivation the dashboard uses, so the ladder
  // and the seal wall here always agree with the Schatzkammer's chips.
  const game = useGameState({
    todayRevenueCents: bridge ? bridge.todayRevenueCents : null,
    todaySalesCount: bridge ? bridge.todaySalesCount : null,
    todayAnkaufCount: bridge ? bridge.todayAnkaufCount : null,
    pendingAppraisals: dash ? dash.pendingAppraisals : null,
    closings,
    brokeEvenThisMonth: map ? map.brokeEven : false,
    businessDay: biz,
  })

  // The honest history — runs, rank-ups, seal-earned dates — from the finalized
  // closings only (today excluded, exactly as the live streak does).
  const history = useMemo(() => computeGameHistory(closings, biz), [closings, biz])
  const milestones = useMemo(
    () => buildMilestoneTimeline(history.rankUps, history.sealsEarned),
    [history.rankUps, history.sealsEarned],
  )

  // Level-up celebration — fire the gold flood + the single Heavy haptic once per
  // rank, on a real upward tier crossing observed while the game state has settled.
  const gameReady = bridge !== null
  const flood = useRankUpCelebration(game.rank.current.tier, game.rank.current.id, {
    enabled: gameReady,
    onHeavy: haptics.impactHeavy,
  })

  const earnedSeals = game.seals.filter((s) => s.earned).length
  const onRetry = useCallback(() => void q.refetch(), [q])

  // First load with nothing on screen → shaped skeleton.
  const firstLoad = q.isLoading && bridge === null && q.results.closings.data == null

  // A background read failed while data is on screen → one non-blocking banner.
  const bgError =
    q.results.closings.error ??
    q.results.bridge.error ??
    q.results.dash.error ??
    q.results.profitMonth.error ??
    q.results.fixedCosts.error ??
    null

  // The history is honestly empty until there is at least one finalized run/event.
  const hasHistory = history.finalizedDays > 0

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: t.space.x4,
          paddingHorizontal: t.space.x4,
          paddingBottom: insets.contentBottom,
          gap: t.space.x5,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
      >
        <View className="flex-row items-center gap-2.5">
          <Trophy size={t.icon.xl - 2} color={t.colors.primary} />
          <View className="flex-1">
            {/* The screen's hero title speaks the antique DISPLAY voice —
                Bricolage Grotesque at the screen-title step (DESIGN-SYSTEM.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              {ERFOLGE_COPY.screenTitle}
            </Text>
            <Text className="text-muted-foreground text-sm" numberOfLines={2}>
              {ERFOLGE_COPY.screenSubtitle}
            </Text>
          </View>
        </View>

        {bgError ? <InlineError message={bgError} onRetry={onRetry} /> : null}

        {firstLoad ? (
          <ErfolgeSkeleton />
        ) : (
          <View className="gap-5">
            {/* a) Aufstieg — the full ladder + the level-up moment */}
            <StaggerItem index={0} exit={false}>
              <SectionCard
                title={ERFOLGE_COPY.rankSection.title}
                subtitle={ERFOLGE_COPY.rankSection.subtitle}
                icon={Trophy}
              >
                <RankLadder rank={game.rank} celebrate={flood.visible} />
              </SectionCard>
            </StaggerItem>

            {/* b) Serien-Historie — every run, longest-first */}
            <StaggerItem index={1} exit={false}>
              <SectionCard
                title={ERFOLGE_COPY.streakSection.title}
                subtitle={ERFOLGE_COPY.streakSection.subtitle}
              >
                {history.runs.length > 0 ? (
                  <StreakHistoryList runs={history.runs} longestRun={history.longestRun} />
                ) : (
                  <EmptyState
                    icon={Sparkles}
                    title="Noch keine Serie"
                    description="Sobald ein Tag den Vortag schlägt, beginnt deine erste Serie — und erscheint hier."
                  />
                )}
              </SectionCard>
            </StaggerItem>

            {/* c) Meilensteine — the chronological rank-up + seal timeline */}
            <StaggerItem index={2} exit={false}>
              <SectionCard
                title={ERFOLGE_COPY.achievementSection.title}
                subtitle={ERFOLGE_COPY.achievementSection.subtitle}
              >
                {milestones.length > 0 ? (
                  <AchievementTimeline entries={milestones} />
                ) : (
                  <EmptyState
                    icon={Trophy}
                    title="Noch keine Meilensteine"
                    description={
                      hasHistory
                        ? "Steig einen Rang auf oder verdien dein erstes Siegel — der Moment landet hier mit echtem Datum."
                        : ERFOLGE_COPY.emptyBody
                    }
                  />
                )}
              </SectionCard>
            </StaggerItem>

            {/* d) Siegel — earned vs locked, honestly (incl. the live break-even seal) */}
            <StaggerItem index={3} exit={false}>
              <SectionCard
                title={ERFOLGE_COPY.sealSection.title}
                subtitle={ERFOLGE_COPY.sealSection.subtitle}
                action={
                  <Text className="text-muted-foreground text-xs">
                    {earnedSeals} / {game.seals.length}
                  </Text>
                }
              >
                <SealGrid seals={game.seals} />
              </SectionCard>
            </StaggerItem>

            {/* e) Trust line */}
            <StaggerItem index={4} exit={false}>
              <Text className="text-muted-foreground text-center text-2xs">
                Jeder Aufstieg, jede Serie und jedes Siegel stammt aus echten Tagesabschlüssen.
              </Text>
            </StaggerItem>
          </View>
        )}
      </ScrollView>

      {/* Level-up gold flood — once per rank, on the real upward crossing. */}
      <GoldFlood visible={flood.visible} onReachPeak={flood.onReachPeak} onDone={flood.onDone} />
    </View>
  )
}
