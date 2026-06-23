/**
 * Theme preference — the owner's explicit choice: Hell (light) / Dunkel (dark) /
 * System (follow the OS). Persisted across cold starts via the shared app-state
 * adapter. The theme hook reads this to decide which palette to use.
 *
 * Mirrors the onboarding + preferences stores exactly: an in-memory,
 * useSyncExternalStore-friendly store with an OPTIONAL persistence adapter.
 */
import { useSyncExternalStore } from "react"

/** The three modes the owner can pick. */
export type ThemeMode = "light" | "dark" | "system"

/** The persistence port (same shape as onboarding/preferences). */
export interface ThemePreferencePersistence {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

const STORAGE_KEY = "w14.theme.mode"
const DEFAULT_MODE: ThemeMode = "system"

let mode: ThemeMode = DEFAULT_MODE
const listeners = new Set<() => void>()
let persistence: ThemePreferencePersistence | null = null

function emit(): void {
  for (const l of listeners) l()
}

/** Install the persistence adapter + hydrate from disk. Safe to call once at start. */
export async function installThemePreferencePersistence(
  adapter: ThemePreferencePersistence,
): Promise<void> {
  persistence = adapter
  try {
    const v = await adapter.getItem(STORAGE_KEY)
    if (v === "light" || v === "dark" || v === "system") {
      mode = v
      emit()
    }
  } catch {
    // Read failed — keep the default (system).
  }
}

/** The current theme mode. */
export function getThemeMode(): ThemeMode {
  return mode
}

/** Set the theme mode (persists if an adapter is installed). */
export function setThemeMode(next: ThemeMode): void {
  if (next === mode) return
  mode = next
  emit()
  if (persistence) void persistence.setItem(STORAGE_KEY, next).catch(() => {})
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** React hook: subscribe to the theme mode. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => mode, () => mode)
}
