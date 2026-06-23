/**
 * Ränge — die Aufstiegsleiter der Spielwirtschaft.
 *
 * A rank is the owner's standing in the «Werkstatt», earned by keeping the
 * "Schlage gestern"-streak alive over real finalized closings (see
 * ../schatzkammer.ts → computeStreak). Higher streak = higher rank: Lehrling →
 * Geselle → Goldschmied → Meister → Schatzmeister. Nothing here is fabricated —
 * a rank is a pure function of a real streak length, so a fresh shop with no
 * history is honestly a «Lehrling» at streak 0, never flattered upward.
 *
 * The thresholds are intentionally gentle at the bottom (one good day already
 * moves you off zero) and widen toward the top so «Schatzmeister» means a real,
 * sustained run. The titles use the goldsmith metaphor the rest of the Owner OS
 * speaks (Werkstatt / Schatzkammer), in German, no exclamation marks.
 */

/** Stable rank identifiers, lowest → highest. Used as React keys + in logic. */
export type RankId = "lehrling" | "geselle" | "goldschmied" | "meister" | "schatzmeister"

export interface Rank {
  /** Stable id (React key, comparisons). */
  id: RankId
  /** German display title. */
  title: string
  /** One-line German description of what this standing means. */
  description: string
  /**
   * Zero-based tier index (0 = Lehrling … 4 = Schatzmeister). Useful for
   * progress dots and for comparing two ranks without an id lookup.
   */
  tier: number
  /** Minimum streak (inclusive) to hold this rank. */
  minStreak: number
  /**
   * Streak at which the NEXT rank begins, or null for the top rank. The current
   * rank spans [minStreak, nextAtStreak).
   */
  nextAtStreak: number | null
}

/**
 * The ladder, lowest → highest. Thresholds are streak lengths (consecutive
 * finalized days that beat the prior day). A 0-day shop is a Lehrling.
 */
export const RANKS: readonly Rank[] = [
  {
    id: "lehrling",
    title: "Lehrling",
    description: "Die ersten Schläge an der Werkbank.",
    tier: 0,
    minStreak: 0,
    nextAtStreak: 1,
  },
  {
    id: "geselle",
    title: "Geselle",
    description: "Ein erster Tag besser als der Vortag.",
    tier: 1,
    minStreak: 1,
    nextAtStreak: 3,
  },
  {
    id: "goldschmied",
    title: "Goldschmied",
    description: "Drei Tage in Folge gesteigert.",
    tier: 2,
    minStreak: 3,
    nextAtStreak: 7,
  },
  {
    id: "meister",
    title: "Meister",
    description: "Eine ganze Woche ohne Rückschritt.",
    tier: 3,
    minStreak: 7,
    nextAtStreak: 14,
  },
  {
    id: "schatzmeister",
    title: "Schatzmeister",
    description: "Vierzehn Tage Aufstieg Hüter der Schatzkammer.",
    tier: 4,
    minStreak: 14,
    nextAtStreak: null,
  },
] as const

/** The lowest rank, returned for a streak of 0 / any non-finite input. */
export const FIRST_RANK: Rank = RANKS[0]!
/** The highest rank — once held, there is no further tier. */
export const TOP_RANK: Rank = RANKS[RANKS.length - 1]!

export interface RankProgress {
  /** The rank currently held. */
  current: Rank
  /** The next rank to reach, or null when already at the top. */
  next: Rank | null
  /** The streak this progress was computed from (echoed back, sanitised). */
  streak: number
  /**
   * Streak days still needed to reach `next` (0 at the top, or once exactly on a
   * boundary the value reflects the gap to the following tier).
   */
  toNextStreak: number
  /**
   * Progress through the CURRENT tier toward the next, 0..1. At the top rank
   * this is always 1 (the bar is full — there is nothing left to fill).
   */
  progress: number
}

const sanitizeStreak = (streak: number): number =>
  Number.isFinite(streak) ? Math.max(0, Math.floor(streak)) : 0

/** The rank held at a given streak length (the highest tier whose minStreak ≤ streak). */
export function rankForStreak(streak: number): Rank {
  const s = sanitizeStreak(streak)
  let held: Rank = FIRST_RANK
  for (const r of RANKS) {
    if (s >= r.minStreak) held = r
    else break
  }
  return held
}

/**
 * Full rank standing for a streak: the held rank, the next rank, how far to it,
 * and the within-tier progress for a gauge. Pure + honest — a streak of 0 is a
 * Lehrling at 0 % toward Geselle, never inflated.
 */
export function rankProgress(streak: number): RankProgress {
  const s = sanitizeStreak(streak)
  const current = rankForStreak(s)
  const next = current.nextAtStreak === null ? null : RANKS[current.tier + 1] ?? null

  if (next === null || current.nextAtStreak === null) {
    return { current, next: null, streak: s, toNextStreak: 0, progress: 1 }
  }

  const span = current.nextAtStreak - current.minStreak
  const into = s - current.minStreak
  const progress = span <= 0 ? 1 : Math.max(0, Math.min(1, into / span))
  const toNextStreak = Math.max(0, current.nextAtStreak - s)
  return { current, next, streak: s, toNextStreak, progress }
}

/**
 * Did a streak change cross a rank boundary upward? True only when the new
 * streak holds a strictly higher tier than the previous streak — the signal a
 * surface uses to play the promotion flourish exactly once.
 */
export function didRankUp(prevStreak: number, nextStreak: number): boolean {
  return rankForStreak(nextStreak).tier > rankForStreak(prevStreak).tier
}
