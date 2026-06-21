/**
 * Warehouse14 Owner OS — die Spielwirtschaft (the gamification module).
 *
 * The shared "game economy" every Owner surface draws on, so progress, ranks,
 * seals and the daily quest feel like one system across the app. It is PURE
 * LOGIC + small presentational pieces, all driven by REAL data only — there are
 * no fabricated rewards anywhere in here. The low-level streak / quest /
 * break-even math lives in ../schatzkammer.ts; this module REUSES it (never
 * re-derives it) and layers the game on top.
 *
 * Logic
 *   ranks         — the Lehrling → Schatzmeister ladder, a pure function of the
 *                   real streak; rankForStreak / rankProgress / didRankUp.
 *   streak        — the full «Serie» picture over real closings (current +
 *                   longest + today's state), reusing schatzkammer.computeStreak.
 *   seals         — brass Siegel as pure predicates over real signals;
 *                   evaluateSeals / countEarnedSeals / newlyEarnedSeals.
 *   quests        — daily-quest VARIETY: one quest per business day, chosen
 *                   deterministically from the date, each from a live metric.
 *   useGameState  — fold a surface's already-fetched real values into the shared
 *                   derived state (streak · rank · seals · quest) in one call.
 *
 * Break-even celebration
 *   celebrationStore        — once-per-milestone memory (session, optional
 *                             persistence), so the flood never replays.
 *   useBreakEvenCelebration — arm <GoldFlood> + the Heavy haptic exactly once on
 *                             the real false→true break-even crossing.
 *
 * Presentational (built on the spine: RingGauge, Card, Text, tokens)
 *   RankBadge · StreakFlame · SealGrid · QuestCard.
 *
 * Honesty rule (absolute): every number shown traces to a real endpoint; with no
 * history a shop is honestly a Lehrling at streak 0 with locked seals, never
 * flattered. The celebration gates the flourish, never the underlying value.
 */

// ── Logic ────────────────────────────────────────────────────────────────────
export {
  RANKS,
  FIRST_RANK,
  TOP_RANK,
  rankForStreak,
  rankProgress,
  didRankUp,
  type RankId,
  type Rank,
  type RankProgress,
} from "./ranks"

export {
  computeStreakSummary,
  computeLongestStreak,
  type StreakSummary,
  type TodayStreakState,
} from "./streak"

export {
  SEALS,
  evaluateSeals,
  countEarnedSeals,
  newlyEarnedSeals,
  type SealId,
  type SealIcon,
  type SealSignals,
  type SealDefinition,
  type SealState,
} from "./seals"

export {
  activeQuestForDay,
  type QuestId,
  type QuestIcon,
  type QuestUnit,
  type QuestMetrics,
  type ActiveQuest,
} from "./quests"

export { useGameState, type GameState, type GameStateInput } from "./useGameState"

export {
  computeGameHistory,
  type GameHistory,
  type RankDayPoint,
  type StreakRun,
  type RankUpEvent,
  type SealEarnedEvent,
} from "./history"

// ── Break-even celebration ────────────────────────────────────────────────────
export {
  installCelebrationPersistence,
  hasCelebrated,
  markCelebrated,
  hydrateCelebrated,
  subscribeCelebrations,
  resetCelebrationsForTest,
  breakEvenKey,
  type CelebrationPersistence,
} from "./celebrationStore"

export {
  useBreakEvenCelebration,
  type BreakEvenCelebrationProps,
  type BreakEvenCelebrationOptions,
} from "./useBreakEvenCelebration"

export {
  useRankUpCelebration,
  rankUpKey,
  type RankUpCelebrationProps,
  type RankUpCelebrationOptions,
} from "./useRankUpCelebration"

// ── Erfolge surface — German labels + the merged milestone timeline builder ────
export {
  ERFOLGE_COPY,
  formatHistoryDate,
  formatShortDate,
  formatRunSpan,
  daysLabel,
  sealTitle,
  sealDescription,
  buildMilestoneTimeline,
  type MilestoneKind,
  type MilestoneEntry,
} from "./erfolge-ui"

// ── Presentational ────────────────────────────────────────────────────────────
export { RankBadge, type RankBadgeProps } from "./RankBadge"
export { StreakFlame, type StreakFlameProps } from "./StreakFlame"
export { SealGrid, type SealGridProps } from "./SealGrid"
export { QuestCard, type QuestCardProps } from "./QuestCard"
export { RankLadder, type RankLadderProps } from "./RankLadder"
export { StreakHistoryList, type StreakHistoryListProps } from "./StreakHistoryList"
export { AchievementTimeline, type AchievementTimelineProps } from "./AchievementTimeline"
