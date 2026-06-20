/**
 * Live notifications store — the Owner OS's single source of truth for the
 * Notifications Center, and the reusable live-update/sync extension the channel
 * surfaces (eBay / WhatsApp / Documents) hang their own „etwas Neues"-nudge off.
 *
 * ── What it is ────────────────────────────────────────────────────────────────
 * A module-level singleton, `useSyncExternalStore`-friendly (mirrors
 * `preferences.ts` / `onboarding.ts` to the letter), that:
 *   • ingests real `LedgerEvent`s from a `LiveSource` (the seam below),
 *   • classifies each into a `Notification` (or drops it) via `classify()`,
 *   • de-dupes by ledger-row id, keeps newest-first, caps the buffer,
 *   • layers per-device read-state on top (a `lastReadId` watermark — every
 *     notification with `id <= lastReadId` reads as read), and
 *   • exposes a tiny reactive surface (items, unreadCount) plus actions
 *     (markAllRead, markRead, refresh).
 *
 * ── The honesty rule ──────────────────────────────────────────────────────────
 * A notification only ever exists because a REAL ledger row exists. The store
 * fabricates nothing: no synthetic „willkommen" row, no placeholder count. Read-
 * state is the only invented bit, and it is explicitly UI state (per device),
 * not a server fact — so it lives here, never in `classify()`.
 *
 * ── The transport seam (no native push dep) ───────────────────────────────────
 * The app ships NO native EventSource and NO native push module, and the phase
 * forbids adding one. So the DEFAULT `LiveSource` is `pollingSource` — a cursor
 * poll over `listLedgerEvents()` (the real `GET /api/ledger`), reusing the same
 * fetch/auth/offline plumbing every other read uses. Two richer transports are
 * scaffolded as DOCUMENTED SEAMS implementing the very same `LiveSource`
 * interface, so either can be dropped in later WITHOUT touching the store, the
 * hooks, or the screen:
 *
 *   1. `sseLiveSource` — opens an EventSource against `GET /api/sse/ledger`
 *      (ADR-0014 §4) for true server push + `Last-Event-ID` replay. Stubbed
 *      because RN has no built-in EventSource; wiring notes are inline below.
 *   2. APNs / push — see `docs/PUSH_NOTIFICATIONS_SEAM` block below: how a real
 *      Apple Push token would feed `ingest()` from a notification tap, with the
 *      exact integration points. Stubbed; no `expo-notifications` dependency is
 *      added in this phase.
 *
 * `setLiveSource(...)` swaps the transport at runtime (tests inject a fake; a
 * later phase injects the SSE one). The store does not care which it is.
 */
import { useSyncExternalStore } from "react"
import type { LedgerEvent } from "@warehouse14/api-client"

import { classify, type Notification, type NotificationItem } from "./types"

// ── Buffer + watermark config ─────────────────────────────────────────────────
/** Hard cap on retained notifications — the Center never needs more, and an
 *  unbounded buffer would leak across a long session. Oldest fall off. */
const MAX_RETAINED = 200

const STORAGE_KEY = "w14.notifications.lastReadId"

// ── The transport seam ────────────────────────────────────────────────────────
/**
 * A live source of ledger events. The store starts/stops ONE source at a time
 * via `start(onBatch)`; the source calls `onBatch(events)` whenever new events
 * arrive (a poll tick, an SSE message, a push tap). `start` returns a teardown.
 *
 * Implementations MUST be idempotent on teardown and must never throw into the
 * store — a transport hiccup degrades to „no new events", never a crash.
 */
export interface LiveSource {
  /** Begin delivering events. Returns a stop() that fully tears the source down. */
  start: (onBatch: (events: LedgerEvent[]) => void) => () => void
  /** Force a one-shot fetch now (drives pull-to-refresh). Optional. */
  refreshNow?: () => Promise<void>
}

/** Optional persistence adapter (same contract as preferences.ts). */
export interface NotificationsPersistence {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

// ── State ─────────────────────────────────────────────────────────────────────
interface LiveState {
  /** Newest-first, de-duped, capped. */
  notifications: readonly Notification[]
  /** Read watermark: every notification with `id <= lastReadId` reads as read. */
  lastReadId: number
  /** Per-id explicit reads ABOVE the watermark (tapping one fresh row). */
  readIds: ReadonlySet<number>
  /** True once the source has delivered at least one batch this session. */
  hydrated: boolean
}

let state: LiveState = {
  notifications: [],
  lastReadId: 0,
  readIds: new Set(),
  hydrated: false,
}

const listeners = new Set<() => void>()
let persistence: NotificationsPersistence | null = null
let source: LiveSource = createPollingSource()
let stop: (() => void) | null = null
let subscriberCount = 0

function emit(): void {
  for (const l of listeners) l()
}

function setState(next: Partial<LiveState>): void {
  state = { ...state, ...next }
  emit()
}

// ── Ingest ────────────────────────────────────────────────────────────────────
/**
 * Fold a batch of raw ledger events into the store. Classifies each, drops the
 * un-notified ones, merges by id (newest wins on a dup), re-sorts newest-first,
 * and caps. Pure-ish: only touches module state + emits. Safe to call from any
 * transport. Exported so a push tap / SSE message / test can feed it directly.
 */
export function ingest(events: LedgerEvent[]): void {
  if (events.length === 0) {
    if (!state.hydrated) setState({ hydrated: true })
    return
  }

  const byId = new Map<number, Notification>()
  for (const n of state.notifications) byId.set(n.id, n)

  let changed = false
  for (const e of events) {
    const n = classify(e)
    if (n == null) continue
    if (!byId.has(n.id)) changed = true
    byId.set(n.id, n)
  }

  if (!changed) {
    if (!state.hydrated) setState({ hydrated: true })
    return
  }

  const merged = Array.from(byId.values())
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_RETAINED)

  setState({ notifications: merged, hydrated: true })
}

// ── Read-state ────────────────────────────────────────────────────────────────
/** True when a given notification id counts as read (watermark OR explicit). */
function isRead(id: number): boolean {
  return id <= state.lastReadId || state.readIds.has(id)
}

/** Mark a single notification read (e.g. on opening its detail). */
export function markRead(id: number): void {
  if (isRead(id)) return
  const next = new Set(state.readIds)
  next.add(id)
  setState({ readIds: next })
}

/**
 * Mark everything currently held as read by raising the watermark to the newest
 * id. Cheap + durable: future older arrivals (a reconnect replay) are also
 * covered, and we don't carry an ever-growing per-id set. Persisted.
 */
export function markAllRead(): void {
  const newest = state.notifications.length > 0 ? state.notifications[0].id : state.lastReadId
  if (newest <= state.lastReadId && state.readIds.size === 0) return
  setState({ lastReadId: Math.max(state.lastReadId, newest), readIds: new Set() })
  persist()
}

/** Count of currently-held notifications that are not yet read. */
export function getUnreadCount(): number {
  let n = 0
  for (const item of state.notifications) if (!isRead(item.id)) n++
  return n
}

// ── Snapshots (memoised so useSyncExternalStore stays tear-free) ──────────────
// useSyncExternalStore demands a STABLE snapshot reference between renders when
// nothing changed. We recompute the derived snapshot only when the underlying
// state object identity changes, and cache it.
let itemsCacheKey: LiveState | null = null
let itemsCache: readonly NotificationItem[] = []

function getItemsSnapshot(): readonly NotificationItem[] {
  if (itemsCacheKey === state) return itemsCache
  itemsCacheKey = state
  itemsCache = state.notifications.map((n) => ({ ...n, read: isRead(n.id) }))
  return itemsCache
}

let countCacheKey: LiveState | null = null
let countCache = 0
function getCountSnapshot(): number {
  if (countCacheKey === state) return countCache
  countCacheKey = state
  countCache = getUnreadCount()
  return countCache
}

// ── Persistence ───────────────────────────────────────────────────────────────
/**
 * Install a persistence adapter and hydrate the read watermark from it. Safe to
 * call once at app start; without it read-state is session-scoped (same graceful
 * degradation as preferences.ts). Failures are swallowed.
 */
export async function installNotificationsPersistence(
  adapter: NotificationsPersistence,
): Promise<void> {
  persistence = adapter
  try {
    const v = await adapter.getItem(STORAGE_KEY)
    if (v != null) {
      const parsed = Number(v)
      if (Number.isFinite(parsed) && parsed > 0) {
        setState({ lastReadId: Math.max(state.lastReadId, parsed) })
      }
    }
  } catch {
    // Bad blob — keep the session watermark; never crash on cold start.
  }
}

function persist(): void {
  if (!persistence) return
  try {
    const p = persistence.setItem(STORAGE_KEY, String(state.lastReadId))
    if (p && typeof p.then === "function") p.then(undefined, () => {})
  } catch {
    // Storage threw synchronously — stay session-scoped, stay quiet.
  }
}

// ── Source lifecycle (reference-counted) ──────────────────────────────────────
/**
 * The store runs the live source only while at least one component is mounted
 * and subscribed (the Center, or a channel surface's live hook, or the bell
 * badge). The first subscriber starts it; the last unsubscribe stops it. This is
 * the polite-by-default contract the data layer already follows — nothing polls
 * the dev backend in the background when no surface cares.
 */
function ensureStarted(): void {
  if (stop != null) return
  try {
    stop = source.start((events) => ingest(events))
  } catch {
    stop = null
  }
}

function maybeStop(): void {
  if (subscriberCount > 0) return
  try {
    stop?.()
  } catch {
    // idempotent teardown — ignore
  }
  stop = null
}

/** Swap the transport at runtime (tests inject a fake; a later phase the SSE one). */
export function setLiveSource(next: LiveSource): void {
  const wasRunning = stop != null
  maybeStopForce()
  source = next
  if (wasRunning && subscriberCount > 0) ensureStarted()
}

function maybeStopForce(): void {
  try {
    stop?.()
  } catch {
    /* ignore */
  }
  stop = null
}

/** Force a one-shot refresh (pull-to-refresh). No-op if the source can't. */
export async function refresh(): Promise<void> {
  try {
    await source.refreshNow?.()
  } catch {
    // A failed manual refresh is non-fatal — the connection banner already
    // reflects transport health; we keep the last good notifications on screen.
  }
}

// ── Subscription ──────────────────────────────────────────────────────────────
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  subscriberCount++
  ensureStarted()
  return () => {
    listeners.delete(cb)
    subscriberCount = Math.max(0, subscriberCount - 1)
    maybeStop()
  }
}

// ── React hooks ───────────────────────────────────────────────────────────────
/** The full notification feed (newest-first, with read flags) for the Center. */
export function useNotificationItems(): readonly NotificationItem[] {
  return useSyncExternalStore(subscribe, getItemsSnapshot, getItemsSnapshot)
}

/** Just the unread badge count — for the bell + channel surfaces. */
export function useUnreadCount(): number {
  return useSyncExternalStore(subscribe, getCountSnapshot, getCountSnapshot)
}

/** Whether the source has delivered its first batch this session (drives skeletons). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.hydrated,
    () => state.hydrated,
  )
}

// ── DEV/TEST seam ─────────────────────────────────────────────────────────────
/** Reset the store to pristine (does not touch persistence). */
export function __resetLiveStore(): void {
  maybeStopForce()
  state = { notifications: [], lastReadId: 0, readIds: new Set(), hydrated: false }
  itemsCacheKey = null
  countCacheKey = null
  emit()
}

// ── Default transport: cursor polling over the real ledger read ───────────────
/**
 * The dependency-free default. Polls `listLedgerEvents()` on a polite interval
 * while the store has subscribers, tracks the highest id it has emitted, and
 * forwards every batch to the store (which de-dupes anyway, so an overlap is
 * harmless). The poll PAUSES implicitly when the last subscriber leaves (the
 * store stops the source), so it never burns the LAN dev backend in the
 * background — the same discipline `useQuery`'s polling follows.
 *
 * Import is lazy (inside `start`) to dodge a module-load cycle: api.ts →
 * (nothing back here), but keeping the import local also means a test that
 * injects its own source never even resolves the real api module.
 */
const POLL_INTERVAL_MS = 20_000
const POLL_PAGE_SIZE = 50

export function createPollingSource(intervalMs: number = POLL_INTERVAL_MS): LiveSource {
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false
  let stopped = false

  // Resolve the real fetch lazily so this module has no static import of api.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchEvents: ((opts: { limit?: number }) => Promise<LedgerEvent[]>) | null = null
  function getFetcher(): ((opts: { limit?: number }) => Promise<LedgerEvent[]>) | null {
    if (fetchEvents) return fetchEvents
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const api = require("../api") as {
        listLedgerEvents: typeof import("../api").listLedgerEvents
      }
      fetchEvents = api.listLedgerEvents
    } catch {
      fetchEvents = null
    }
    return fetchEvents
  }

  async function tick(onBatch: (events: LedgerEvent[]) => void): Promise<void> {
    if (inFlight || stopped) return
    const fetcher = getFetcher()
    if (!fetcher) return
    inFlight = true
    try {
      const events = await fetcher({ limit: POLL_PAGE_SIZE })
      if (!stopped) onBatch(events)
    } catch {
      // Transport failure — the connection store (fed by the underlying api
      // read) already reflects it. Keep the last good notifications; try again
      // next tick. Never throw into the store.
    } finally {
      inFlight = false
    }
  }

  return {
    start(onBatch) {
      stopped = false
      // Immediate first fetch so the Center fills on open, then poll.
      void tick(onBatch)
      timer = setInterval(() => void tick(onBatch), intervalMs)
      // `unref` keeps the process able to exit cleanly under Node (test env).
      if (typeof (timer as { unref?: () => void }).unref === "function") {
        ;(timer as { unref?: () => void }).unref?.()
      }
      return () => {
        stopped = true
        if (timer) clearInterval(timer)
        timer = null
      }
    },
    async refreshNow() {
      // A direct one-shot; the store's `refresh()` awaits this for pull-to-refresh.
      const fetcher = getFetcher()
      if (!fetcher) return
      try {
        const events = await fetcher({ limit: POLL_PAGE_SIZE })
        if (!stopped) ingest(events)
      } catch {
        /* non-fatal — see tick() */
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOCUMENTED SEAM 1 — Server-Sent Events (true push, replay-on-reconnect)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `GET /api/sse/ledger` (ADR-0014 §4) emits every ledger row as an
 * `event: ledger` SSE message and replays missed rows on reconnect via
 * `Last-Event-ID`. Swapping the polling source for this gives instant push and
 * zero-loss reconnect — the Control-Desktop-grade live feed, on the phone.
 *
 * It is NOT wired in this phase because React Native ships no built-in
 * `EventSource`, and the phase forbids adding a native/runtime dependency. To
 * light it up later, with ZERO changes to the store/hooks/screen:
 *
 *   1. Add a streaming transport. Options, cheapest first:
 *        • `react-native-sse` (pure-JS EventSource over XHR) — one small dep.
 *        • Expo's `expo/fetch` streaming `ReadableStream` body + a tiny SSE line
 *          parser (`id:` / `event:` / `data:`), no extra dep.
 *   2. Build the URL + headers from api.ts exactly as the client does:
 *        `${API_BASE_URL}/api/sse/ledger`, with
 *        `Authorization: Bearer ${getSessionToken()}` and
 *        `x-dev-device-fingerprint: ${DEV_DEVICE_FINGERPRINT}` (dev), and the
 *        `Last-Event-ID` header set to the highest id we've ingested.
 *   3. On each `data:` line, `parseLedgerEvent(line)` (exported by api-client) →
 *        `ingest([event])`. On reconnect, the server replays; `ingest` de-dupes.
 *   4. Return a `stop()` that closes the EventSource + clears reconnect timers.
 *
 * Then: `setLiveSource(createSseLiveSource())` once at app start. The polling
 * source remains the offline-friendly fallback.
 */
export function createSseLiveSource(): LiveSource {
  // Intentionally a no-op shell today: it satisfies the LiveSource contract so
  // the wiring above type-checks, but starts nothing. Replace the body per the
  // doc-block above when a streaming transport lands. Until then, callers should
  // keep the polling source (the default).
  return {
    start() {
      return () => {}
    },
    async refreshNow() {
      /* nothing to refresh on an inactive SSE shell */
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOCUMENTED SEAM 2 — Apple Push Notifications (APNs) / OS-level push
// ─────────────────────────────────────────────────────────────────────────────
/**
 * docs/PUSH_NOTIFICATIONS_SEAM
 *
 * Out of scope for this phase (no `expo-notifications` dependency is added), but
 * the integration shape is fixed so a later phase is a drop-in:
 *
 *   • Registration: on login, request permission + obtain the APNs device token,
 *     and POST it to a (future) `/api/devices/:id/push-token` endpoint so the
 *     api-cloud worker can target this phone. The token lifecycle mirrors the
 *     existing per-device identity (devices table); no new auth model.
 *
 *   • Delivery: the worker already emits the alert.* ledger events this store
 *     classifies. A push fan-out step turns a *critical* ledger row into an APNs
 *     payload `{ ledgerId, eventType }` (NOT the full PII payload — push is not a
 *     trusted channel; the body is fetched in-app over the authenticated API).
 *
 *   • Foreground/tap handling: the OS hands the app `{ ledgerId }`. The handler
 *     calls `refresh()` (or a future `fetchLedgerEvent(ledgerId)` → `ingest`) so
 *     the tapped notification is materialised from the AUTHENTICATED ledger read,
 *     then deep-links into the Center / the entity. This keeps the honesty rule:
 *     the push is only a nudge; the shown content is a real authenticated read.
 *
 *   • This file is the single ingestion point (`ingest`) for ALL transports, so
 *     push, SSE, and polling converge here and the rest of the app is unaware of
 *     which delivered an event.
 */
