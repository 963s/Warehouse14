/**
 * Erfolgs-Historie — the honest history engine behind the Erfolge surface.
 *
 * The live game (streak · rank · seals · quest) reads only TODAY. The Erfolge
 * screen needs the PAST: every streak run the shop has ever held, the rank it
 * stood at on each finalized day, the days it climbed a tier, and the day each
 * seal was first earned. This module derives ALL of that from the same real
 * FINALIZED daily closings the rest of the Spielwirtschaft uses
 * (closingsApi.list → netVerkaufEur), and NOTHING else — there is no fabricated
 * reward, no invented date. A shop with no history yields empty arrays, honestly.
 *
 * Method (one walk over the finalized days, oldest → newest):
 *   • The streak at day i is the length of the consecutive day-over-day "beats"
 *     ending at i (it resets to 0 the moment a day fails to beat the prior one).
 *     This is the SAME rule as schatzkammer.computeStreak, applied historically.
 *   • The rank at day i is rankForStreak(streak at i) — the exact live function.
 *   • A "run" is a maximal stretch of consecutive beats; we record its start/end
 *     business day, its peak length, and the peak rank it reached.
 *   • A rank-up event is the first finalized day on which a strictly higher tier
 *     than ever-before was reached — the honest "du wurdest zum X" moment.
 *   • A seal-earned event is the first finalized day on which a seal's predicate
 *     became true, evaluated on the signals AS THEY STOOD that day (streak so far,
 *     longest so far, finalized-days-so-far). Break-even seals are NOT dated here
 *     (their signal is a monthly finance flag, not a per-closing fact) — the
 *     surface shows those from the live seal state instead, never with a fake date.
 *
 * Honesty rule (absolute): every length, rank, and date here is read off a real
 * finalized closing. With fewer than two finalized days there are no runs and no
 * rank-ups — the surface renders the honest empty state, never a flattering one.
 */
import type { ClosingListItem } from "@warehouse14/api-client"

import { rankForStreak, type Rank } from "./ranks"
import { SEALS, type SealId } from "./seals"

/** A single finalized day with the streak/rank it stood at, oldest → newest. */
export interface RankDayPoint {
  /** The finalized business day, YYYY-MM-DD. */
  businessDay: string
  /** Net Verkauf that day in integer cents (real, from the closing). */
  netCents: number
  /** True ⇔ this day strictly beat the prior finalized day's net Verkauf. */
  beatPrevious: boolean
  /** The streak length as it stood at the close of this day. */
  streak: number
  /** The rank held at the close of this day (rankForStreak(streak)). */
  rank: Rank
}

/** One historical streak run — a maximal stretch of consecutive day-over-day beats. */
export interface StreakRun {
  /** The first day OF THE RUN (the first beat in the stretch), YYYY-MM-DD. */
  startDay: string
  /** The last day of the run (the last beat before it broke), YYYY-MM-DD. */
  endDay: string
  /** The run's length in days (number of consecutive beats). */
  length: number
  /** The highest rank the run reached at its peak. */
  peakRank: Rank
  /** True ⇔ this run is the still-live current run (its end is the latest day). */
  isCurrent: boolean
}

/** A rank-up moment — the first day a strictly higher tier than ever-before was held. */
export interface RankUpEvent {
  /** The day the new tier was first reached, YYYY-MM-DD. */
  businessDay: string
  /** The rank reached (the new, higher tier). */
  rank: Rank
  /** The streak length at the moment of promotion. */
  streak: number
}

/** A seal-earned moment — the first finalized day a streak/history seal became true. */
export interface SealEarnedEvent {
  /** Which seal was earned. */
  sealId: SealId
  /** The day it was first earned, YYYY-MM-DD. */
  businessDay: string
}

export interface GameHistory {
  /** Per-finalized-day rank/streak points, oldest → newest. */
  days: RankDayPoint[]
  /** Every streak run, longest → shortest then most-recent first on ties. */
  runs: StreakRun[]
  /** Rank-up moments, oldest → newest. */
  rankUps: RankUpEvent[]
  /** Streak/history seals with the day each was first earned, oldest → newest. */
  sealsEarned: SealEarnedEvent[]
  /** The longest run length on record (0 with fewer than two qualifying days). */
  longestRun: number
  /** The number of finalized days on record (history depth). */
  finalizedDays: number
}

function netCents(c: ClosingListItem): number {
  // netVerkaufEur is a decimal EUR string; round to integer cents (mirrors
  // schatzkammer.netVerkaufCents so the history agrees with the live streak).
  return Math.round(Number(c.netVerkaufEur) * 100)
}

/**
 * Finalized closings strictly BEFORE `today` (or all of them when `today` is ""),
 * oldest → newest. Mirrors schatzkammer.finalizedBefore so the history is built
 * over exactly the same set of days the live streak walks.
 */
function finalizedBefore(closings: ClosingListItem[], today: string): ClosingListItem[] {
  return closings
    .filter((c) => c.state === "FINALIZED")
    .filter((c) => today === "" || c.businessDay < today)
    .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
}

/**
 * The full game history over the real finalized closings. `today` (YYYY-MM-DD)
 * excludes the still-open current day from the historical walk, exactly as the
 * live streak does; pass "" to treat every finalized day as past.
 *
 * Pure + memo-friendly: one O(n) walk, no fabrication. With fewer than two
 * finalized days `runs`/`rankUps` are empty and `days` simply lists what exists.
 */
export function computeGameHistory(closings: ClosingListItem[], today = ""): GameHistory {
  const fin = finalizedBefore(closings, today)
  const finalizedDays = fin.length

  const days: RankDayPoint[] = []
  const runs: StreakRun[] = []
  const rankUps: RankUpEvent[] = []
  const sealsEarned: SealEarnedEvent[] = []

  let streak = 0
  let longestRun = 0
  // The highest tier ever reached so far — promotions are first-time crossings.
  let bestTier = -1
  // The seals already earned (so each is dated only the FIRST day it became true).
  const earnedSealIds = new Set<SealId>()
  // The run currently being accumulated (a stretch of consecutive beats).
  let runStartIdx = -1
  let runPeakStreak = 0

  const closeRun = (endIdx: number): void => {
    if (runStartIdx < 0 || runPeakStreak <= 0) return
    const startItem = fin[runStartIdx]
    const endItem = fin[endIdx]
    if (!startItem || !endItem) return
    runs.push({
      startDay: startItem.businessDay,
      endDay: endItem.businessDay,
      length: runPeakStreak,
      peakRank: rankForStreak(runPeakStreak),
      isCurrent: endIdx === fin.length - 1,
    })
    runStartIdx = -1
    runPeakStreak = 0
  }

  for (let i = 0; i < fin.length; i++) {
    const cur = fin[i]
    const prev = i > 0 ? fin[i - 1] : null
    if (!cur) continue

    const beatPrevious = prev != null && netCents(cur) > netCents(prev)
    if (beatPrevious) {
      streak++
      if (runStartIdx < 0) runStartIdx = i // the run starts at the FIRST beat
      runPeakStreak = streak
      if (streak > longestRun) longestRun = streak
    } else {
      // A non-beat breaks the current run; close it at the prior day.
      if (runStartIdx >= 0) closeRun(i - 1)
      streak = 0
    }

    const rank = rankForStreak(streak)

    // First-time promotion to a strictly higher tier than ever before.
    if (rank.tier > bestTier) {
      // tier 0 (Lehrling) is the baseline, never announced as a promotion.
      if (rank.tier > 0) {
        rankUps.push({ businessDay: cur.businessDay, rank, streak })
      }
      bestTier = rank.tier
    }

    // Seal-earned dating — evaluate the STREAK/HISTORY seals on the signals as
    // they stood at the close of this day. Break-even seals are skipped: their
    // signal (brokeEvenThisMonth) is a monthly finance flag, not a per-closing
    // fact, so dating one here would be fabricating a date. The surface shows the
    // break-even seal from the live state instead.
    const signalsToday = {
      currentStreak: streak,
      longestStreak: longestRun,
      brokeEvenThisMonth: false,
      finalizedDays: i + 1,
    }
    for (const seal of SEALS) {
      if (earnedSealIds.has(seal.id)) continue
      if (seal.id === "schwelle") continue // break-even seal — not date-able here
      if (seal.isEarned(signalsToday)) {
        earnedSealIds.add(seal.id)
        sealsEarned.push({ sealId: seal.id, businessDay: cur.businessDay })
      }
    }

    days.push({
      businessDay: cur.businessDay,
      netCents: netCents(cur),
      beatPrevious,
      streak,
      rank,
    })
  }

  // Close a run still open at the end (it is the live/current run).
  if (runStartIdx >= 0) closeRun(fin.length - 1)

  // Runs sorted longest-first, then most-recent end-day first on a tie — the
  // order the Erfolge timeline reads best (biggest achievements at the top).
  runs.sort((a, b) => (b.length - a.length) || b.endDay.localeCompare(a.endDay))

  return { days, runs, rankUps, sealsEarned, longestRun, finalizedDays }
}
