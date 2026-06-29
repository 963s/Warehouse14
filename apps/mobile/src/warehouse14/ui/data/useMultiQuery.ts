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
import { useMemo, useRef } from "react"
import { ApiOfflineQueuedError } from "@warehouse14/api-client"

import { readGate } from "./gate"
import type { QueryActions, QueryOptions, QueryStatus } from "./types"
import { useQuery } from "./useQuery"
import { describeError } from "../../api"

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

  // Reset the carry-forward store when the query KEY changes. Static-key boards
  // (dashboard, kasse, team, analytics) never hit this. Global Search re-keys per
  // query (`suche:<q>`) — without the reset a transient per-source miss while
  // refining would carry the PREVIOUS query's hits forward under the new query.
  const lastKeyRef = useRef(options.key)
  if (lastKeyRef.current !== options.key) {
    lastGoodRef.current = {}
    lastKeyRef.current = options.key
  }

  // One combined fetcher: settle every source, never throw, so `useQuery`
  // always lands in "success" and we expose per-source errors ourselves.
  //
  // Every source runs through the shared `readGate` so a fan-out of ~10 reads
  // (the Schatzkammer board) lands as a few small waves instead of one burst
  // that overruns the api-cloud's per-minute read budget → no RATE_LIMITED
  // storm. The gate is transparent: it only spaces out WHEN each request fires;
  // each promise still resolves/rejects with exactly its own real outcome, so
  // `Promise.allSettled` sees the same per-source result it always did.
  const combined = useMemo(
    () => async (): Promise<Record<string, InternalRow>> => {
      const settled = await Promise.allSettled(
        keys.map((k) => readGate.run(() => fetchers[k]())),
      )
      const out: Record<string, InternalRow> = {}
      keys.forEach((k, i) => {
        const r = settled[i]
        if (r.status === "fulfilled") {
          lastGoodRef.current[k] = r.value
          out[k] = { data: r.value, error: null, errorCause: null, isSettled: true }
        } else {
          // Failed (or offline-queued) this round → carry forward the last good
          // value so the gauge/board never blanks on a transient hiccup. Offline
          // is „no fresh data" (no error); a real failure keeps its error for the
          // background banner. A source that has NEVER resolved stays null.
          const prior = k in lastGoodRef.current ? lastGoodRef.current[k] : null
          const offline = r.reason instanceof ApiOfflineQueuedError
          out[k] = {
            data: prior,
            error: offline ? null : describeError(r.reason),
            errorCause: r.reason,
            isSettled: true,
          }
        }
      })
      return out
    },
    // Re-create only when the set of sources changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keysSig],
  )

  const q = useQuery<Record<string, InternalRow>>(combined, options)

  const results = useMemo(() => {
    const out = {} as MultiQueryResults<M>
    for (const k of keys) {
      const row = q.data?.[k]
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
  }, [q.data, keysSig])

  const rows = q.data ? Object.values(q.data) : []
  const anyData = rows.some((r) => r.data != null)
  const allFailed = rows.length > 0 && rows.every((r) => r.error != null)

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
