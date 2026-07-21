/**
 * read-cache persistence adapter — the on-disk shoulder that turns the read
 * cache from session-scoped into durable across COLD STARTS.
 *
 * `read-cache.ts` deliberately ships with NO required storage dependency: it
 * exposes a tiny `ReadCachePersistence` port (getItem / setItem / optional keys)
 * and behaves session-scoped until an adapter is installed. This module is the
 * one concrete adapter for the mobile app, built over `expo-file-system` — a
 * dependency the app ALREADY has, so we add no native module and no build risk.
 *
 * Why a file adapter (not AsyncStorage): the app pins no AsyncStorage/MMKV
 * native module, and `expo-file-system`'s new synchronous `File` API gives us a
 * clean key→blob store with the exact three operations the port needs. Each
 * cached read is one small JSON file under a private cache subdirectory:
 *
 *   <cacheDir>/w14-read-cache/<safe-name>.json
 *
 * Cache directory (not document): these are last-good READ snapshots — real,
 * but disposable. If the OS reclaims them under storage pressure we simply fall
 * back to a fresh fetch, exactly the module's graceful-degradation contract. We
 * never put fiscal/money records here (those are GoBD, server-side, in the
 * api-client's own durable outbox) — only read payloads keyed by query key.
 *
 * Honesty + safety throughout: every operation is wrapped so a storage failure
 * resolves to "no data" (reads) or is swallowed (writes), never throwing into
 * the UI; a key that can't be encoded to a safe filename simply isn't persisted.
 * The blob is opaque to this layer — staleness + age live in `read-cache.ts`.
 */
import { Directory, File, Paths } from "expo-file-system"

import type { ReadCachePersistence } from "./read-cache"

/** Subdirectory under the OS cache dir that holds the read-cache blobs. */
const CACHE_DIR_NAME = "w14-read-cache"
/** Suffix so a blob is recognisably ours and never collides with a bare key. */
const FILE_SUFFIX = ".json"

/**
 * PII-bearing cache namespaces that must NEVER touch disk (security review
 * 2026-07-21). The on-disk blobs are plaintext JSON, readable off a rooted /
 * imaged phone WITHOUT the device code (which only gates the React UI, not the
 * files). Catalog + prices are low-sensitivity and stay persisted for a fast
 * cold start; anything that can carry a customer's name / address / documents /
 * messages is kept MEMORY-ONLY — it still works within a session, it simply is
 * not written to disk. The most sensitive data (KYC ID images) never reaches
 * the phone at all; it lives server-side, encrypted.
 */
const SENSITIVE_KEY_PREFIXES = [
  "customer", // customer:<id>, customer-orders:<id>, customers list
  "kunde",
  "kyc",
  "ausweis",
  "whatsapp", // customer conversations
  "suche", // global search can surface customer rows
] as const

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEY_PREFIXES.some((p) => k.startsWith(p))
}

/**
 * Encode an arbitrary cache key (which may contain `:`, `/`, spaces, unicode —
 * e.g. `lager:ALL:`) into a filesystem-safe, reversible file name. We percent-
 * encode everything outside a conservative safe set, so two distinct keys can
 * never map to the same file and a key with a path separator can't escape the
 * directory. The reverse (`decodeKey`) restores the original for `keys()`.
 */
function encodeKey(key: string): string {
  // encodeURIComponent leaves a few filename-unfriendly chars (`!*'()`) and
  // keeps `.`; we additionally escape `.` and `*` so the name is fully inert.
  return encodeURIComponent(key).replace(/[.*!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)
}

function decodeKey(fileName: string): string | null {
  if (!fileName.endsWith(FILE_SUFFIX)) return null
  const stem = fileName.slice(0, -FILE_SUFFIX.length)
  try {
    return decodeURIComponent(stem)
  } catch {
    // A foreign file we didn't write — ignore it rather than guess.
    return null
  }
}

/** The cache subdirectory handle (created lazily, idempotently). */
function cacheDir(): Directory {
  return new Directory(Paths.cache, CACHE_DIR_NAME)
}

/** Ensure the subdirectory exists before a write; cheap + idempotent. */
function ensureDir(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
}

/**
 * Build the `ReadCachePersistence` adapter the app installs at start. Pure
 * factory — no side effects until a method is called — so it's safe to construct
 * eagerly in `_layout.tsx`. All three operations are defensively wrapped.
 */
export function createFileReadCachePersistence(): ReadCachePersistence {
  return {
    async getItem(key: string): Promise<string | null> {
      // Sensitive namespaces were never persisted (see below) — a disk hit here
      // would be a stale foreign file; treat as a miss.
      if (isSensitiveKey(key)) return null
      try {
        const file = new File(cacheDir(), encodeKey(key) + FILE_SUFFIX)
        if (!file.exists) return null
        return file.textSync()
      } catch {
        // Missing dir / unreadable blob — treat as a cache miss, never throw.
        return null
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      // PII-bearing reads stay MEMORY-ONLY — never written to disk plaintext.
      if (isSensitiveKey(key)) return
      try {
        const dir = cacheDir()
        ensureDir(dir)
        const file = new File(dir, encodeKey(key) + FILE_SUFFIX)
        // An empty value is the cache's "drop this key" signal (used on evict /
        // clear). Delete the blob rather than leave a zero-length file behind.
        if (value === "") {
          if (file.exists) file.delete()
          return
        }
        file.write(value)
      } catch {
        // Out of space / permission / racing delete — keep the in-memory entry,
        // stay quiet. The next successful write will re-persist it.
      }
    },

    async keys(): Promise<readonly string[]> {
      try {
        const dir = cacheDir()
        if (!dir.exists) return []
        const out: string[] = []
        for (const entry of dir.list()) {
          // Only files we wrote (named <encoded-key>.json) yield a real key.
          if (entry instanceof File) {
            const k = decodeKey(entry.name)
            if (k != null) out.push(k)
          }
        }
        return out
      } catch {
        return []
      }
    },
  }
}
