/**
 * Messing-Siegel — the brass seals an owner earns from REAL milestones.
 *
 * Each seal is a pure PREDICATE over real signals (streak length, longest run,
 * whether the month broke even, how many days were finalized). A seal is either
 * earned or not — there is no fabricated reward, no participation trophy. A fresh
 * shop simply holds zero seals and the surface renders them as honest, locked
 * outlines until the real number crosses the line.
 *
 * Seals live in the goldsmith metaphor: the first day's spark, sustained runs,
 * crossing into profit, a long history of closed books. German titles, no
 * exclamation marks. Icons are lucide ids resolved by the presentational layer
 * so this stays a pure-logic file (no React import here).
 */

/** Stable seal identifiers (React keys + comparisons). */
export type SealId =
  | "erster-funke"
  | "drei-am-stueck"
  | "wochenserie"
  | "bestmarke"
  | "schwelle"
  | "buchhalter"

/** Icon names from lucide-react-native, resolved by the presentational layer. */
export type SealIcon =
  | "Sparkles"
  | "Flame"
  | "CalendarCheck"
  | "Trophy"
  | "Scale"
  | "BookCheck"

/** The real signals every seal predicate reads. All come from live endpoints. */
export interface SealSignals {
  /** Current "Schlage gestern"-streak (computeStreakSummary.current). */
  currentStreak: number
  /** Longest run ever recorded (computeStreakSummary.longest). */
  longestStreak: number
  /** True once the month's cumulative net profit covers fixed costs (TreasureMap.brokeEven). */
  brokeEvenThisMonth: boolean
  /** Number of FINALIZED daily closings on record (closings history depth). */
  finalizedDays: number
}

export interface SealDefinition {
  id: SealId
  /** German seal title. */
  title: string
  /** One-line German description of what earns it. */
  description: string
  /** lucide icon id (resolved by the presentational layer). */
  icon: SealIcon
  /** True ⇔ the seal is earned, given the real signals. */
  isEarned: (s: SealSignals) => boolean
  /**
   * Progress toward earning it, 0..1, for a locked seal's faint fill. Earned
   * seals are always 1. Pure — derived from the same real signals.
   */
  progress: (s: SealSignals) => number
}

const ratio = (have: number, need: number): number =>
  need <= 0 ? 1 : Math.max(0, Math.min(1, have / need))

/**
 * The seal catalogue, in display order. Append-only by convention so a surface's
 * grid order is stable. Every predicate reads ONLY the real signals above.
 */
export const SEALS: readonly SealDefinition[] = [
  {
    id: "erster-funke",
    title: "Erster Funke",
    description: "Ein Tag besser als der Vortag.",
    icon: "Sparkles",
    isEarned: (s) => s.longestStreak >= 1,
    progress: (s) => (s.longestStreak >= 1 ? 1 : ratio(s.currentStreak, 1)),
  },
  {
    id: "drei-am-stueck",
    title: "Drei am Stück",
    description: "Drei Tage in Folge gesteigert.",
    icon: "Flame",
    isEarned: (s) => s.longestStreak >= 3,
    progress: (s) => (s.longestStreak >= 3 ? 1 : ratio(Math.max(s.currentStreak, s.longestStreak), 3)),
  },
  {
    id: "wochenserie",
    title: "Wochenserie",
    description: "Sieben Tage ohne Rückschritt.",
    icon: "CalendarCheck",
    isEarned: (s) => s.longestStreak >= 7,
    progress: (s) => (s.longestStreak >= 7 ? 1 : ratio(Math.max(s.currentStreak, s.longestStreak), 7)),
  },
  {
    id: "bestmarke",
    title: "Bestmarke",
    description: "Vierzehn Tage Aufstieg in Folge.",
    icon: "Trophy",
    isEarned: (s) => s.longestStreak >= 14,
    progress: (s) =>
      s.longestStreak >= 14 ? 1 : ratio(Math.max(s.currentStreak, s.longestStreak), 14),
  },
  {
    id: "schwelle",
    title: "Schwelle erreicht",
    description: "Diesen Monat die Fixkosten gedeckt.",
    icon: "Scale",
    isEarned: (s) => s.brokeEvenThisMonth,
    progress: (s) => (s.brokeEvenThisMonth ? 1 : 0),
  },
  {
    id: "buchhalter",
    title: "Saubere Bücher",
    description: "Dreißig Tagesabschlüsse abgeschlossen.",
    icon: "BookCheck",
    isEarned: (s) => s.finalizedDays >= 30,
    progress: (s) => (s.finalizedDays >= 30 ? 1 : ratio(s.finalizedDays, 30)),
  },
] as const

export interface SealState {
  definition: SealDefinition
  /** Earned ⇔ predicate true on the current real signals. */
  earned: boolean
  /** Progress toward it, 0..1 (1 once earned). */
  progress: number
}

/** Resolve every seal against the real signals: earned flag + progress, in order. */
export function evaluateSeals(signals: SealSignals): SealState[] {
  return SEALS.map((definition) => ({
    definition,
    earned: definition.isEarned(signals),
    progress: definition.isEarned(signals) ? 1 : Math.max(0, Math.min(1, definition.progress(signals))),
  }))
}

/** How many seals are currently earned (for an "X von Y"-summary). */
export function countEarnedSeals(signals: SealSignals): number {
  return SEALS.reduce((n, s) => n + (s.isEarned(signals) ? 1 : 0), 0)
}

/**
 * Seal ids newly earned when the signals move from `prev` to `next` — the set a
 * surface celebrates. Returns [] when nothing crossed. A null `prev` (first
 * load) yields [] so cold-start never floods the screen with seals already held.
 */
export function newlyEarnedSeals(
  prev: SealSignals | null,
  next: SealSignals,
): SealId[] {
  if (prev === null) return []
  return SEALS.filter((s) => !s.isEarned(prev) && s.isEarned(next)).map((s) => s.id)
}
