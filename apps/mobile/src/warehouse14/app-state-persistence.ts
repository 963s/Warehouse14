/**
 * App-state key/value persistence — the durable shoulder for small flags that
 * MUST survive cold starts (the first-run "seen" gate, the owner's dashboard
 * targets). Reuses the SAME `expo-file-system` `File` API the read-cache
 * adapter already depends on, so we add no native module and no build risk.
 *
 * Each value is one small text file under a private DOCUMENTS subdirectory
 * (not cache — these are user state the OS should not reclaim):
 *
 *   <documents>/w14-app-state/<safe-name>
 *
 * Honesty + safety: every operation is wrapped so a storage failure resolves
 * to "no data" (reads) or is swallowed (writes), never throwing into the UI.
 * A failure degrades to the same graceful behavior as having no adapter
 * (the onboarding intro plays once more; the dashboard goals revert to their
 * real defaults) — it NEVER fabricates state.
 *
 * This is the ONE shared adapter; `onboarding.ts` and `preferences.ts` both
 * install it at app start (their ports are structurally identical).
 */
import { Directory, File, Paths } from "expo-file-system"

/** The minimal port both `onboarding.ts` and `preferences.ts` expect. */
export interface KVPersistence {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

/** Subdirectory under the OS documents dir that holds the app-state values. */
const STATE_DIR_NAME = "w14-app-state"

/**
 * Encode an arbitrary key into a filesystem-safe, reversible file name. We
 * percent-encode everything outside a conservative safe set so two distinct
 * keys never collide and a key with a path separator can't escape the dir.
 */
function encodeKey(key: string): string {
  return encodeURIComponent(key).replace(/[.*!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)
}

/** The state subdirectory handle (created lazily, idempotently). */
function stateDir(): Directory {
  return new Directory(Paths.document, STATE_DIR_NAME)
}

/** Ensure the subdirectory exists before a write; cheap + idempotent. */
function ensureDir(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
}

/**
 * Build the shared key/value adapter. Pure factory — no side effects until a
 * method is called — so it's safe to construct eagerly in `_layout.tsx`.
 */
export function createAppStatePersistence(): KVPersistence {
  return {
    async getItem(key: string): Promise<string | null> {
      try {
        const file = new File(stateDir(), encodeKey(key))
        if (!file.exists) return null
        return file.textSync()
      } catch {
        return null
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      try {
        const dir = stateDir()
        ensureDir(dir)
        const file = new File(dir, encodeKey(key))
        if (value === "") {
          if (file.exists) file.delete()
          return
        }
        file.write(value)
      } catch {
        // Out of space / permission — keep the in-memory value, stay quiet.
      }
    },
  }
}
