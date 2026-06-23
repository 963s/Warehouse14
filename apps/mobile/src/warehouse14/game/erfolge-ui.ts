/**
 * Erfolge-UI — pure German copy + formatting for the Erfolge surface.
 *
 * Kept React-free so it can be unit-reasoned and reused: the date/length
 * formatters, the seal-title lookup, and the screen's section copy. Everything
 * here only LABELS real data computed elsewhere (game/history.ts, game/seals.ts);
 * it never invents a value. German throughout, no exclamation marks, comma
 * decimals via the de-DE helpers the rest of the app uses.
 */
import { SEALS, type SealId } from "./seals"
import type { RankUpEvent, SealEarnedEvent, StreakRun } from "./history"

/** The Erfolge screen's static copy (title + each section's heading/subtitle). */
export const ERFOLGE_COPY = {
  screenTitle: "Erfolge",
  screenSubtitle: "Rang, Serien und Siegel die ganze Geschichte aus echten Tagesabschlüssen.",
  rankSection: {
    title: "Aufstieg",
    subtitle: "Die Leiter der Werkstatt wo du stehst und was als Nächstes kommt.",
  },
  streakSection: {
    title: "Serien-Historie",
    subtitle: "Jede Strähne von Tagen, die den Vortag geschlagen haben.",
  },
  achievementSection: {
    title: "Meilensteine",
    subtitle: "Wann du aufgestiegen bist und welche Siegel du verdient hast.",
  },
  sealSection: {
    title: "Siegel der Werkstatt",
    subtitle: "Echte Meilensteine verdient, nie geschenkt.",
  },
  /** Honest empty copy when there is no finalized history yet. */
  emptyTitle: "Noch keine Geschichte",
  emptyBody:
    "Sobald die ersten Tage abgeschlossen sind, erscheinen hier deine Serien, Aufstiege und Siegel jede Zahl aus echten Tagesabschlüssen.",
} as const

/** A finalized business day (YYYY-MM-DD) as de-DE „21. Juni 2026". */
export function formatHistoryDate(businessDay: string): string {
  const ms = Date.parse(`${businessDay}T00:00:00`)
  if (!Number.isFinite(ms)) return businessDay
  return new Date(ms).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

/** A short de-DE day label „21. Juni" (no year) for dense rows. */
export function formatShortDate(businessDay: string): string {
  const ms = Date.parse(`${businessDay}T00:00:00`)
  if (!Number.isFinite(ms)) return businessDay
  return new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "long" })
}

/** „1 Tag" / „N Tage" — the streak/run length, de-DE singular/plural. */
export function daysLabel(n: number): string {
  return `${n} ${n === 1 ? "Tag" : "Tage"}`
}

/** A run's date span as „2. – 6. Juni" (same month) or „28. Mai – 3. Juni". */
export function formatRunSpan(run: StreakRun): string {
  if (run.startDay === run.endDay) return formatShortDate(run.startDay)
  const start = Date.parse(`${run.startDay}T00:00:00`)
  const end = Date.parse(`${run.endDay}T00:00:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return `${formatShortDate(run.startDay)} ${formatShortDate(run.endDay)}`
  }
  const sameMonth = run.startDay.slice(0, 7) === run.endDay.slice(0, 7)
  const startStr = sameMonth
    ? `${new Date(start).getDate()}.`
    : formatShortDate(run.startDay)
  return `${startStr} ${formatShortDate(run.endDay)}`
}

/** The German seal title for an id (falls back to the id if unknown). */
export function sealTitle(id: SealId): string {
  return SEALS.find((s) => s.id === id)?.title ?? id
}

/** The German seal description for an id (one-liner of what earns it). */
export function sealDescription(id: SealId): string {
  return SEALS.find((s) => s.id === id)?.description ?? ""
}

// ── The chronological „Meilensteine" timeline ────────────────────────────────

/** Which kind of milestone a timeline entry is (drives the icon + accent). */
export type MilestoneKind = "rank-up" | "seal"

/** One entry on the merged, chronological milestone timeline. */
export interface MilestoneEntry {
  /** Stable key for React (kind + id + day). */
  key: string
  kind: MilestoneKind
  /** The day it happened, YYYY-MM-DD. */
  businessDay: string
  /** The headline, e.g. „Zum Goldschmied aufgestiegen" or the seal title. */
  title: string
  /** A one-line German detail under the title. */
  detail: string
}

/**
 * Merge the rank-up and seal-earned events into a single chronological timeline,
 * NEWEST first (the most recent milestone reads at the top). Pure — every entry's
 * date is a real finalized day. With no events the result is [] (honest empty).
 */
export function buildMilestoneTimeline(
  rankUps: readonly RankUpEvent[],
  sealsEarned: readonly SealEarnedEvent[],
): MilestoneEntry[] {
  const entries: MilestoneEntry[] = []

  for (const r of rankUps) {
    entries.push({
      key: `rank-${r.rank.id}-${r.businessDay}`,
      kind: "rank-up",
      businessDay: r.businessDay,
      title: `Zum ${r.rank.title} aufgestiegen`,
      detail: `${daysLabel(r.streak)} in Folge ${r.rank.description}`,
    })
  }

  for (const s of sealsEarned) {
    entries.push({
      key: `seal-${s.sealId}-${s.businessDay}`,
      kind: "seal",
      businessDay: s.businessDay,
      title: `Siegel ${sealTitle(s.sealId)}" verdient`,
      detail: sealDescription(s.sealId),
    })
  }

  // Newest first; on the same day, rank-ups read above seals (the bigger event).
  entries.sort((a, b) => {
    const byDay = b.businessDay.localeCompare(a.businessDay)
    if (byDay !== 0) return byDay
    if (a.kind === b.kind) return 0
    return a.kind === "rank-up" ? -1 : 1
  })

  return entries
}
