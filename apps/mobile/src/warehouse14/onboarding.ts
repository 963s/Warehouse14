/**
 * First-run memory — remembers whether the owner has already seen the calm
 * three-slide intro (Schatzkammer · die Flächen · das Ehrlichkeitsprinzip), so
 * the intro plays on the very first cold open and never gets in the way again.
 *
 * Mirrors the session + celebration stores exactly: an in-memory,
 * `useSyncExternalStore`-friendly store with ZERO required dependencies, plus an
 * OPTIONAL persistence adapter the app may install once at start to survive cold
 * starts. Without an adapter the store is session-scoped — the same graceful
 * degradation as `session.ts` (re-login on cold start) and `celebrationStore.ts`.
 * Persistence is fire-and-forget; a storage failure never throws into the UI.
 *
 * Honesty note: this gate decides only whether to SHOW the intro. It never
 * touches auth, never fabricates state, and the owner can always re-open the
 * intro from the login screen (`replayOnboarding`) — so it is informative, never
 * a wall.
 */
import { useSyncExternalStore } from "react"

/** An async key→string store the app may install (e.g. wrapping AsyncStorage). */
export interface OnboardingPersistence {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

const STORAGE_KEY = "w14.onboarding.seen"

let seen = false
const listeners = new Set<() => void>()
let persistence: OnboardingPersistence | null = null

function emit(): void {
  for (const l of listeners) l()
}

/**
 * Install a persistence adapter and hydrate `seen` from it. Safe to call once at
 * app start; without it the intro re-shows after every cold start. Hydration
 * failures are swallowed — worst case the intro plays once more, never a crash.
 */
export async function installOnboardingPersistence(adapter: OnboardingPersistence): Promise<void> {
  persistence = adapter
  try {
    const v = await adapter.getItem(STORAGE_KEY)
    if (v != null && !seen) {
      seen = true
      emit()
    }
  } catch {
    // Read failed — treat as not-yet-seen; the intro simply shows once.
  }
}

/** True once the owner has seen (or skipped) the first-run intro this session. */
export function hasSeenOnboarding(): boolean {
  return seen
}

/**
 * Mark the intro seen — both finishing it and skipping it count. Idempotent; the
 * persisted write (if an adapter is installed) is fire-and-forget.
 */
export function markOnboardingSeen(): void {
  if (seen) return
  seen = true
  emit()
  if (persistence) {
    try {
      const p = persistence.setItem(STORAGE_KEY, "1")
      if (p && typeof p.then === "function") p.then(undefined, () => {})
    } catch {
      // Storage threw synchronously — keep the session-scoped memory, stay quiet.
    }
  }
}

/**
 * Re-arm the intro so the owner can watch it again (the "kennenlernen" link on
 * the login screen). Session-scoped only — it does not clear the persisted flag,
 * so the intro will not reappear unprompted on the next cold start.
 */
export function replayOnboarding(): void {
  if (!seen) return
  seen = false
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive view of the first-run flag for screens (useSyncExternalStore). */
export function useOnboardingSeen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => seen,
    () => seen,
  )
}

/** TEST/DEV only — reset the in-memory flag (does not touch persistence). */
export function resetOnboardingForTest(): void {
  seen = false
  emit()
}
