/**
 * useGameState — assemble the whole «Spielwirtschaft» from REAL inputs in one call.
 *
 * A surface already fetches today's live cents (bridge), the closings history
 * (closingsApi.list), today's counts + pending appraisals, and the monthly
 * break-even state (computeTreasureMap). This hook folds those real values into
 * the derived game state every surface shares: the streak summary, the rank
 * standing, the evaluated seals, and the day's active quest — so no surface
 * re-derives the ladder or re-implements the rotation. Pure derivation, memoised
 * on its inputs; it fetches nothing and fabricates nothing.
 *
 * It deliberately does NOT own the break-even CELEBRATION — that is a stateful,
 * once-per-month effect, kept in useBreakEvenCelebration so a surface arms the
 * GoldFlood explicitly where it mounts the overlay.
 */
import { useMemo } from "react"
import type { ClosingListItem } from "@warehouse14/api-client"

import { activeQuestForDay, type ActiveQuest, type QuestMetrics } from "./quests"
import { computeStreakSummary, type StreakSummary } from "./streak"
import { evaluateSeals, type SealSignals, type SealState } from "./seals"
import { rankProgress, type RankProgress } from "./ranks"
import { computeDailyQuest } from "../schatzkammer"

export interface GameStateInput {
  /** Today's live revenue in cents (bridge snapshot), or null if unavailable. */
  todayRevenueCents: number | null
  /** Today's live sales count, or null. */
  todaySalesCount: number | null
  /** Today's live Ankauf count, or null. */
  todayAnkaufCount: number | null
  /** Pending appraisals / Expertisen, or null. */
  pendingAppraisals: number | null
  /** Daily closings (closingsApi.list().items). */
  closings: ClosingListItem[]
  /** Whether THIS month has broken even (computeTreasureMap.brokeEven). */
  brokeEvenThisMonth: boolean
  /** The local business day, YYYY-MM-DD (schatzkammer.todayBusinessDay). */
  businessDay: string
}

export interface GameState {
  /** The full streak picture (current / longest / today's state). */
  streak: StreakSummary
  /** The rank standing derived from the current streak. */
  rank: RankProgress
  /** Every seal evaluated against the real signals (earned + progress). */
  seals: SealState[]
  /** Today's single active quest, chosen deterministically from the date. */
  quest: ActiveQuest
  /** The real signals the seals were judged on (handy for newlyEarnedSeals). */
  sealSignals: SealSignals
}

/**
 * Derive the shared game state from the surface's already-fetched real values.
 * Memoised so a re-render with the same inputs does no work. A null money/count
 * input is treated honestly (0 today-cents for the streak math, and a quest that
 * reads a null metric is simply not offered — see activeQuestForDay).
 */
export function useGameState(input: GameStateInput): GameState {
  const {
    todayRevenueCents,
    todaySalesCount,
    todayAnkaufCount,
    pendingAppraisals,
    closings,
    brokeEvenThisMonth,
    businessDay,
  } = input

  return useMemo<GameState>(() => {
    const todayCents = todayRevenueCents ?? 0
    const streak = computeStreakSummary(todayCents, closings, businessDay)

    const rank = rankProgress(streak.current)

    const finalizedDays = closings.filter((c) => c.state === "FINALIZED").length
    const sealSignals: SealSignals = {
      currentStreak: streak.current,
      longestStreak: streak.longest,
      brokeEvenThisMonth,
      finalizedDays,
    }
    const seals = evaluateSeals(sealSignals)

    // The quest's "yesterday" comes from the same honest derivation the anchor
    // quest uses, so a no-history day falls back rather than inventing a figure.
    const yesterdayCents = computeDailyQuest(todayCents, closings, businessDay).yesterdayCents
    const metrics: QuestMetrics = {
      todayRevenueCents,
      todaySalesCount,
      todayAnkaufCount,
      pendingAppraisals,
      yesterdayCents,
    }
    const quest = activeQuestForDay(metrics, businessDay)

    return { streak, rank, seals, quest, sealSignals }
  }, [
    todayRevenueCents,
    todaySalesCount,
    todayAnkaufCount,
    pendingAppraisals,
    closings,
    brokeEvenThisMonth,
    businessDay,
  ])
}
