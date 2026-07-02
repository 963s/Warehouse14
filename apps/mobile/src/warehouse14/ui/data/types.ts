/**
 * Shared vocabulary for the Owner OS live-data layer.
 *
 * Every surface fetches through the same hooks (useQuery / useMultiQuery /
 * useMutation), so the *shape* of a fetch result must be identical everywhere:
 * a surface that knows how to render one query's state can render any query's
 * state. These types are that contract.
 *
 * Honesty rule (app-wide): a value shown to the owner must be a real number
 * from a real endpoint. The status machine below is what lets a surface tell
 * the difference between "loading", "I have data", and "the endpoint failed"
 * WITHOUT ever inventing a number — `data` is `null` until a real response
 * arrives, and `error` is a themed German string the surface can show in a
 * locked / error state.
 */

/**
 * The lifecycle of a single query.
 *
 *   idle     — never started (e.g. a query gated behind `enabled: false`).
 *   loading  — the FIRST load, no data yet. Surfaces show a Skeleton.
 *   success  — `data` holds a real response. May still be re-validating in the
 *              background (see `isFetching`) — the data stays on screen.
 *   error    — the last attempt failed and there is no cached data to show.
 *              Surfaces show an EmptyState / error card with `error`.
 *
 * Note `refreshing` and background polling are NOT separate statuses — a
 * stale-while-revalidate refetch keeps the status at `success` and flips the
 * orthogonal `isFetching` / `isRefreshing` flags instead, so the screen never
 * flickers back to a skeleton on a pull-to-refresh.
 */
export type QueryStatus = "idle" | "loading" | "success" | "error"

/** The full reactive state a surface reads from `useQuery`. */
export interface QueryState<T> {
  /** The last real response, or `null` until one arrives. Never fabricated. */
  data: T | null
  status: QueryStatus
  /** Themed German error message (via `describeError`), or `null`. */
  error: string | null
  /** The raw thrown value behind `error`, for `instanceof` checks (ApiError…). */
  errorCause: unknown
  /** True on the very first load (status === "loading"). */
  isLoading: boolean
  /** True whenever a request is in flight, including background revalidation. */
  isFetching: boolean
  /** True only for a user-initiated pull-to-refresh (drives RefreshControl). */
  isRefreshing: boolean
  /** True after at least one settled attempt (success OR error). */
  isSettled: boolean
  /** `Date.now()` of the last successful response, or `null`. */
  updatedAt: number | null
}

/** The imperative handle returned alongside the state. */
export interface QueryActions {
  /**
   * Re-run the query in the background (stale-while-revalidate). Keeps the
   * current data on screen; resolves when the attempt settles. Safe to call
   * from a button, a websocket nudge, etc.
   */
  refetch: () => Promise<void>
  /**
   * Pull-to-refresh entry point: same as `refetch` but flips `isRefreshing`
   * so a `<RefreshControl>` spins. Wire this to `onRefresh`.
   */
  refresh: () => Promise<void>
}

export type QueryResult<T> = QueryState<T> & QueryActions

/** Options shared by the query hooks. */
export interface QueryOptions {
  /**
   * Stable key for in-flight de-duplication and as the effect dependency that
   * triggers a refetch when it changes (e.g. a search term or an entity id).
   * Two components mounting the same key share ONE in-flight request.
   * Omit for an un-keyed, un-deduped query (still fully functional).
   */
  key?: string
  /** Gate the query off entirely (e.g. until an id is known). Default true. */
  enabled?: boolean
  /**
   * Refetch in the background every time the route regains focus. Default
   * true — this is the "feels live when I come back to the tab" behaviour.
   */
  refetchOnFocus?: boolean
  /**
   * Polite background polling interval in ms while the screen is focused.
   * `0` / undefined disables polling. The poll PAUSES when the route is
   * unfocused or a manual refresh is already running, so it never stacks
   * requests or burns the LAN dev backend in the background.
   */
  pollIntervalMs?: number
  /**
   * Consider data this old (ms) still "fresh" — a focus event within the
   * window is skipped to avoid a refetch storm when tab-hopping. Default
   * 10_000. Set `0` to always refetch on focus.
   */
  staleTimeMs?: number
  /**
   * Keep showing the PREVIOUS key's data while the new key's fetch is in
   * flight (search-as-you-type): the list stays put instead of tearing down
   * to a skeleton on every debounce step. The fresh result replaces it the
   * moment it lands. Default false.
   */
  keepPreviousData?: boolean
  /**
   * Feed this query's settle outcomes into the connection store. Default
   * true. `useMultiQuery` sets false and classifies its PER-SOURCE outcomes
   * itself — its combined fetcher never throws, so the blanket success
   * report would claim "online" while every source failed offline.
   */
  reportConnection?: boolean
}
