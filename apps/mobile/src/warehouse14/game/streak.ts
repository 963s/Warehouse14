/**
 * Streak-Engine — the full «Serie» picture over REAL finalized closings.
 *
 * The low-level math already lives in ../schatzkammer.ts (computeStreak,
 * computeDailyQuest, finalizedBefore semantics). This module does NOT re-derive
 * it; it RE-USES `computeStreak` for the current run and adds the richer view a
 * surface needs: the longest run ever recorded, whether today is still in play
 * (the streak is "at risk" until today's closing beats yesterday), and a single
 * honest summary object. Honesty rule holds throughout — with no prior finalized
 * day the streak is 0 and `todayState` is "kein-vortag", never a fabricated run.
 */
import type { ClosingListItem } from "@warehouse14/api-client"

import { computeDailyQuest, computeStreak, type DailyQuest } from "../schatzkammer"

/**
 * Where TODAY sits relative to the streak:
 *   "kein-vortag"  — no prior finalized day exists yet; nothing to beat.
 *   "geschafft"    — today's live revenue already beat yesterday (streak safe,
 *                    extends by one once today is finalized).
 *   "offen"        — today is below yesterday so far; the streak is at risk
 *                    until the day closes.
 */
export type TodayStreakState = "kein-vortag" | "geschafft" | "offen"

export interface StreakSummary {
  /** Current run length over finalized days (consecutive beats, newest-back). */
  current: number
  /** Longest run ever recorded in the available closings history. */
  longest: number
  /** Where today stands relative to yesterday (drives the "noch X €"-nudge). */
  todayState: TodayStreakState
  /** True while today still needs to beat yesterday to keep the run alive. */
  atRisk: boolean
  /** The underlying daily quest (today vs yesterday) for copy + the gauge. */
  quest: DailyQuest
}

/**
 * Finalized closings strictly BEFORE `today`, oldest → newest. Mirrors the
 * private helper in schatzkammer.ts (kept local so this module stays a pure
 * consumer of the public `computeStreak`). Pass "" to include every finalized day.
 */
function finalizedBefore(closings: ClosingListItem[], today: string): ClosingListItem[] {
  return closings
    .filter((c) => c.state === "FINALIZED")
    .filter((c) => today === "" || c.businessDay < today)
    .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
}

function netCents(c: ClosingListItem): number {
  return Math.round(Number(c.netVerkaufEur) * 100)
}

/**
 * The longest run of consecutive day-over-day beats anywhere in the finalized
 * history (not just the most recent run). Returns 0 with fewer than two
 * qualifying days. This is the "Bestmarke" a surface celebrates separately from
 * the live streak.
 */
export function computeLongestStreak(closings: ClosingListItem[], today = ""): number {
  const fin = finalizedBefore(closings, today)
  let longest = 0
  let run = 0
  for (let i = 1; i < fin.length; i++) {
    const cur = fin[i]
    const prev = fin[i - 1]
    if (cur && prev && netCents(cur) > netCents(prev)) {
      run++
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  return longest
}

/**
 * The complete streak summary: the current run (from the shared
 * `computeStreak`), the longest run ever, and where today stands. `todayCents`
 * is today's LIVE revenue in cents (bridge snapshot); `closings` is
 * closingsApi.list().items; `today` is the YYYY-MM-DD business day (pass "" to
 * treat every finalized day as past). Pure — no fabrication.
 */
export function computeStreakSummary(
  todayCents: number,
  closings: ClosingListItem[],
  today = "",
): StreakSummary {
  const current = computeStreak(closings, today)
  const longest = Math.max(current, computeLongestStreak(closings, today))
  const quest = computeDailyQuest(todayCents, closings, today)

  let todayState: TodayStreakState
  if (quest.yesterdayCents === null) todayState = "kein-vortag"
  else if (quest.beaten) todayState = "geschafft"
  else todayState = "offen"

  // The run is at risk only when there IS a yesterday to beat and today hasn't
  // yet. With no prior day there is nothing to lose, so it is never "at risk".
  const atRisk = todayState === "offen"

  return { current, longest, todayState, atRisk, quest }
}
