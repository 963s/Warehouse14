/**
 * App-Präferenzen — the owner's persisted dashboard targets (the value/target
 * rings on the Schatzkammer). This is the editable home for the goals that were
 * shipped as constants in `schatzkammer.ts` (GAUGE_TARGETS) with the note
 * „TODO(phase-later): move to owner-editable settings". The Einstellungen
 * surface writes them here; the store seeds from those exact constants so the
 * defaults match what the dashboard renders today.
 *
 * Mirrors `onboarding.ts` / `celebrationStore.ts` to the letter: an in-memory,
 * `useSyncExternalStore`-friendly store with ZERO required dependencies, plus an
 * OPTIONAL persistence adapter the app may install once at start to survive cold
 * starts. Without an adapter the store is session-scoped — the same graceful
 * degradation as the session + onboarding stores. Persistence is fire-and-forget;
 * a storage failure never throws into the UI.
 *
 * Honesty note: these are PREFERENCES (the owner's own goals), not KPIs — they
 * round-trip exactly what the owner enters and are seeded from the real targets
 * the app already uses. Nothing here fabricates a measured value. A target that
 * is cleared falls back to its real default; it is never silently invented.
 */
import { useSyncExternalStore } from "react"

import { GAUGE_TARGETS } from "./schatzkammer"

/** An async key→string store the app may install (e.g. wrapping AsyncStorage). */
export interface PreferencesPersistence {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

/** The owner-editable dashboard goals (the subset surfaced in Einstellungen). */
export interface DashboardTargets {
  /** Tagesumsatz-Ziel in EUR (the daily revenue ring). */
  revenueEur: number
  /** Tagesgewinn-Ziel in EUR (net profit, period=day). */
  netProfitDayEur: number
  /** Monatsumsatz-Ziel in EUR. */
  monthRevenueEur: number
  /** Monatlicher Gewinn-Ziel in EUR (the chest at the end of the treasure map). */
  monthlyProfitTargetEur: number
}

/** The real defaults — the exact constants the dashboard renders today. */
export const DEFAULT_DASHBOARD_TARGETS: DashboardTargets = {
  revenueEur: GAUGE_TARGETS.revenueEur,
  netProfitDayEur: GAUGE_TARGETS.netProfitDayEur,
  monthRevenueEur: GAUGE_TARGETS.monthRevenueEur,
  monthlyProfitTargetEur: GAUGE_TARGETS.monthlyProfitTargetEur,
}

/** Whole-EUR ceiling a single target may take — a guard against fat-finger input. */
export const MAX_TARGET_EUR = 100_000_000

const STORAGE_KEY = "w14.preferences.dashboardTargets"

let targets: DashboardTargets = { ...DEFAULT_DASHBOARD_TARGETS }
const listeners = new Set<() => void>()
let persistence: PreferencesPersistence | null = null

function emit(): void {
  for (const l of listeners) l()
}

/** A finite, positive integer EUR amount within the guard rail, else null. */
function sanitizeEur(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded <= 0 || rounded > MAX_TARGET_EUR) return null
  return rounded
}

/** Coerce an unknown parsed blob into a valid DashboardTargets (real defaults fill gaps). */
function coerceTargets(raw: unknown): DashboardTargets {
  const obj = (raw ?? {}) as Partial<Record<keyof DashboardTargets, unknown>>
  return {
    revenueEur: sanitizeEur(obj.revenueEur) ?? DEFAULT_DASHBOARD_TARGETS.revenueEur,
    netProfitDayEur: sanitizeEur(obj.netProfitDayEur) ?? DEFAULT_DASHBOARD_TARGETS.netProfitDayEur,
    monthRevenueEur: sanitizeEur(obj.monthRevenueEur) ?? DEFAULT_DASHBOARD_TARGETS.monthRevenueEur,
    monthlyProfitTargetEur:
      sanitizeEur(obj.monthlyProfitTargetEur) ?? DEFAULT_DASHBOARD_TARGETS.monthlyProfitTargetEur,
  }
}

/**
 * Install a persistence adapter and hydrate from it. Safe to call once at app
 * start; without it the targets reset to defaults after every cold start.
 * Hydration failures are swallowed — worst case the defaults stand.
 */
export async function installPreferencesPersistence(
  adapter: PreferencesPersistence,
): Promise<void> {
  persistence = adapter
  try {
    const v = await adapter.getItem(STORAGE_KEY)
    if (v != null) {
      targets = coerceTargets(JSON.parse(v))
      emit()
    }
  } catch {
    // Read/parse failed — keep the real defaults; never crash on a bad blob.
  }
}

/** The current dashboard targets (the owner's goals, or the real defaults). */
export function getDashboardTargets(): DashboardTargets {
  return targets
}

/** Fire-and-forget persist of the current targets (no-op without an adapter). */
function persist(): void {
  if (!persistence) return
  try {
    const p = persistence.setItem(STORAGE_KEY, JSON.stringify(targets))
    if (p && typeof p.then === "function") p.then(undefined, () => {})
  } catch {
    // Storage threw synchronously — keep the session-scoped value, stay quiet.
  }
}

/**
 * Replace the dashboard targets. Each field is sanitised to a positive whole-EUR
 * amount within the guard rail; an invalid field falls back to its real default
 * rather than persisting a junk goal. Returns the value that was actually stored.
 */
export function setDashboardTargets(next: Partial<DashboardTargets>): DashboardTargets {
  targets = coerceTargets({ ...targets, ...next })
  emit()
  persist()
  return targets
}

/** Restore the dashboard targets to the app's real defaults. */
export function resetDashboardTargets(): DashboardTargets {
  targets = { ...DEFAULT_DASHBOARD_TARGETS }
  emit()
  persist()
  return targets
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive view of the dashboard targets for screens (useSyncExternalStore). */
export function useDashboardTargets(): DashboardTargets {
  return useSyncExternalStore(
    subscribe,
    () => targets,
    () => targets,
  )
}

/** TEST/DEV only — reset the in-memory targets (does not touch persistence). */
export function resetPreferencesForTest(): void {
  targets = { ...DEFAULT_DASHBOARD_TARGETS }
  emit()
}
