/**
 * Notification hooks — the small reactive surface the screen, the bell badge,
 * and the channel surfaces (eBay / WhatsApp / Documents) consume. Thin wrappers
 * over the live store so every consumer shares ONE feed, ONE read-state, and ONE
 * running transport (the store reference-counts the source — see live-store.ts).
 *
 *   useNotifications()        — the Center's everything: items + counts + actions.
 *   useUnreadCount()          — re-exported: the bell badge (store-level hook).
 *   useChannelLive(channel)   — the LIVE-UPDATE EXTENSION a channel surface
 *                               subscribes to. It returns the latest live event
 *                               id for that channel, so an eBay/WhatsApp/Documents
 *                               list can refetch itself the instant something
 *                               relevant lands — without each surface re-opening
 *                               its own stream. One transport, many subscribers.
 *
 * Honesty rule: these hooks expose only what the store holds — real, classified
 * ledger events and the per-device read flag. Nothing is fabricated.
 */
import { useMemo } from "react"

import {
  getUnreadCount,
  markAllRead,
  markRead,
  refresh,
  useHydrated,
  useNotificationItems,
  useUnreadCount,
} from "./live-store"
import {
  CHANNEL_ORDER,
  SEVERITY_WEIGHT,
  type NotificationChannel,
  type NotificationItem,
} from "./types"

export { useUnreadCount }

/** A channel + its unread tally, for the filter bar's per-tab badge. */
export interface ChannelTally {
  channel: NotificationChannel
  total: number
  unread: number
}

/** The Center's full reactive view. */
export interface NotificationsView {
  /** Newest-first, with read flags. The honest, real feed. */
  items: readonly NotificationItem[]
  /** Total unread across all channels. */
  unread: number
  /** Whether the first batch has landed (drives the first-load skeleton). */
  hydrated: boolean
  /** Per-channel totals + unread, in stable `CHANNEL_ORDER`, only for present channels. */
  channels: readonly ChannelTally[]
  /** True when there is at least one critical, unread notification (loud states). */
  hasCriticalUnread: boolean
  /** Mark a single notification read (on opening its detail). */
  markRead: (id: number) => void
  /** Raise the read watermark to the newest held id. */
  markAllRead: () => void
  /** Force a one-shot refresh (pull-to-refresh). */
  refresh: () => Promise<void>
}

/**
 * The Center hook. Subscribes to the store (which starts the live source on the
 * first subscriber) and derives the per-channel tallies + flags the screen needs.
 */
export function useNotifications(): NotificationsView {
  const items = useNotificationItems()
  const unread = useUnreadCount()
  const hydrated = useHydrated()

  const channels = useMemo<ChannelTally[]>(() => {
    const totals = new Map<NotificationChannel, { total: number; unread: number }>()
    for (const item of items) {
      const cur = totals.get(item.channel) ?? { total: 0, unread: 0 }
      cur.total++
      if (!item.read) cur.unread++
      totals.set(item.channel, cur)
    }
    return CHANNEL_ORDER.filter((c) => totals.has(c)).map((channel) => ({
      channel,
      total: totals.get(channel)!.total,
      unread: totals.get(channel)!.unread,
    }))
  }, [items])

  const hasCriticalUnread = useMemo(
    () => items.some((i) => !i.read && i.severity === "critical"),
    [items],
  )

  return {
    items,
    unread,
    hydrated,
    channels,
    hasCriticalUnread,
    markRead,
    markAllRead,
    refresh,
  }
}

/**
 * The live-update extension reused by eBay / WhatsApp / Documents.
 *
 * A channel surface calls `useChannelLive("channels")` (or any channel) and gets
 * back a small signal it can watch to know „something relevant just happened":
 *   • `latestId`     — the id of the newest live event in that channel (changes
 *                      when a new one arrives). Put it in a `useEffect` dep to
 *                      trigger a `query.refetch()`.
 *   • `unread`       — that channel's unread count (a dot on the surface's tab).
 *   • `latest`       — the newest item itself, for an inline „neu"-toast.
 *
 * This is the whole point of the shared transport: the eBay screen does NOT open
 * its own SSE/poll; it piggybacks on the one the notifications store already
 * runs, and simply reacts to the slice it cares about. Subscribing here also
 * keeps the source alive while that surface is mounted.
 */
export interface ChannelLive {
  latestId: number | null
  latest: NotificationItem | null
  unread: number
  total: number
}

export function useChannelLive(channel: NotificationChannel): ChannelLive {
  const items = useNotificationItems()
  return useMemo<ChannelLive>(() => {
    let latest: NotificationItem | null = null
    let unread = 0
    let total = 0
    for (const item of items) {
      if (item.channel !== channel) continue
      total++
      if (!item.read) unread++
      // items are newest-first, so the first match is the latest.
      if (latest == null) latest = item
    }
    return { latestId: latest?.id ?? null, latest, unread, total }
  }, [items, channel])
}

/**
 * Non-React snapshot of the unread count — for a place that needs it imperatively
 * (e.g. setting an app icon badge in a future push integration). Re-exported from
 * the store so callers import from one module.
 */
export { getUnreadCount }

/**
 * Sort comparator the Center uses: loudest-first within a timestamp tie, then
 * newest-first. Exposed so the screen and tests agree. (The store keeps the feed
 * strictly newest-first; the screen may re-sort a filtered slice by severity.)
 */
export function compareForDisplay(a: NotificationItem, b: NotificationItem): number {
  const sev = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
  if (sev !== 0) return sev
  return b.id - a.id
}
