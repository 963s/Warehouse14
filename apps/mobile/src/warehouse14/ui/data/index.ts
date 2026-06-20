/**
 * Warehouse14 Owner OS — the live-data layer.
 *
 * The shared hook layer every surface fetches through, wrapping the plain
 * promise-returning calls in `../../api`. One vocabulary for reads and writes
 * so each surface behaves identically: refetch-on-focus, pull-to-refresh,
 * polite background polling, in-flight de-dupe, stale-while-revalidate, and
 * optimistic mutations with rollback. Honesty rule holds throughout — `data`
 * is `null` until a real endpoint responds; nothing here fabricates a value.
 *
 *   useQuery          — one endpoint, the full live behaviour.
 *   useMultiQuery     — fan-out over several endpoints, per-source honest.
 *   useMutation       — writes with optimistic update + rollback.
 *   useRefreshControl — themed <RefreshControl> props from a query.
 *   dedupe            — the in-flight de-dup primitive (advanced / tests).
 *   connection        — the derived online/offline store (no NetInfo): the data
 *                       layer reports every settled read's transport outcome
 *                       here, and the ConnectionBanner mirrors it.
 */
export { useQuery } from "./useQuery"
export { useMultiQuery } from "./useMultiQuery"
export { useMutation } from "./useMutation"
export { useRefreshControl } from "./useRefreshControl"
export { dedupe, isInFlight, clearInFlight } from "./dedupe"
export {
  useConnection,
  useIsOffline,
  isConnectionError,
  reportOnline,
  reportOffline,
  reportQueryOutcome,
  type ConnectionStatus,
  type ConnectionState,
} from "./connection"

export type { QueryStatus, QueryState, QueryActions, QueryResult, QueryOptions } from "./types"
export type { FetcherMap, SourceResult, MultiQueryResults, MultiQueryResult } from "./useMultiQuery"
export type {
  OptimisticConfig,
  MutationOptions,
  MutationState,
  MutationResult,
} from "./useMutation"
export type { RefreshableQuery, RefreshControlProps } from "./useRefreshControl"
