/**
 * useMultiQuery — fan-out fetch for surfaces that light up from several
 * independent endpoints, like the Schatzkammer dashboard.
 *
 * The honesty rule is per-source: one gauge lights up ONLY when its own
 * endpoint resolved, and a single failing finance read must never blank the
 * whole board. So every source is fetched with `Promise.allSettled` and the
 * result is a map of `{ data | null, error | null }` you can read independently:
 *
 *   const q = useMultiQuery({
 *     bridge: bridgeSummary,
 *     profitDay: () => financeProfit("day"),
 *   }, { pollIntervalMs: 30_000 })
 *   q.results.bridge.data       // BridgeSummary | null  (real or locked)
 *   q.results.profitDay.error   // themed German string | null
 *
 * It reuses the exact same focus / poll / pull-to-refresh / de-dupe machinery
 * as `useQuery` — it is literally a `useQuery` over a combined fetcher — so
 * multi-source surfaces behave identically to single-source ones.
 */
import { useMemo, useRef, useState } from "react"
import { ApiOfflineQueuedError } from "@warehouse14/api-client"

import { isConnectionError, reportOffline, reportOnline } from "./connection"
import { readGate } from "./gate"
import type { QueryActions, QueryOptions, QueryStatus } from "./types"
import { useQuery } from "./useQuery"
import { describeError } from "../../api"
import { getCachedRead, setCachedRead } from "../../offline"

/** A map of named fetchers → their result types. */
export type FetcherMap = Record<string, () => Promise<unknown>>

/** The settled outcome of one source. */
export interface SourceResult<T> {
  /** The real response, or `null` if this source has not (yet) resolved. */
  data: T | null
  /** Themed German error for this source, or `null`. */
  error: string | null
  /** The raw thrown value, for `instanceof` checks. */
  errorCause: unknown
  /** True once this source settled (resolved or rejected) at least once. */
  isSettled: boolean
}

export type MultiQueryResults<M extends FetcherMap> = {
  [K in keyof M]: SourceResult<Awaited<ReturnType<M[K]>>>
}

export interface MultiQueryResult<M extends FetcherMap> extends QueryActions {
  results: MultiQueryResults<M>
  /** "loading" until the first fan-out settles, then "success". */
  status: QueryStatus
  isLoading: boolean
  isFetching: boolean
  isRefreshing: boolean
  isSettled: boolean
  updatedAt: number | null
  /** True if EVERY source failed — the surface may show one error state. */
  allFailed: boolean
  /** True if at least one source resolved with real data. */
  anyData: boolean
}

interface InternalRow {
  data: unknown
  error: string | null
  errorCause: unknown
  isSettled: boolean
}

/**
 * Build the initial live map from the persisted last-good map of a keyed board
 * (see `cacheKey` below). Every value is a REAL response from a prior session —
 * the board paints instantly and the connection banner / background-error line
 * carry the honesty about freshness. Un-keyed boards start empty as before.
 */
function seedFromCache(cacheKey: string | null): Record<string, InternalRow> {
  if (cacheKey == null) return {}
  const entry = getCachedRead<Record<string, unknown>>(cacheKey)
  if (entry == null || entry.data == null || typeof entry.data !== "object") return {}
  const out: Record<string, InternalRow> = {}
  for (const [k, v] of Object.entries(entry.data)) {
    out[k] = { data: v, error: null, errorCause: null, isSettled: true }
  }
  return out
}

export function useMultiQuery<M extends FetcherMap>(
  fetchers: M,
  options: QueryOptions = {},
): MultiQueryResult<M> {
  // Stable key list — callers pass an object literal, but the KEY SET is what
  // matters for the combined fetcher's identity.
  const keys = Object.keys(fetchers)
  const keysSig = keys.join("|")

  // Last good value PER SOURCE, kept across polls. A single source failing a 30s
  // poll round must not blank a gauge that loaded a moment ago — the board keeps
  // its last real values and only a NEVER-resolved source reads empty. (The error
  // is still surfaced so the background „konnte nicht aktualisiert werden" banner
  // stays honest.) Keyed by source name; a source that has never resolved is absent.
  const lastGoodRef = useRef<Record<string, unknown>>({})

  // Durable cold-start seed: the last-good MAP of a keyed board persists via the
  // read-cache, so the Schatzkammer (and every other multi-source board) paints
  // its last real numbers instantly on the next app open instead of a blank
  // skeleton — and still shows THEM (with the offline banner) when the morning
  // starts without a connection. Values are real prior responses, never invented.
  const cacheKey = options.key ? `multi:${options.key}` : null

  // Per-source LIVE results, committed AS EACH SOURCE SETTLES — the board fills
  // gauge by gauge instead of waiting for the slowest of N endpoints (the felt
  // "home screen is the slowest screen" bug). Falls back to the wrapped
  // useQuery's committed map (covers the dedupe-shared-flight case, where our
  // own fetcher instance never runs).
  const [live, setLive] = useState<Record<string, InternalRow>>(() => seedFromCache(cacheKey))
  const liveRunRef = useRef(0)

  // The carry-forward store must AGREE with the seed: if the very first
  // revalidation of a seeded source fails, `prior` comes from lastGoodRef —
  // an empty ref would blank the gauge the seed just painted.
  const seededOnceRef = useRef(false)
  if (!seededOnceRef.current) {
    seededOnceRef.current = true
    for (const [k, row] of Object.entries(live)) {
      if (row.data != null) lastGoodRef.current[k] = row.data
    }
  }

  // Reset the carry-forward + live stores when the query KEY changes. Static-key
  // boards (dashboard, kasse, team, analytics) never hit this. Global Search
  // re-keys per query (`suche:<q>`) — without the reset a transient per-source
  // miss while refining would carry the PREVIOUS query's hits forward. Setting
  // state during render for a prop change is React's sanctioned derived-state
  // form — it re-renders before committing, so no torn frame is ever shown.
  const lastKeyRef = useRef(options.key)
  if (lastKeyRef.current !== options.key) {
    lastKeyRef.current = options.key
    liveRunRef.current++
    const seed = seedFromCache(cacheKey)
    lastGoodRef.current = {}
    for (const [k, row] of Object.entries(seed)) {
      if (row.data != null) lastGoodRef.current[k] = row.data
    }
    setLive(seed)
  }

  // One combined fetcher: settle every source, never throw, so `useQuery`
  // always lands in "success" and we expose per-source errors ourselves.
  //
  // Every source runs through the shared `readGate` so a fan-out of ~10 reads
  // (the Schatzkammer board) lands as a few small waves instead of one burst
  // that overruns the api-cloud's per-minute read budget → no RATE_LIMITED
  // storm. The gate is transparent: it only spaces out WHEN each request fires;
  // each promise still resolves/rejects with exactly its own real outcome.
  const combined = useMemo(
    () => async (): Promise<Record<string, InternalRow>> => {
      const myRun = ++liveRunRef.current
      const out: Record<string, InternalRow> = {}
      let fulfilled = 0
      let connectionFailures = 0

      const commit = (k: string, row: InternalRow): void => {
        out[k] = row
        // Merge into the live map the moment THIS source settles — unless a
        // newer run (key change / newer poll) has taken over.
        if (myRun === liveRunRef.current) {
          setLive((m) => ({ ...m, [k]: row }))
        }
      }

      await Promise.all(
        keys.map((k) =>
          readGate.run(() => fetchers[k]()).then(
            (value) => {
              lastGoodRef.current[k] = value
              fulfilled++
              commit(k, { data: value, error: null, errorCause: null, isSettled: true })
            },
            (reason: unknown) => {
              // Failed (or offline-queued) this round → carry forward the last
              // good value so the gauge never blanks on a transient hiccup.
              if (isConnectionError(reason)) connectionFailures++
              const prior = k in lastGoodRef.current ? lastGoodRef.current[k] : null
              const offline = reason instanceof ApiOfflineQueuedError
              commit(k, {
                data: prior,
                error: offline ? null : describeError(reason),
                errorCause: reason,
                isSettled: true,
              })
            },
          ),
        ),
      )

      // HONEST connection report. The combined fetcher never throws, so the
      // wrapping useQuery would blanket-report "online" — a lie when every
      // source just failed at the transport level (the fully-offline dashboard
      // poll used to CLEAR the offline banner every 30s). We opt the wrapper
      // out (reportConnection: false below) and classify the real outcomes:
      // any fulfilled source = the wire is up; all-transport-failures = offline;
      // all-server-refusals = the wire is still up.
      if (fulfilled > 0) reportOnline()
      else if (keys.length > 0 && connectionFailures === keys.length) reportOffline()
      else if (keys.length > 0) reportOnline()

      // Persist the last-good map for the next cold start (keyed boards only).
      if (cacheKey != null && fulfilled > 0) {
        setCachedRead(cacheKey, { ...lastGoodRef.current })
      }

      return out
    },
    // Re-create only when the set of sources (or the board key) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keysSig, cacheKey],
  )

  const q = useQuery<Record<string, InternalRow>>(combined, {
    ...options,
    reportConnection: false,
  })

  const results = useMemo(() => {
    const out = {} as MultiQueryResults<M>
    for (const k of keys) {
      const row = live[k] ?? q.data?.[k]
      ;(out as Record<string, SourceResult<unknown>>)[k] = row
        ? {
            data: row.data,
            error: row.error,
            errorCause: row.errorCause,
            isSettled: row.isSettled,
          }
        : { data: null, error: null, errorCause: null, isSettled: false }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, q.data, keysSig])

  const rows = keys
    .map((k) => live[k] ?? q.data?.[k])
    .filter((r): r is InternalRow => r != null)
  const anyData = rows.some((r) => r.data != null)
  const allFailed = rows.length === keys.length && rows.length > 0 && rows.every((r) => r.error != null)

  return {
    results,
    status: q.status,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isRefreshing: q.isRefreshing,
    isSettled: q.isSettled,
    updatedAt: q.updatedAt,
    allFailed,
    anyData,
    refetch: q.refetch,
    refresh: q.refresh,
  }
}
