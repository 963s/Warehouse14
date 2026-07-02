/**
 * useCachedQuery — `useQuery`, but it remembers across remounts and (with an
 * adapter installed) across cold starts.
 *
 * The base `useQuery` already does stale-while-revalidate, but its last-good
 * data evaporates when the component unmounts. On a phone in a shop that's the
 * common case: switch tabs, come back, and a finance card is blank until the
 * cloud answers — which, offline, is never. This hook closes that gap by sitting
 * the durable `read-cache` under `useQuery`:
 *
 *   • on mount it SEEDS from the cached snapshot for `key` (and hydrates it from
 *     disk if an adapter is installed), so the surface paints real numbers
 *     instantly instead of a skeleton,
 *   • every successful fetch WRITES its payload back to the cache,
 *   • it exposes the honesty metadata a surface needs to mark the data: `cachedAt`,
 *     `isStale`, and `fromCache` (true while we're showing the seed and the live
 *     fetch hasn't landed yet).
 *
 * It requires a `key` — the cache is keyed, and an un-keyed query has nothing to
 * remember it by. For un-keyed/ephemeral reads, use the base `useQuery`.
 *
 * Honesty rule: the seed is a REAL prior response, never a guess. While it's the
 * thing on screen, `fromCache` is true and the surface should show a StaleBadge
 * with `cachedAt` so the operator knows it's the last-good value, not live.
 */
import { useEffect, useMemo, useRef, useState } from "react"

import {
  DEFAULT_MAX_AGE_MS,
  DEFAULT_STALE_AFTER_MS,
  getCachedRead,
  hydrate,
  isStale as isStaleAt,
  setCachedRead,
} from "./read-cache"
import type { QueryOptions, QueryResult } from "../ui/data/types"
import { useQuery } from "../ui/data/useQuery"

export interface CachedQueryOptions extends QueryOptions {
  /** REQUIRED for caching — the stable key the snapshot is stored under. */
  key: string
  /**
   * Ignore (and don't seed from) a snapshot older than this. Default 24h —
   * generous, because stale-but-real beats blank and the marker keeps it honest.
   */
  maxAgeMs?: number
  /**
   * Age past which `isStale` flips true so a surface visibly warms the marker.
   * Default 60s.
   */
  staleAfterMs?: number
}

export interface CachedQueryResult<T> extends QueryResult<T> {
  /** `Date.now()` the shown data was captured, or null if it's a live response with no cache. */
  cachedAt: number | null
  /** True when the data on screen is the cached seed and no live response has landed yet. */
  fromCache: boolean
  /** True when the shown data is older than `staleAfterMs` (drives the StaleBadge tone). */
  isStale: boolean
}

export function useCachedQuery<T>(
  fetcher: () => Promise<T>,
  options: CachedQueryOptions,
): CachedQueryResult<T> {
  const {
    key,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    ...queryOptions
  } = options

  // Read the in-memory snapshot for the CURRENT key, honest about its age.
  const seedFromMemory = (k: string): { data: T; cachedAt: number } | null => {
    const e = getCachedRead<T>(k)
    if (!e) return null
    if (Date.now() - e.cachedAt > maxAgeMs) return null
    return e
  }

  // Seed synchronously so the first paint already has real data (no skeleton
  // flash) when we revisit a screen within a session.
  const [seed, setSeed] = useState<{ data: T; cachedAt: number } | null>(() => seedFromMemory(key))

  // Re-seed DURING RENDER when the key changes (e.g. an entity-detail route param
  // flips A→B), so the surface never shows A's cached numbers on B's screen — the
  // honesty rule. This is React's „adjust state on prop change" pattern; it runs
  // before paint, so there's no flash of the wrong entity.
  const prevKey = useRef(key)
  if (prevKey.current !== key) {
    prevKey.current = key
    setSeed(seedFromMemory(key))
  }

  // On mount / key-change, also try the on-disk store (cold start) if memory was
  // empty for this key.
  useEffect(() => {
    let active = true
    if (getCachedRead<T>(key) == null) {
      void hydrate<T>(key, maxAgeMs).then((e) => {
        // Guard against a late hydrate landing after the key already moved on.
        if (active && e && prevKey.current === key) {
          setSeed({ data: e.data, cachedAt: e.cachedAt })
        }
      })
    }
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, maxAgeMs])

  const q = useQuery<T>(fetcher, { ...queryOptions, key })

  // Persist every fresh success. `updatedAt` advances only on a real response,
  // so keying the write to it captures exactly the live payloads and nothing else.
  //
  // CRITICAL key-change guard: in the very commit where `key` flips A→B, the
  // inner useQuery still holds A's state (its own reset applies a commit later).
  // A naive "updatedAt changed" write would store A's payload under B's cache
  // slot — poisoning B's seed with the previous query's rows. So the guard owns
  // the (key, updatedAt) PAIR: on a key-change commit we only record, never
  // write; B's own success then carries a new stamp and persists correctly.
  const lastPersistRef = useRef<{ key: string; at: number | null }>({ key, at: null })
  useEffect(() => {
    const prev = lastPersistRef.current
    const keyChangedThisCommit = prev.key !== key
    lastPersistRef.current = { key, at: q.updatedAt }
    if (keyChangedThisCommit) return
    if (q.data != null && q.updatedAt != null && q.updatedAt !== prev.at) {
      setCachedRead(key, q.data)
      // The live value is now also the freshest seed, so a sibling mount sees it.
      setSeed({ data: q.data, cachedAt: q.updatedAt })
    }
  }, [q.data, q.updatedAt, key])

  // The value shown: prefer the live response; fall back to the seed while the
  // first live fetch is still outstanding. Never fabricate — both are real.
  const data = q.data ?? seed?.data ?? null
  const fromCache = q.data == null && seed != null
  const cachedAt = q.data != null ? q.updatedAt : (seed?.cachedAt ?? null)

  // While `fromCache`, the surface is showing the REAL last-good seed, so its
  // status is effectively "success" no matter what the live `useQuery` says.
  // Two cases this must cover, both the heart of offline resilience:
  //   • the very first fetch is still in flight → useQuery says "loading"
  //   • the live fetch FAILED (the offline case) → useQuery says "error"
  // In both we have real data on screen, so we must NOT leak a skeleton OR an
  // error state — otherwise a QueryBoundary that branches on `status`, or any
  // surface reading it directly, would hide the cached numbers the cache exists
  // to keep showing. The StaleBadge/OfflineNotice carry the honesty (this is the
  // last-good stand), so reporting "success" here is truthful, not a fabrication.
  const status = fromCache && q.status !== "success" ? "success" : q.status
  const isLoading = fromCache ? false : q.isLoading
  // The live error is suppressed from the surface state while the seed carries
  // the screen (the OfflineNotice tells the real story); it resurfaces naturally
  // the moment there's no seed to fall back on (fromCache === false).
  const error = fromCache ? null : q.error

  const isStale = useMemo(() => isStaleAt(cachedAt, staleAfterMs), [cachedAt, staleAfterMs])

  return {
    ...q,
    data,
    status,
    isLoading,
    error,
    cachedAt,
    fromCache,
    isStale,
  }
}
