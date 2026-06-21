/**
 * Warehouse14 Owner OS — offline resilience.
 *
 * The pieces that keep the app trustworthy on a patchy shop LAN, built ON TOP of
 * the shared live-data layer (`../ui/data`) rather than replacing it:
 *
 *   read-cache       — durable last-good snapshots of successful reads, keyed by
 *                      query key, with an optional persistence adapter (cold
 *                      start) and honest staleness metadata. Reads only.
 *   useCachedQuery   — `useQuery` that seeds from + writes to the read cache and
 *                      reports `cachedAt` / `fromCache` / `isStale`.
 *   retry-policy     — the pure classifier: which writes may auto-retry (idempotent,
 *                      non-fiscal) and which must NEVER (fiscal / money-movement).
 *   useSafeRetry     — `useMutation` that re-fires a SAFE write on reconnect and
 *                      refuses to touch a fiscal/non-idempotent one.
 *   StaleBadge       — the „Stand vor … / veraltet" marker beside cached values.
 *   OfflineNotice    — the inline, in-context offline note above cached data.
 *
 * Honesty rule throughout: a cached value is a REAL prior response shown with its
 * age, never a fabricated number; a fiscal/money mutation is never queued or
 * auto-fired here.
 */
export {
  installReadCachePersistence,
  hydrate,
  setCachedRead,
  getCachedRead,
  clearCachedRead,
  cacheAge,
  isStale,
  useCachedRead,
  resetReadCacheForTest,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_STALE_AFTER_MS,
  type ReadCachePersistence,
  type CachedEntry,
} from "./read-cache"

export { useCachedQuery, type CachedQueryOptions, type CachedQueryResult } from "./useCachedQuery"

export {
  classifyRetry,
  isSafeToRetry,
  isFiscalMutation,
  isFiscalPath,
  isTransientTransportError,
  describeRetryDecision,
  FISCAL_PATH_PREFIXES,
  type RetryDecision,
  type RetryCandidate,
} from "./retry-policy"

export { useSafeRetry, type SafeRetryOptions, type SafeRetryResult } from "./useSafeRetry"

export { StaleBadge, type StaleBadgeProps } from "./StaleBadge"
export { OfflineNotice, type OfflineNoticeProps } from "./OfflineNotice"
