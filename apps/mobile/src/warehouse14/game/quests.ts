/**
 * Tagesquest-Vielfalt — the daily quest, with variety, all from REAL metrics.
 *
 * The Owner OS's flagship quest is "Schlage gestern" (today's revenue vs the
 * last finalized day — see ../schatzkammer.ts). That stays the anchor. This
 * module adds VARIETY: a small catalogue of quest TYPES, each built from a live
 * metric the bridge/dashboard already provides (revenue, sales count, Ankauf
 * count, pending appraisals). Exactly one quest is active per business day,
 * chosen DETERMINISTICALLY from the date — so it is stable all day and rotates
 * day to day, never random, never re-rolling on a refetch.
 *
 * Honesty rule: a quest only appears if its metric is actually present (a real
 * number ≥ its bar makes sense). Progress is real value / real target, clamped.
 * "Schlage gestern" is offered only when a prior finalized day exists; with no
 * history the engine falls back to a fixed, honest first-day quest. No quest
 * ever shows a fabricated number — the target is a known constant, the value is
 * live.
 */
import { GAUGE_TARGETS } from "../schatzkammer"

/** Stable quest-type ids (React keys + comparisons). */
export type QuestId =
  | "schlage-gestern"
  | "tagesziel-umsatz"
  | "ankauf-jagd"
  | "verkauf-spurt"
  | "expertisen-leeren"

/** lucide icon ids, resolved by the presentational layer. */
export type QuestIcon = "Swords" | "Target" | "Gem" | "Tags" | "Stamp"

/** The live metrics a quest can read. All come from real endpoints, in their
 *  native unit (cents for money, integer counts otherwise). A field is null when
 *  the source is unavailable — a quest reading a null metric is not offered. */
export interface QuestMetrics {
  /** Today's live revenue in cents (bridge snapshot). */
  todayRevenueCents: number | null
  /** Today's live sales count (bridge snapshot). */
  todaySalesCount: number | null
  /** Today's live Ankauf count (bridge snapshot). */
  todayAnkaufCount: number | null
  /** Pending appraisals / Expertisen (dashboard summary). */
  pendingAppraisals: number | null
  /**
   * Last finalized day's net Verkauf in cents, or null if no prior day exists.
   * (From computeDailyQuest(...).yesterdayCents — keeps the anchor quest honest.)
   */
  yesterdayCents: number | null
}

/** A unit hint so the presentational layer formats value/target correctly. */
export type QuestUnit = "cents" | "count" | "count-down"

export interface ActiveQuest {
  id: QuestId
  /** German quest title (the call to action). */
  title: string
  /** German one-liner of what to do. */
  description: string
  icon: QuestIcon
  /** Current real value toward the goal (cents or a count). */
  value: number
  /** The goal (cents or a count). A known constant or the real yesterday figure. */
  target: number
  /** How to format value/target. "count-down" goals shrink toward 0 (Expertisen). */
  unit: QuestUnit
  /** Progress 0..1 (clamped) — value/target, or remaining/total for "count-down". */
  progress: number
  /** True once the goal is met. */
  done: boolean
}

interface QuestBlueprint {
  id: QuestId
  icon: QuestIcon
  unit: QuestUnit
  /** Build the quest from metrics, or return null when its metric is unavailable. */
  build: (m: QuestMetrics) => Omit<ActiveQuest, "id" | "icon" | "unit" | "progress" | "done"> | null
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

/**
 * The rotating quest catalogue (excluding the no-history fallback). Order is the
 * rotation order; the day index picks one. "Schlage gestern" leads because it is
 * the anchor — on a day with history it is the most likely pick.
 */
const BLUEPRINTS: readonly QuestBlueprint[] = [
  {
    id: "schlage-gestern",
    icon: "Swords",
    unit: "cents",
    build: (m) => {
      if (m.yesterdayCents === null || m.todayRevenueCents === null) return null
      return {
        title: "Schlage gestern",
        description: "Heute mehr Umsatz als am letzten Abschlusstag.",
        value: m.todayRevenueCents,
        target: m.yesterdayCents,
      }
    },
  },
  {
    id: "tagesziel-umsatz",
    icon: "Target",
    unit: "cents",
    build: (m) => {
      if (m.todayRevenueCents === null) return null
      return {
        title: "Tagesziel knacken",
        description: "Den Tagesumsatz über die Zielmarke bringen.",
        value: m.todayRevenueCents,
        target: GAUGE_TARGETS.revenueEur * 100,
      }
    },
  },
  {
    id: "ankauf-jagd",
    icon: "Gem",
    unit: "count",
    build: (m) => {
      if (m.todayAnkaufCount === null) return null
      return {
        title: "Ankauf-Jagd",
        description: "Heute genug Ankäufe in die Schatzkammer holen.",
        value: m.todayAnkaufCount,
        target: GAUGE_TARGETS.ankaufCount,
      }
    },
  },
  {
    id: "verkauf-spurt",
    icon: "Tags",
    unit: "count",
    build: (m) => {
      if (m.todaySalesCount === null) return null
      return {
        title: "Verkaufs-Spurt",
        description: "Die Stückzahl der Verkäufe heute treffen.",
        value: m.todaySalesCount,
        target: GAUGE_TARGETS.soldCount,
      }
    },
  },
  {
    id: "expertisen-leeren",
    icon: "Stamp",
    unit: "count-down",
    build: (m) => {
      // Only offered when there is actually a backlog to clear.
      if (m.pendingAppraisals === null || m.pendingAppraisals <= 0) return null
      return {
        title: "Expertisen leeren",
        description: "Offene Expertisen heute abarbeiten.",
        value: m.pendingAppraisals,
        target: 0,
      }
    },
  },
] as const

/** The honest first-day quest when no prior finalized day exists yet. */
function firstDayQuest(m: QuestMetrics): ActiveQuest {
  const value = m.todayRevenueCents ?? 0
  const target = GAUGE_TARGETS.revenueEur * 100
  return {
    id: "tagesziel-umsatz",
    title: "Den ersten Tag öffnen",
    description: "Noch kein Vortag leg mit dem Tagesziel los.",
    icon: "Target",
    value,
    target,
    unit: "cents",
    progress: clamp01(target <= 0 ? (value > 0 ? 1 : 0) : value / target),
    done: target > 0 && value >= target,
  }
}

function finalize(bp: QuestBlueprint, base: NonNullable<ReturnType<QuestBlueprint["build"]>>): ActiveQuest {
  let progress: number
  let done: boolean
  if (bp.unit === "count-down") {
    // A backlog to clear down to the target (usually 0). We have no honest
    // starting baseline to measure partial progress against — the backlog only
    // ever grows or shrinks live — so the bar stays empty while items remain and
    // fills the moment the backlog is cleared. No fabricated mid-progress.
    done = base.value <= base.target
    progress = done ? 1 : 0
  } else {
    progress = clamp01(base.target <= 0 ? (base.value > 0 ? 1 : 0) : base.value / base.target)
    done = base.target > 0 ? base.value >= base.target : base.value > 0
  }
  return { id: bp.id, icon: bp.icon, unit: bp.unit, ...base, progress, done }
}

/** Stable non-negative day index from a YYYY-MM-DD business day (days since epoch). */
function dayIndex(businessDay: string): number {
  const ms = Date.parse(`${businessDay}T00:00:00Z`)
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * The single active quest for `businessDay` (YYYY-MM-DD), chosen deterministically
 * from the date so it is stable all day and rotates day to day. Only quests whose
 * metric is available are eligible; with none eligible (and no prior day) it
 * falls back to the honest first-day quest.
 *
 * `businessDay` should be the local business day (schatzkammer.todayBusinessDay).
 */
export function activeQuestForDay(metrics: QuestMetrics, businessDay: string): ActiveQuest {
  const eligible = BLUEPRINTS.map((bp) => {
    const base = bp.build(metrics)
    return base ? finalize(bp, base) : null
  }).filter((q): q is ActiveQuest => q !== null)

  if (eligible.length === 0) return firstDayQuest(metrics)

  const idx = dayIndex(businessDay) % eligible.length
  return eligible[idx]!
}
