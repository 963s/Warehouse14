/**
 * LiveAlertsSection — the „Jetzt"-Schicht at the top of the Notifications Center.
 *
 * Where the rest of the Center is a HISTORY feed of classified `ledger_events`,
 * this section shows the owner what is true RIGHT NOW: a Verkauf paused for a
 * Freigabe, the next Termin, a Hintergrund-Job stuck in the DLQ, the TSE-cert
 * Vorlauf running low. Those are live COUNTS, not log lines — they come from the
 * one bridge snapshot (`GET /api/bridge/summary`, ADMIN) the Schatzkammer board
 * already reads. `deriveLiveAlerts` (pure, in `live-alerts.ts`) turns one real
 * snapshot into the alerts it warrants; this component fetches the snapshot and
 * renders them, tap-through and all.
 *
 * Built entirely on the shared spine (DESIGN.md):
 *   • the live-data layer (`useQuery`) fetches `bridgeSummary` with polite
 *     polling + refetch-on-focus, so the section freshens itself while open —
 *     the same hook every owner read uses. No second transport.
 *   • a `SectionCard` titled „Jetzt", each alert a row with a severity accent
 *     rail + a soft-disc channel glyph + the live count + a deep-link chevron.
 *   • the four states render honestly: a shaped skeleton on first load, a calm
 *     „alles ruhig" line when nothing needs the owner, a non-blocking inline note
 *     if the snapshot read fails (the history feed below still stands), never a
 *     fabricated count.
 *   • §7 haptics: selection on tapping a row that navigates.
 *
 * Honesty rule: every figure is the snapshot's own number; an alert appears only
 * because a real field crossed a real threshold (the thresholds mirror the
 * server's `deriveStatus`). German throughout; de-DE times via the pure helper.
 */
import { useCallback, useMemo } from "react"
import { View } from "react-native"
import { type Href, useRouter } from "expo-router"
import {
  BadgeEuro,
  BellRing,
  CalendarClock,
  ChevronRight,
  Gavel,
  Megaphone,
  Radio,
  ScrollText,
  Server,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import {
  InlineError,
  PressableScale,
  SectionCard,
  Skeleton,
  haptics,
  useQuery,
} from "@/warehouse14/ui"

import { bridgeSummary } from "../api"
import { deriveLiveAlerts, peakSeverity, type LiveAlert } from "./live-alerts"
import type { NotificationChannel, NotificationSeverity } from "./types"

const POLL_MS = 30_000

// ── View mappings (presentation only — the model holds no colours/icons) ───────
/** The soft-disc glyph for an alert's channel — same vocabulary as the feed. */
const CHANNEL_ICON: Record<NotificationChannel, LucideIcon> = {
  approvals: Gavel,
  appointments: CalendarClock,
  fiscal: ScrollText,
  system: Server,
  sales: BadgeEuro,
  compliance: ShieldAlert,
  channels: Megaphone,
}

/** Severity → the theme token a row's accent rail + glyph tint pulls from. */
function severityColor(severity: NotificationSeverity, t: ReturnType<typeof useW14Theme>): string {
  switch (severity) {
    case "critical":
      return t.colors.destructive
    case "action":
      return t.colors.primary
    case "info":
      return t.colors.verdigris
  }
}

// ── One live-alert row ─────────────────────────────────────────────────────────
function LiveAlertRow({ alert, onPress }: { alert: LiveAlert; onPress?: () => void }) {
  const t = useW14Theme()
  const accent = severityColor(alert.severity, t)
  const Icon = CHANNEL_ICON[alert.channel]
  const tappable = alert.href != null && onPress != null

  const body = (
    <View className="flex-row items-center gap-3">
      {/* Channel glyph in a soft disc tinted to severity. */}
      <View
        className="h-9 w-9 items-center justify-center rounded-md"
        style={{ backgroundColor: accent + "1f" }}
      >
        <Icon size={t.icon.md} color={accent} />
      </View>

      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {alert.title}
          </Text>
          {/* The live count chip only when the alert carries a real figure. */}
          {alert.count != null ? (
            <View
              className="min-w-[20px] items-center justify-center rounded-full px-1.5"
              style={{ height: 18, backgroundColor: accent }}
            >
              <Text
                className="text-2xs font-bold"
                style={{ color: t.colors.primaryForeground }}
                numberOfLines={1}
              >
                {alert.count > 99 ? "99+" : alert.count}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-muted-foreground text-sm" numberOfLines={2}>
          {alert.body}
        </Text>
      </View>

      {tappable ? <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} /> : null}
    </View>
  )

  const a11y = `${alert.title}. ${alert.body}.${tappable ? ` ${alert.hrefLabel}.` : ""}`

  return (
    <View className="flex-row overflow-hidden rounded-md">
      {/* Severity accent rail same language as a feed row. */}
      <View style={{ width: 3, borderRadius: 2, backgroundColor: accent }} />
      <View className="flex-1 pl-3">
        {tappable ? (
          <PressableScale accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress}>
            {body}
          </PressableScale>
        ) : (
          <View accessibilityRole="text" accessibilityLabel={a11y}>
            {body}
          </View>
        )}
      </View>
    </View>
  )
}

// ── First-load skeleton — the section's own shape ──────────────────────────────
function LiveAlertsSkeleton() {
  return (
    <SectionCard title="Jetzt" icon={Radio}>
      {[0, 1].map((i) => (
        <View key={i} className="flex-row items-center gap-3 py-1">
          <Skeleton width={36} height={36} radius="button" />
          <View className="flex-1 gap-2">
            <Skeleton width="52%" height={14} />
            <Skeleton width="80%" height={12} />
          </View>
        </View>
      ))}
    </SectionCard>
  )
}

// ── The section ────────────────────────────────────────────────────────────────
export interface LiveAlertsSectionProps {
  /** Inject „now" for deterministic appointment phrasing (tests). */
  now?: Date
}

/**
 * The owner's live status section. Drops into the top of the Center (and could
 * sit on the dashboard too). Self-contained: it owns its own `bridgeSummary`
 * query, so the host screen just renders it.
 */
export function LiveAlertsSection({ now }: LiveAlertsSectionProps) {
  const t = useW14Theme()
  const router = useRouter()
  const q = useQuery(bridgeSummary, { key: "notifications.live-alerts", pollIntervalMs: POLL_MS })

  const alerts = useMemo(
    () => (q.data ? deriveLiveAlerts(q.data, now) : []),
    [q.data, now],
  )
  const peak = useMemo(() => peakSeverity(alerts), [alerts])

  const onOpen = useCallback(
    (alert: LiveAlert) => {
      if (alert.href == null) return
      haptics.selection()
      router.push(alert.href as Href)
    },
    [router],
  )

  // First load, nothing yet → a skeleton in the section's shape (never a spinner).
  if (q.isLoading && q.data == null) {
    return <LiveAlertsSkeleton />
  }

  // The snapshot read failed and we have nothing to show → a calm non-blocking
  // note. The history feed below is unaffected, so we never take over the screen.
  if (q.data == null) {
    return (
      <View className="pb-1">
        <InlineError
          message={q.error ?? "Live-Status konnte nicht geladen werden."}
          onRetry={() => void q.refetch()}
        />
      </View>
    )
  }

  const peakColor = peak ? severityColor(peak, t) : t.colors.verdigris

  return (
    <SectionCard
      title="Jetzt"
      subtitle="Was gerade deine Aufmerksamkeit braucht live aus dem System."
      icon={Radio}
      action={
        alerts.length > 0 ? (
          <View
            className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ backgroundColor: peakColor + "1f" }}
          >
            <BellRing size={t.icon.xs} color={peakColor} />
            <Text className="text-2xs font-bold" style={{ color: peakColor }}>
              {alerts.length}
            </Text>
          </View>
        ) : null
      }
    >
      {alerts.length > 0 ? (
        alerts.map((alert) => (
          <LiveAlertRow
            key={alert.kind}
            alert={alert}
            onPress={alert.href != null ? () => onOpen(alert) : undefined}
          />
        ))
      ) : (
        // Honest "all calm" — nothing crossed a threshold, so no row is invented.
        <View className="flex-row items-center gap-2 py-1">
          <View
            className="h-7 w-7 items-center justify-center rounded-md"
            style={{ backgroundColor: t.colors.verdigris + "1f" }}
          >
            <Radio size={t.icon.sm} color={t.colors.verdigris} />
          </View>
          <Text className="text-muted-foreground text-sm" style={{ flexShrink: 1 }}>
            Alles ruhig keine offenen Freigaben, Termine oder Systemhinweise.
          </Text>
        </View>
      )}
    </SectionCard>
  )
}
