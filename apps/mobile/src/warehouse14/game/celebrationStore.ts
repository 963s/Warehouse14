/**
 * Celebration memory — remembers which milestones have ALREADY been celebrated,
 * so the gold flood fires exactly once per real crossing and never re-plays on a
 * refetch, remount, or tab-hop.
 *
 * Keyed by a stable milestone key (e.g. `breakeven:2026-06` for June's break-even).
 * The store is in-memory and subscribable (useSyncExternalStore-friendly), so it
 * is correct within a running session with zero dependencies. An OPTIONAL
 * persistence adapter can be installed once at app start to survive cold starts;
 * if none is installed the store simply behaves as session-scoped — the same
 * graceful-degradation philosophy as the haptics + session modules. Persistence
 * failures never throw into the UI (fire-and-forget, swallowed).
 *
 * Honesty note: this store gates the CELEBRATION, never the underlying value. A
 * surface still always shows the real, current break-even state from the data;
 * this only decides whether to play the one-time flourish.
 */

/** An async key→string store the app may install (e.g. wrapping AsyncStorage). */
export interface CelebrationPersistence {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

const STORAGE_PREFIX = "w14.celebrated."

const celebrated = new Set<string>()
const listeners = new Set<() => void>()
let persistence: CelebrationPersistence | null = null
let hydrated = false

function emit(): void {
  for (const l of listeners) l()
}

/**
 * Install a persistence adapter and hydrate the in-memory set from it. Safe to
 * call once at app start; without it the store is session-scoped. Hydration
 * failures are swallowed — the worst case is a milestone celebrates again after
 * a reinstall, never a crash.
 */
export async function installCelebrationPersistence(
  adapter: CelebrationPersistence,
): Promise<void> {
  persistence = adapter
  hydrated = true
}

/** True once a milestone key has been marked celebrated this session (or persisted). */
export function hasCelebrated(key: string): boolean {
  return celebrated.has(key)
}

/**
 * Mark a milestone celebrated. Returns true if THIS call was the first to do so
 * (the caller should play the flourish), false if it was already celebrated.
 * The check-and-set is synchronous so two near-simultaneous callers cannot both
 * win. Persistence, if installed, is written fire-and-forget.
 */
export function markCelebrated(key: string): boolean {
  if (celebrated.has(key)) return false
  celebrated.add(key)
  emit()
  if (persistence) {
    try {
      const p = persistence.setItem(`${STORAGE_PREFIX}${key}`, "1")
      if (p && typeof p.then === "function") p.then(undefined, () => {})
    } catch {
      // Native/storage threw synchronously — stay silent, keep session memory.
    }
  }
  return true
}

/**
 * Hydrate a single key from the persistence adapter (if installed) into the
 * in-memory set, so a milestone celebrated on a previous launch is not replayed.
 * No-op (resolves false) when persistence is absent or the key was not stored.
 */
export async function hydrateCelebrated(key: string): Promise<boolean> {
  if (!persistence || !hydrated) return false
  try {
    const v = await persistence.getItem(`${STORAGE_PREFIX}${key}`)
    if (v != null) {
      if (!celebrated.has(key)) {
        celebrated.add(key)
        emit()
      }
      return true
    }
  } catch {
    // Read failed — treat as not-yet-celebrated; the gate stays safe.
  }
  return false
}

/** Subscribe to celebration-set changes (useSyncExternalStore). */
export function subscribeCelebrations(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** TEST/DEV only — clear the in-memory set (does not touch persistence). */
export function resetCelebrationsForTest(): void {
  celebrated.clear()
  emit()
}

/** The stable milestone key for a given month's break-even (YYYY-MM). */
export function breakEvenKey(monthStart: string): string {
  // monthStart is YYYY-MM-DD; the month identity is its first 7 chars.
  return `breakeven:${monthStart.slice(0, 7)}`
}
