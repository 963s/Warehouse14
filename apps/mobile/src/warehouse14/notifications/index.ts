/**
 * Notifications — the Owner OS in-app alert spine.
 *
 * One barrel for the whole feature so surfaces pull a single import:
 *
 *   import { useNotifications, useUnreadCount, useChannelLive } from
 *     "@/warehouse14/notifications"
 *
 * Layers (each its own file, each independently testable):
 *   types.ts        — the Notification model + the pure ledger→notification
 *                     classifier + German labels + relativeTime.
 *   live-store.ts   — the singleton live-update/sync store (useSyncExternalStore),
 *                     the `LiveSource` transport seam (default cursor-poll, with
 *                     documented SSE + APNs seams), read-state + persistence.
 *   useNotifications.ts — the reactive hooks the screen + bell + channel surfaces
 *                     consume (useNotifications / useChannelLive / useUnreadCount).
 *
 * Honesty rule holds end to end: every notification is a real, classified ledger
 * row; read-state is the only per-device UI bit and is explicitly modelled as
 * such. No native push dependency is added in this phase — push is a documented
 * seam in live-store.ts.
 */

// Model + classifier + labels.
export {
  classify,
  relativeTime,
  CHANNEL_ORDER,
  CHANNEL_LABELS,
  SEVERITY_WEIGHT,
  NOTIFIED_EVENT_TYPES,
  type Notification,
  type NotificationItem,
  type NotificationChannel,
  type NotificationSeverity,
} from "./types"

// Store: hooks + actions + the transport seam + persistence.
export {
  // hooks
  useNotificationItems,
  useUnreadCount,
  useHydrated,
  // actions
  ingest,
  markRead,
  markAllRead,
  refresh,
  getUnreadCount,
  // transport seam
  setLiveSource,
  createPollingSource,
  createSseLiveSource,
  type LiveSource,
  // persistence
  installNotificationsPersistence,
  type NotificationsPersistence,
  // dev/test
  __resetLiveStore,
} from "./live-store"

// Reactive views for the screen, the bell, and the channel surfaces.
export {
  useNotifications,
  useChannelLive,
  compareForDisplay,
  type NotificationsView,
  type ChannelTally,
  type ChannelLive,
} from "./useNotifications"

// The header bell with the live unread badge (drop-in for any screen header).
export { NotificationBell, type NotificationBellProps } from "./NotificationBell"

// Live owner alerts — the bridge-snapshot „Jetzt"-Schicht (current STATE, not
// history): approvals waiting, next Termin, worker DLQ, TSE-cert headroom. The
// pure derivation + the drop-in section the Center mounts above its history feed.
export {
  deriveLiveAlerts,
  peakSeverity,
  formatNextAppointment,
  TSE_CRITICAL_DAYS,
  TSE_WATCH_DAYS,
  type LiveAlert,
  type LiveAlertKind,
} from "./live-alerts"
export { LiveAlertsSection, type LiveAlertsSectionProps } from "./LiveAlertsSection"
