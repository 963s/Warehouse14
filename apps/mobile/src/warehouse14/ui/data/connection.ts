/**
 * connection — the app's honest sense of "can we reach the cloud right now?".
 *
 * The mobile app ships no NetInfo native module, and the honesty rule forbids
 * inventing a connectivity claim. So instead of probing the OS, we DERIVE
 * connectivity from the real outcomes of the reads the surfaces already make:
 * the live-data layer (`useQuery`) reports every settled attempt here.
 *
 *   • a transport-level failure (`ApiNetworkError`) or an open circuit
 *     (`ApiCircuitOpenError`) → we are offline / the cloud is unreachable.
 *   • any successful response, or a normal `ApiError` (the server answered,
 *     it just said no) → we are online; the wire is fine.
 *
 * This is a tiny module-level store with a `useSyncExternalStore` hook, so the
 * ConnectionBanner re-renders the instant the status flips and never tears.
 * It holds NO data and fabricates nothing — it only mirrors what real requests
 * just experienced.
 */
import { useSyncExternalStore } from "react"
import {
  ApiCircuitOpenError,
  ApiError,
  ApiNetworkError,
  ApiOfflineQueuedError,
} from "@warehouse14/api-client"

/**
 * The connection's lifecycle, derived from real request outcomes.
 *
 *   online   — the last transport attempt reached the cloud (2xx or a clean
 *              ApiError from the server). The default before anything is known.
 *   offline  — the last attempt failed at the transport level (DNS / refused /
 *              timeout) or the circuit is open. The banner shows.
 */
export type ConnectionStatus = "online" | "offline"

export interface ConnectionState {
  status: ConnectionStatus
  /** `Date.now()` when we last reached the cloud, or `null` if never this session. */
  lastOnlineAt: number | null
  /** `Date.now()` when we first noticed the current offline streak, or `null`. */
  offlineSince: number | null
}

// Module-level singleton — there is one network, so one source of truth.
let state: ConnectionState = {
  status: "online",
  lastOnlineAt: null,
  offlineSince: null,
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function setState(next: ConnectionState): void {
  // Identity-stable: skip the notify (and the re-render) when nothing changed,
  // so a steady stream of successful polls never churns subscribers.
  if (
    next.status === state.status &&
    next.lastOnlineAt === state.lastOnlineAt &&
    next.offlineSince === state.offlineSince
  ) {
    return
  }
  state = next
  emit()
}

/** A real request reached the cloud. Clears any offline streak. */
export function reportOnline(): void {
  setState({ status: "online", lastOnlineAt: Date.now(), offlineSince: null })
  stopProbe()
}

/** A real request failed at the transport level. Opens / extends the streak. */
export function reportOffline(): void {
  setState({
    status: "offline",
    lastOnlineAt: state.lastOnlineAt,
    // Keep the original streak start so "offline since" doesn't reset on retry.
    offlineSince: state.offlineSince ?? Date.now(),
  })
  startProbe()
}

// ── Reconnect probe ──────────────────────────────────────────────────────────
// Derived-only connectivity has a blind spot: once every surface has failed and
// gone quiet (non-polling screens make no further requests), NOTHING would ever
// notice the wifi coming back — the banner and the stale numbers stick forever.
// So while offline, a lightweight registered probe (a plain /health ping,
// wired up in api.ts) runs every PROBE_INTERVAL_MS; the first success flips the
// store online, which stops the probe and lets useQuery's reconnect effect
// revalidate the focused screen. Still zero fabrication: the flip only ever
// comes from a REAL round-trip.

const PROBE_INTERVAL_MS = 10_000

type ConnectionProbe = () => Promise<void>
let probe: ConnectionProbe | null = null
let probeTimer: ReturnType<typeof setInterval> | null = null
let probeInFlight = false

/** Register the health-ping used while offline (called once from api.ts). */
export function setConnectionProbe(fn: ConnectionProbe): void {
  probe = fn
  // If we were already offline when the probe got registered, start it now.
  if (state.status === "offline") startProbe()
}

function startProbe(): void {
  if (probeTimer != null || probe == null) return
  probeTimer = setInterval(() => {
    if (probeInFlight || probe == null) return
    probeInFlight = true
    probe()
      .then(() => reportOnline())
      .catch(() => {
        // Still unreachable — keep probing.
      })
      .finally(() => {
        probeInFlight = false
      })
  }, PROBE_INTERVAL_MS)
}

function stopProbe(): void {
  if (probeTimer != null) {
    clearInterval(probeTimer)
    probeTimer = null
  }
}

/**
 * Feed a settled query outcome into the connection store. Called by the data
 * layer on every settle. Only transport-level failures move us offline; a
 * server `ApiError` means the wire is fine, so it counts as online.
 *
 *   reportQueryOutcome(null)  → success → online
 *   reportQueryOutcome(err)   → classify the error
 */
export function reportQueryOutcome(error: unknown): void {
  if (error == null) {
    reportOnline()
    return
  }
  if (isConnectionError(error)) {
    reportOffline()
    return
  }
  // The server answered (ApiError) or some other non-transport issue — the
  // network itself is reachable.
  reportOnline()
}

/**
 * True when a thrown value means we could not reach the cloud (vs the server
 * answering with a refusal). A transport failure, an open circuit, or a read
 * that fell through to the offline queue all count.
 */
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof ApiNetworkError ||
    error instanceof ApiCircuitOpenError ||
    error instanceof ApiOfflineQueuedError
  )
}

/**
 * True when a thrown value is a server "this record does not exist" (HTTP 404 /
 * `NOT_FOUND`). On many surfaces a missing record is a NORMAL outcome, not a
 * failure: a deep-link to an item that was deleted, a detail opened for an id
 * the server no longer has, a freshly-created entity not yet visible. Those
 * deserve a calm German empty state ("nicht gefunden"), never a red error card.
 *
 * Surfaces and `QueryBoundary` use this to route a 404-with-no-data into the
 * empty branch instead of the error branch. It does NOT change honesty: we
 * still show nothing fabricated — just a calmer frame around a real absence.
 */
export function isNotFoundError(error: unknown): boolean {
  return (
    (error instanceof ApiError && (error.code === "NOT_FOUND" || error.httpStatus === 404)) === true
  )
}

/**
 * True when a thrown value is the server's rate-limit refusal (HTTP 429 /
 * `RATE_LIMITED`). The transport layer already backs these off and honours
 * `Retry-After`, so a 429 only reaches the UI when the budget stays exhausted
 * past every retry. A surface uses this to present a CALM „einen Moment"
 * waiting state ("Zu viele Anfragen — gleich wieder da") instead of a red error
 * card — it is a transient throttle, not a fault the owner caused.
 */
export function isRateLimited(error: unknown): boolean {
  return (
    (error instanceof ApiError && (error.code === "RATE_LIMITED" || error.httpStatus === 429)) ===
    true
  )
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ConnectionState {
  return state
}

/**
 * Subscribe a component to the connection store. Re-renders only when the
 * status (or its timestamps) actually changes.
 */
export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Convenience: just the boolean every banner-conditional wants. */
export function useIsOffline(): boolean {
  return useConnection().status === "offline"
}

/** Test/diagnostic seam — reset the store to its pristine online state. */
export function __resetConnection(): void {
  state = { status: "online", lastOnlineAt: null, offlineSince: null }
  emit()
}
