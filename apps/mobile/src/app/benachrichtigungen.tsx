/**
 * Benachrichtigungen — the Owner OS Notifications Center.
 *
 * The owner's one place to see everything the business just did that they should
 * notice: a high-value sale waiting for Freigabe, a new Termin, a worker job in
 * the DLQ, a TSE/Compliance alarm. It is the in-app face of the live ledger feed
 * — every row is a REAL, classified `ledger_events` row (see
 * `warehouse14/notifications`), never a fabricated alert.
 *
 * Built entirely on the shared spine (DESIGN.md):
 *   • the live-update store (`useNotifications`) drives a feed that fills on open
 *     and freshens itself while the screen is mounted (the store runs ONE polite
 *     transport, reference-counted — no per-screen stream). No native push dep;
 *     the SSE + APNs transports are documented seams in the store.
 *   • channel filter chips (Alle · Freigaben · Fiskal · …) with per-tab unread
 *     dots, in the sticky header that never scrolls away.
 *   • each row carries a severity accent rail + a soft-disc channel glyph + an
 *     unread dot + a relative German timestamp — the calm, scannable list shape.
 *   • the clean LIST→DETAIL pattern: tapping a row opens a spine-native bottom
 *     sheet with the full title/body, the source event meta, and a deep-link CTA
 *     („Öffnen") that routes to the relevant surface (Freigaben → Kasse, Termin →
 *     Termine, a Kunde/Artikel → its detail). Opening a row marks it read.
 *   • the four list states render through the same skeleton/empty/error vocabulary
 *     every surface uses; pull-to-refresh forces a one-shot live fetch.
 *   • §7 haptics: selection on a filter / row open, success on „Alles gelesen",
 *     impactLight on opening the sheet.
 *
 * Honesty rule: an empty feed shows the calm EmptyState, never an invented alert;
 * read-state is per-device UI state (the store's watermark), explicitly modelled
 * as such and never mistaken for a server fact. German throughout; de-DE times.
 */
import { useCallback, useLayoutEffect, useMemo, useState } from "react"
import { FlatList, Modal, Pressable, RefreshControl, View } from "react-native"
import { type Href, useNavigation, useRouter } from "expo-router"
import {
  BadgeEuro,
  Bell,
  BellRing,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  ExternalLink,
  Gavel,
  Megaphone,
  ScrollText,
  Server,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import {
  CHANNEL_LABELS,
  LiveAlertsSection,
  relativeTime,
  useNotifications,
  type NotificationChannel,
  type NotificationItem,
  type NotificationSeverity,
} from "@/warehouse14/notifications"
import { eventLabel } from "@/warehouse14/audit-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  haptics,
  PressableScale,
  Skeleton,
  StaggerItem,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── View mappings (presentation only — model holds no colours/icons) ──────────
/** The soft-disc glyph for a channel. */
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

/** A short German severity caption for the detail sheet. */
const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  critical: "Kritisch",
  action: "Aktion nötig",
  info: "Information",
}

/**
 * Where „Öffnen" routes for a notification. Deep-links into the surface that
 * resolves it. Falls back to `null` (no CTA) when there is no in-app surface yet
 * — honest: we never offer an „Öffnen" that goes nowhere.
 */
function deepLink(item: NotificationItem): { href: Href; label: string } | null {
  switch (item.channel) {
    case "approvals":
      // No CTA: `kasse.tsx` is the Z-Bon/Schicht surface — it has NO Freigabe UI,
      // and there is no approvals API wrapper to resolve a high-value sale from
      // the phone. The gate lives on the POS / Owner Control Desktop. Routing
      // „Zur Kasse" was an „Öffnen" that goes nowhere; until a real Freigabe
      // surface exists we stay honest and offer none.
      return null
    case "appointments":
      return { href: "/termine" as Href, label: "Zu den Terminen" }
    case "compliance":
      // A flagged customer → its profile, when the event carries a customer id.
      if (item.entityTable === "customers" && item.entityId) {
        return {
          href: { pathname: "/customer/[id]", params: { id: item.entityId } } as Href,
          label: "Kunde öffnen",
        }
      }
      return null
    case "sales":
      // No CTA: a finalized/storno/return sale is a past fiscal fact. `kasse.tsx`
      // shows the day's Z-Bon, not this single beleg, so „Zur Kasse" would not
      // resolve the notification — same „goes nowhere" trap. The amount now reads
      // honestly in the body; we offer no dead tap-through.
      return null
    case "fiscal":
    case "system":
    case "channels":
    default:
      return null
  }
}

// ── Row ───────────────────────────────────────────────────────────────────────
function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const t = useW14Theme()
  const accent = severityColor(item.severity, t)
  const Icon = CHANNEL_ICON[item.channel]

  return (
    <PressableScale
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.body}. ${item.read ? "Gelesen" : "Ungelesen"}.`}
    >
      <Card className="overflow-hidden p-0">
        <View className="flex-row">
          {/* Severity accent rail. */}
          <View style={{ width: 4, backgroundColor: accent }} />
          <View className="flex-1 flex-row items-start gap-3 px-4 py-3.5">
            {/* Channel glyph in a soft disc tinted to severity. */}
            <View
              className="h-9 w-9 items-center justify-center rounded-md"
              style={{ backgroundColor: accent + "1f" }}
            >
              <Icon size={t.icon.md} color={accent} />
            </View>

            <View className="flex-1 gap-0.5">
              <View className="flex-row items-center gap-2">
                <Text
                  className={item.read ? "text-base font-medium" : "text-base font-semibold"}
                  numberOfLines={1}
                  style={{ flexShrink: 1 }}
                >
                  {item.title}
                </Text>
                {/* Unread dot — the calm "neu" marker, no loud fill. */}
                {!item.read ? (
                  <View
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: accent }}
                    accessibilityLabel="ungelesen"
                  />
                ) : null}
              </View>
              <Text className="text-muted-foreground text-sm" numberOfLines={2}>
                {item.body}
              </Text>
              <View className="flex-row items-center gap-2 pt-0.5">
                <Text className="text-muted-foreground text-2xs">
                  {CHANNEL_LABELS[item.channel]}
                </Text>
                <Text className="text-muted-foreground text-2xs">·</Text>
                <Text className="text-muted-foreground text-2xs">
                  {relativeTime(item.createdAt)}
                </Text>
              </View>
            </View>

            <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
          </View>
        </View>
      </Card>
    </PressableScale>
  )
}

// ── Detail sheet (the LIST→DETAIL pattern) ────────────────────────────────────
function DetailSheet({ item, onClose }: { item: NotificationItem; onClose: () => void }) {
  const t = useW14Theme()
  const router = useRouter()
  const insets = useScreenInsets()
  const accent = severityColor(item.severity, t)
  const Icon = CHANNEL_ICON[item.channel]
  const link = deepLink(item)

  const openLink = useCallback(() => {
    if (!link) return
    haptics.selection()
    onClose()
    router.push(link.href)
  }, [link, onClose, router])

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        accessibilityRole="button"
        accessibilityLabel="Schließen"
        onPress={onClose}
      >
        {/* Inner Pressable swallows taps so a tap inside the sheet never dismisses. */}
        <Pressable
          onPress={() => {}}
          className="bg-background border-border gap-4 rounded-t-2xl border-t px-5 pt-5"
          style={{ paddingBottom: insets.stickyBottom }}
        >
          <View className="items-center pb-1">
            <View className="h-1 w-10 rounded-full" style={{ backgroundColor: t.colors.border }} />
          </View>

          <View className="flex-row items-start gap-3">
            <View
              className="h-11 w-11 items-center justify-center rounded-lg"
              style={{ backgroundColor: accent + "1f" }}
            >
              <Icon size={t.icon.lg} color={accent} />
            </View>
            <View className="flex-1 gap-1">
              <Text className="text-lg font-bold" numberOfLines={2}>
                {item.title}
              </Text>
              <View className="flex-row items-center gap-2">
                <Text
                  className="text-2xs font-semibold uppercase"
                  style={{ color: accent, letterSpacing: 0.5 }}
                >
                  {SEVERITY_LABEL[item.severity]}
                </Text>
                <Text className="text-muted-foreground text-2xs">·</Text>
                <Text className="text-muted-foreground text-2xs">
                  {CHANNEL_LABELS[item.channel]}
                </Text>
              </View>
            </View>
          </View>

          <Text className="text-foreground text-base leading-6">{item.body}</Text>

          {/* Source meta — the honest provenance: this is event #N from the ledger. */}
          <View className="bg-card border-border gap-1.5 rounded-xl border px-4 py-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-xs">Zeitpunkt</Text>
              <Text className="text-sm font-medium">
                {new Date(item.createdAt).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-muted-foreground text-xs">Ereignis</Text>
              <Text className="text-sm font-medium" numberOfLines={1} style={{ flexShrink: 1 }}>
                {eventLabel(item.eventType)}
              </Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-xs">Beleg-Nr.</Text>
              <Text className="font-mono-medium text-xs">#{item.id}</Text>
            </View>
          </View>

          <View className="flex-row gap-3 pt-1">
            <Button variant="outline" size="lg" className="h-12 flex-1" onPress={onClose}>
              <Text>Schließen</Text>
            </Button>
            {link != null ? (
              <Button size="lg" className="h-12 flex-1 flex-row gap-1.5" onPress={openLink}>
                <ExternalLink size={t.icon.sm} color={t.colors.primaryForeground} />
                <Text>{link.label}</Text>
              </Button>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ── Channel filter chips ──────────────────────────────────────────────────────
function ChannelFilter({
  value,
  options,
  onChange,
}: {
  value: NotificationChannel | null
  options: readonly { key: NotificationChannel | null; label: string; unread: number }[]
  onChange: (next: NotificationChannel | null) => void
}) {
  const t = useW14Theme()
  return (
    <FlatList
      horizontal
      data={options}
      keyExtractor={(opt) => opt.key ?? "ALL"}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 2 }}
      renderItem={({ item: opt }) => {
        const active = value === opt.key
        return (
          <PressableScale
            onPress={() => {
              haptics.selection()
              onChange(opt.key)
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Filter: ${opt.label}${opt.unread > 0 ? `, ${opt.unread} ungelesen` : ""}`}
          >
            <View
              className="flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5"
              style={{
                borderColor: active ? t.colors.primary : t.colors.border,
                backgroundColor: active ? t.colors.primary : t.colors.card,
              }}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: active ? t.colors.primaryForeground : t.colors.foreground }}
              >
                {opt.label}
              </Text>
              {opt.unread > 0 ? (
                <View
                  className="min-w-[18px] items-center justify-center rounded-full px-1"
                  style={{
                    height: 18,
                    backgroundColor: active ? t.colors.primaryForeground : t.colors.primary,
                  }}
                >
                  <Text
                    className="text-2xs font-bold"
                    style={{ color: active ? t.colors.primary : t.colors.primaryForeground }}
                  >
                    {opt.unread > 99 ? "99+" : opt.unread}
                  </Text>
                </View>
              ) : null}
            </View>
          </PressableScale>
        )
      }}
    />
  )
}

// ── First-load skeleton — the feed's own shape ────────────────────────────────
function FeedSkeleton() {
  return (
    <View className="gap-3 pt-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="flex-row gap-3 px-4 py-3.5">
          <Skeleton width={36} height={36} radius="button" />
          <View className="flex-1 gap-2">
            <Skeleton width="58%" height={14} />
            <Skeleton width="82%" height={12} />
            <Skeleton width="34%" height={10} />
          </View>
        </Card>
      ))}
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function BenachrichtigungenScreen() {
  const t = useW14Theme()
  const navigation = useNavigation()
  const insets = useScreenInsets()
  const feed = useNotifications()

  const [filter, setFilter] = useState<NotificationChannel | null>(null)
  const [open, setOpen] = useState<NotificationItem | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Filter chips: „Alle" + every channel that actually has notifications, in the
  // model's stable CHANNEL_ORDER, each with its own unread tally.
  const options = useMemo(() => {
    const all = { key: null as NotificationChannel | null, label: "Alle", unread: feed.unread }
    return [
      all,
      ...feed.channels.map((c) => ({
        key: c.channel,
        label: CHANNEL_LABELS[c.channel],
        unread: c.unread,
      })),
    ]
  }, [feed.channels, feed.unread])

  // The visible slice: the whole feed under „Alle", else just the active channel.
  // If a filtered channel drains away, we don't silently snap the chip back to
  // „Alle" — the EmptyState below owns that, offering an explicit „Alle anzeigen"
  // so the owner stays in control of which chip is selected.
  const visible = useMemo(() => {
    return filter == null ? feed.items : feed.items.filter((i) => i.channel === filter)
  }, [feed.items, filter])

  // Header „Alles gelesen"-action — only meaningful while something is unread.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        feed.unread > 0 ? (
          <Pressable
            onPress={() => {
              haptics.success()
              feed.markAllRead()
            }}
            accessibilityRole="button"
            accessibilityLabel="Alle als gelesen markieren"
            hitSlop={12}
            style={{ paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 4 }}
          >
            <CheckCheck color={t.colors.primary} size={t.icon.lg} />
          </Pressable>
        ) : null,
    })
  }, [navigation, feed, t.colors.primary, t.icon.lg])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    haptics.selection()
    try {
      await feed.refresh()
    } finally {
      setRefreshing(false)
    }
  }, [feed])

  const onOpen = useCallback(
    (item: NotificationItem) => {
      haptics.impactLight()
      feed.markRead(item.id)
      setOpen(item)
    },
    [feed],
  )

  // The scrolling top block: the live „Jetzt" status section (bridge-derived
  // owner alerts — approvals waiting, next Termin, DLQ, TSE headroom) over the
  // sticky filter header. The live section scrolls away; the filter row sticks.
  const topBlock = useMemo(
    () => (
      <View className="gap-3 pb-3">
        <LiveAlertsSection />
      </View>
    ),
    [],
  )

  // Sticky header — the live unread summary line + the filter chips.
  const header = useMemo(
    () => (
      <View className="bg-background border-border gap-2 border-b pb-2.5 pt-2">
        {feed.items.length > 0 ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(160)}
            className="flex-row items-center gap-2 px-4 pb-0.5"
          >
            {feed.hasCriticalUnread ? (
              <BellRing size={t.icon.sm} color={t.colors.destructive} />
            ) : (
              <Bell size={t.icon.sm} color={t.colors.mutedForeground} />
            )}
            <Text className="text-muted-foreground text-xs">
              {feed.unread > 0
                ? `${feed.unread} ungelesen · ${feed.items.length} gesamt`
                : `Alles gelesen · ${feed.items.length} gesamt`}
            </Text>
          </Animated.View>
        ) : null}
        <ChannelFilter value={filter} options={options} onChange={setFilter} />
      </View>
    ),
    [feed.items.length, feed.unread, feed.hasCriticalUnread, filter, options, t],
  )

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={visible}
        keyExtractor={(it) => String(it.id)}
        ListHeaderComponent={
          <View className="gap-1">
            {topBlock}
            {header}
          </View>
        }
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 10,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={t.colors.primary}
            colors={[t.colors.primary]}
            progressBackgroundColor={t.colors.background}
            progressViewOffset={8}
          />
        }
        renderItem={({ item, index }) => (
          <StaggerItem index={Math.min(index, 8)} exit={false}>
            <NotificationRow item={item} onOpen={() => onOpen(item)} />
          </StaggerItem>
        )}
        ListEmptyComponent={
          // First load before the source has delivered a batch → shaped skeleton.
          !feed.hydrated ? (
            <FeedSkeleton />
          ) : (
            <View className="pt-6">
              <EmptyState
                icon={filter == null ? Bell : CHANNEL_ICON[filter]}
                title={
                  filter == null
                    ? "Keine Benachrichtigungen"
                    : `Nichts unter „${CHANNEL_LABELS[filter]}“`
                }
                description={
                  filter == null
                    ? "Sobald etwas passiert — eine Freigabe, ein Termin, ein Hinweis — erscheint es hier."
                    : "In diesem Kanal liegt gerade nichts an. Wähle „Alle“, um den ganzen Verlauf zu sehen."
                }
                actionLabel={filter == null ? undefined : "Alle anzeigen"}
                onAction={filter == null ? undefined : () => setFilter(null)}
              />
            </View>
          )
        }
      />

      {open != null ? <DetailSheet item={open} onClose={() => setOpen(null)} /> : null}
    </View>
  )
}
