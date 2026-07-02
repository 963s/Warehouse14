/**
 * useQuery — the one hook every Owner OS surface fetches a single endpoint
 * through. It wraps a plain `() => Promise<T>` from `../../api` and adds the
 * behaviour that makes the app feel native and live:
 *
 *   • first-load skeleton state, then stale-while-revalidate (data never
 *     flickers back to a skeleton on a refetch),
 *   • refetch-on-focus (the screen freshens when you return to the tab),
 *   • pull-to-refresh state (drives <RefreshControl> via `isRefreshing`),
 *   • polite background polling that PAUSES off-focus / mid-refresh,
 *   • in-flight de-dupe so two mounts of the same key share one request,
 *   • a mounted-guard so a late response never calls setState after unmount,
 *   • themed German errors via `describeError`,
 *   • the offline-queued-as-success semantic (ApiOfflineQueuedError is not an
 *     error to a read; we simply keep the last good data).
 *
 * Honesty rule: `data` stays `null` until a real response arrives. A surface
 * binds gauges to `data` and shows a Skeleton/EmptyState otherwise — there is
 * no code path here that yields a fabricated value.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useFocusEffect } from "expo-router"
import { ApiOfflineQueuedError } from "@warehouse14/api-client"

import { reportQueryOutcome, useConnection } from "./connection"
import { dedupe } from "./dedupe"
import type { QueryOptions, QueryResult, QueryState } from "./types"
import { describeError } from "../../api"

const DEFAULT_STALE_MS = 10_000

/**
 * Hard floor on how often a FOCUS event may trigger a refetch for a given key,
 * regardless of `staleTimeMs`. Tab-hopping fires `useFocusEffect` on every
 * return; the per-query stale window already guards the common case, but a key
 * shared by several mounted hooks (or a fan-out that maps to many endpoints)
 * could still re-fire on a rapid blur→focus→blur. This module-level clock
 * collapses those into at most one focus-refetch per window per key, so a
 * jittery navigation can never restart the dashboard's whole fan-out.
 *
 * Only focus-driven refetches are throttled. Manual refetch/refresh, the mount
 * load, and background polling are never gated by this — the operator's intent
 * and the steady heartbeat always go through.
 */
const FOCUS_THROTTLE_MS = 8_000
const lastFocusFetchAt = new Map<string, number>()

/** Test seam — drop the focus-throttle clock. */
export function __resetFocusThrottle(): void {
  lastFocusFetchAt.clear()
}

function initialState<T>(enabled: boolean): QueryState<T> {
  return {
    data: null,
    status: enabled ? "loading" : "idle",
    error: null,
    errorCause: null,
    isLoading: enabled,
    isFetching: false,
    isRefreshing: false,
    isSettled: false,
    updatedAt: null,
  }
}

export function useQuery<T>(fetcher: () => Promise<T>, options: QueryOptions = {}): QueryResult<T> {
  const {
    key,
    enabled = true,
    refetchOnFocus = true,
    pollIntervalMs = 0,
    staleTimeMs = DEFAULT_STALE_MS,
    keepPreviousData = false,
    reportConnection = true,
  } = options

  const [state, setState] = useState<QueryState<T>>(() => initialState<T>(enabled))

  // Refs keep the run loop stable across renders without re-subscribing.
  const mounted = useRef(true)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  // Monotonic id so only the LATEST run is allowed to commit (drops stale
  // responses when the key changes mid-flight).
  const runId = useRef(0)
  const updatedAtRef = useRef<number | null>(null)
  // Mirrors `isFetching` so the poll loop can check it without reading state.
  const fetchingRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /**
   * The single fetch path. `mode` only affects which spinner flag is raised:
   *   "auto"    — initial load / focus / poll: first run shows the skeleton,
   *               later runs revalidate silently.
   *   "refresh" — user pull-to-refresh: raises `isRefreshing`.
   */
  const run = useCallback(
    async (mode: "auto" | "refresh"): Promise<void> => {
      if (!enabled) return
      const id = ++runId.current
      fetchingRef.current = true

      setState((s) => ({
        ...s,
        isFetching: true,
        isRefreshing: mode === "refresh" ? true : s.isRefreshing,
        // First-ever load keeps "loading"; a revalidation keeps prior status.
        status: s.status === "idle" ? "loading" : s.status,
        isLoading: s.data == null,
      }))

      try {
        const exec = () => fetcherRef.current()
        const data = key ? await dedupe(key, exec) : await exec()
        // A real response landed — the cloud is reachable. Report even if a
        // newer run has superseded us; the wire being up is still true.
        // (useMultiQuery opts out: its combined fetcher never throws, so it
        // classifies per-source outcomes itself.)
        if (reportConnection) reportQueryOutcome(null)
        if (!mounted.current || id !== runId.current) return
        updatedAtRef.current = Date.now()
        setState({
          data,
          status: "success",
          error: null,
          errorCause: null,
          isLoading: false,
          isFetching: false,
          isRefreshing: false,
          isSettled: true,
          updatedAt: updatedAtRef.current,
        })
      } catch (err) {
        // Feed the connection store first, before the run-ownership guard, so a
        // superseded run's network signal is never lost. A read that fell
        // through to the offline queue (ApiOfflineQueuedError) is itself
        // classified as a connection error → the banner shows.
        if (reportConnection) reportQueryOutcome(err)
        if (!mounted.current || id !== runId.current) return
        // A read that got offline-queued is not a failure — keep last good
        // data and just stop the spinners. (Mutations handle this differently.)
        if (err instanceof ApiOfflineQueuedError) {
          setState((s) => ({
            ...s,
            isFetching: false,
            isRefreshing: false,
            isLoading: false,
            isSettled: true,
            status: s.data != null ? "success" : s.status,
          }))
          return
        }
        setState((s) => ({
          ...s,
          // Keep showing cached data on a background failure; only flip the
          // whole surface to "error" when we have nothing to show.
          status: s.data != null ? "success" : "error",
          error: describeError(err),
          errorCause: err,
          isLoading: false,
          isFetching: false,
          isRefreshing: false,
          isSettled: true,
        }))
      } finally {
        // Only the latest run owns the flag; a superseded run must not clear
        // the `true` a newer run already set.
        if (id === runId.current) fetchingRef.current = false
      }
    },
    [enabled, key, reportConnection],
  )

  // Reset when the key changes or the query is toggled on/off, so we never
  // show entity A's data for B. With `keepPreviousData` (search-as-you-type),
  // the PREVIOUS key's rows stay on screen while the new key's fetch runs —
  // no skeleton teardown per keystroke; the fresh result replaces them.
  useEffect(() => {
    runId.current++
    updatedAtRef.current = null
    setState((s) =>
      keepPreviousData && s.data != null
        ? {
            ...s,
            status: "success",
            error: null,
            errorCause: null,
            isLoading: false,
            isFetching: enabled,
            isRefreshing: false,
          }
        : initialState<T>(enabled),
    )
    if (enabled) void run("auto")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  // Refetch-on-focus, with a stale-time guard so tab-hopping doesn't storm the
  // backend. `useFocusEffect` runs on focus and its cleanup runs on blur.
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !refetchOnFocus) return
      // Don't double-fire on the very first focus (the mount effect's load is
      // already in flight), and don't refetch data that's still fresh.
      if (fetchingRef.current) return
      const now = Date.now()
      const age = updatedAtRef.current == null ? Infinity : now - updatedAtRef.current
      if (age < staleTimeMs) return
      // Hard focus-throttle floor, keyed by the query key: a rapid blur→focus
      // dance (or several mounts sharing one key) can re-enter this within the
      // stale window's blind spot. Collapse those into one focus-refetch per
      // window per key so a jittery navigation can't restart a whole fan-out.
      if (key) {
        const lastFocus = lastFocusFetchAt.get(key)
        if (lastFocus != null && now - lastFocus < FOCUS_THROTTLE_MS) return
        lastFocusFetchAt.set(key, now)
      }
      void run("auto")
    }, [enabled, refetchOnFocus, staleTimeMs, key, run]),
  )

  // Polite polling: only while focused, never stacking on top of an in-flight
  // request, paused entirely when the screen is blurred.
  useFocusEffect(
    useCallback(() => {
      if (!enabled || pollIntervalMs <= 0) return
      const tick = setInterval(() => {
        // Skip a beat if a request (manual or otherwise) is already running.
        if (!fetchingRef.current) void run("auto")
      }, pollIntervalMs)
      return () => clearInterval(tick)
    }, [enabled, pollIntervalMs, run]),
  )

  // Reconnect recovery: the OfflineNotice promises "Aktualisierung erfolgt
  // automatisch" — keep that promise. When the connection store flips back to
  // online (the health probe or any other request succeeded), the FOCUSED
  // screen revalidates its stale data immediately instead of sitting on the
  // pre-outage numbers until the next manual gesture. Blurred screens catch
  // up through the normal refetch-on-focus path.
  const focusedRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      return () => {
        focusedRef.current = false
      }
    }, []),
  )
  const connStatus = useConnection().status
  const prevConnRef = useRef(connStatus)
  useEffect(() => {
    const was = prevConnRef.current
    prevConnRef.current = connStatus
    if (was !== "offline" || connStatus !== "online") return
    if (!enabled || !focusedRef.current || fetchingRef.current) return
    const age = updatedAtRef.current == null ? Infinity : Date.now() - updatedAtRef.current
    if (age < staleTimeMs) return
    void run("auto")
  }, [connStatus, enabled, staleTimeMs, run])

  const refetch = useCallback(() => run("auto"), [run])
  const refresh = useCallback(() => run("refresh"), [run])

  return { ...state, refetch, refresh }
}
