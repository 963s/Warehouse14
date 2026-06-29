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
 *
 * THE FORM (DESIGN-SYSTEM.md §1, §9 — boxes inside boxes are forbidden):
 *   The list is NOT a stack of cards. It is a single sheet of aged paper: bare
 *   rows breathing on the parchment ground, separated by ONE warm hairline. Depth
 *   comes from the parchment-step (a pressed row settles onto the raised leaf),
 *   never from a stacked card with its own border. Each row carries a FIXED
 *   circular channel badge — a perfect disc, never a rectangle vertically
 *   stretched by a tall body — an unread seal dot, and a relative de-DE timestamp.
 *   A critical-unread row earns a single gilt edge-seal: the gold thread, used as
 *   a seal only, never a fill.
 *
 *   The clean LIST→DETAIL pattern: tapping a row opens a spine-native bottom
 *   sheet with the full title/body, the source event meta as hairline-separated
 *   rows (not a box), and a deep-link CTA („Öffnen") that routes to the relevant
 *   surface. Opening a row marks it read.
 *
 *   The four list states render through the same skeleton/empty/error vocabulary
 *   every surface uses; pull-to-refresh forces a one-shot live fetch.
 *   §7 haptics: selection on a filter / row open, success on „Alles gelesen",
 *   impactLight on opening the sheet.
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
import Svg, { Path } from "react-native-svg"

import { Button } from "@/components/ui/button"
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
  Hairline,
  PaperGrain,
  PressableScale,
  Skeleton,
  StaggerItem,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── A bespoke seal mark — the gilt ◆ opener (DESIGN-SYSTEM.md §6) ──────────────
/**
 * SealMark — a tiny hand-drawn wax-seal diamond, the gilt thread that opens the
 * „Verlauf" group. A faceted lozenge (outer cut + inner light) so the gold reads
 * as an engraved seal, never a flat fill. `currentColor` so it tints from the
 * parent (always gilt here). Decorative — hidden from accessibility.
 */
function SealMark({ size = 12, color }: { size?: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Outer faceted lozenge */}
      <Path
        d="M12 2 L21 12 L12 22 L3 12 Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        fill={color}
        fillOpacity={0.12}
      />
      {/* Inner light cut */}
      <Path
        d="M12 7 L16.5 12 L12 17 L7.5 12 Z"
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
        strokeOpacity={0.7}
        fill="none"
      />
    </Svg>
  )
}

// ── View mappings (presentation only — model holds no colours/icons) ──────────
/** The channel glyph carried in each row's fixed circular badge. */
const CHANNEL_ICON: Record<NotificationChannel, LucideIcon> = {
  approvals: Gavel,
  appointments: CalendarClock,
  fiscal: ScrollText,
  system: Server,
  sales: BadgeEuro,
  compliance: ShieldAlert,
  channels: Megaphone,
}

/** Severity → the theme token a row's badge tint + seal dot pulls from. */
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
      // No CTA: the Termine surface was removed (owner focus is inventory +
      // direct cashier). Until a replacement exists we stay honest and offer
      // no „Öffnen" that goes nowhere.
      return null
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

// Fixed circular badge geometry — a PERFECT disc that a tall two-line body can
// never stretch (DESIGN goal: never vertically stretched). width === height and
// `aspectRatio: 1` double-guards the square; `rounded-full` makes it a circle.
const BADGE = 40

// ── Row — a BARE row on the parchment sheet (no per-row card) ─────────────────
function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const t = useW14Theme()
  const accent = severityColor(item.severity, t)
  const Icon = CHANNEL_ICON[item.channel]
  const unread = !item.read
  const critical = item.severity === "critical" && unread

  return (
    <PressableScale
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.body}. ${item.read ? "Gelesen" : "Ungelesen"}.`}
    >
      {/* A bare row: parchment-step depth on press (the raised leaf), one warm
          hairline below — NOT a stacked card with its own border. An unread row
          rests a hair higher on the card surface so it lifts off the canvas; a
          read row sits flush on the ground. A critical-unread row earns a single
          gilt edge-seal at the leading edge — the gold thread used as a seal. */}
      <View
        className="flex-row items-center gap-3 rounded-xl px-3 py-3.5"
        style={{
          backgroundColor: unread ? t.colors.card : "transparent",
          borderLeftWidth: critical ? 2 : 0,
          borderLeftColor: critical ? t.colors.gilt : "transparent",
        }}
      >
        {/* Fixed circular channel badge — a perfect disc tinted to severity. */}
        <View
          className="items-center justify-center rounded-full"
          style={{
            width: BADGE,
            height: BADGE,
            aspectRatio: 1,
            backgroundColor: accent + "14",
            borderWidth: 1,
            borderColor: accent + "33",
          }}
        >
          <Icon size={t.icon.lg} color={accent} />
        </View>

        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className={unread ? "text-base font-semibold" : "text-base font-medium"}
              numberOfLines={1}
              style={{ flexShrink: 1, color: unread ? t.colors.foreground : t.colors.inkAged }}
            >
              {item.title}
            </Text>
            {/* The unread seal — a calm dot, no loud fill. */}
            {unread ? (
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: accent }}
                accessibilityLabel="ungelesen"
              />
            ) : null}
          </View>
          <Text className="text-muted-foreground text-sm leading-5" numberOfLines={2}>
            {item.body}
          </Text>
          <View className="flex-row items-center gap-1.5 pt-0.5">
            <Text className="text-muted-foreground text-2xs">{CHANNEL_LABELS[item.channel]}</Text>
            <Text className="text-muted-foreground text-2xs">·</Text>
            <Text className="text-muted-foreground text-2xs">{relativeTime(item.createdAt)}</Text>
          </View>
        </View>

        <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
      </View>
    </PressableScale>
  )
}

// ── Detail sheet (the LIST→DETAIL pattern) ────────────────────────────────────
/** One hairline-separated meta line in the sheet — a bare row, not a boxed cell. */
function MetaRow({
  label,
  children,
  first = false,
}: {
  label: string
  children: React.ReactNode
  first?: boolean
}) {
  return (
    <View>
      {first ? null : <Hairline />}
      <View className="flex-row items-center justify-between gap-3 py-2.5">
        <Text className="text-muted-foreground text-xs">{label}</Text>
        {children}
      </View>
    </View>
  )
}

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
        // The scrim is a WARM aged-ink dim (the walnut near-black of the
        // palette), never a cold pure black (DESIGN §5 — depth from a warm
        // layered scrim, not a flat black drop).
        style={{ backgroundColor: "rgba(23,21,15,0.5)" }}
        accessibilityRole="button"
        accessibilityLabel="Schließen"
        onPress={onClose}
      >
        {/* Inner Pressable swallows taps so a tap inside the sheet never dismisses. */}
        <Pressable
          onPress={() => {}}
          className="bg-background border-border gap-4 overflow-hidden rounded-t-2xl border-t px-5 pt-4"
          style={{ paddingBottom: insets.stickyBottom }}
        >
          {/* The floating leaf carries the fainter card-surface grain so the
              sheet reads as aged paper, clipped to its rounded top. */}
          <PaperGrain surface="card" />
          <View className="items-center pb-1">
            <View className="h-1 w-10 rounded-full" style={{ backgroundColor: t.colors.border }} />
          </View>

          <View className="flex-row items-start gap-3">
            {/* The sheet badge echoes the row's fixed disc, one step larger. */}
            <View
              className="items-center justify-center rounded-full"
              style={{
                width: 48,
                height: 48,
                aspectRatio: 1,
                backgroundColor: accent + "14",
                borderWidth: 1,
                borderColor: accent + "33",
              }}
            >
              <Icon size={t.icon.xl} color={accent} />
            </View>
            <View className="flex-1 gap-1 pt-0.5">
              {/* The sheet's title speaks the display voice — Bricolage Grotesque
                  at the screen-title step (DESIGN §3). */}
              <Text className="text-xl font-display-semibold leading-tight" numberOfLines={2}>
                {item.title}
              </Text>
              <View className="flex-row items-center gap-2">
                <Text
                  className="text-2xs font-semibold"
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

          {/* Source meta — the honest provenance: this is event #N from the
              ledger. Rendered as bare hairline-separated rows on the sheet's own
              surface, NOT a bordered box-within-the-box. */}
          <View>
            <MetaRow label="Zeitpunkt" first>
              <Text className="text-sm font-medium">
                {new Date(item.createdAt).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </MetaRow>
            <MetaRow label="Ereignis">
              <Text className="text-sm font-medium" numberOfLines={1} style={{ flexShrink: 1 }}>
                {eventLabel(item.eventType)}
              </Text>
            </MetaRow>
            <MetaRow label="Beleg-Nr.">
              <Text className="font-mono-medium text-xs">#{item.id}</Text>
            </MetaRow>
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
                  className="items-center justify-center rounded-full px-1"
                  style={{
                    minWidth: 18,
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

// ── First-load skeleton — the feed's own BARE-ROW shape ───────────────────────
function FeedSkeleton() {
  return (
    <View className="pt-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i}>
          {i === 0 ? null : <Hairline inset={64} />}
          <View className="flex-row items-center gap-3 px-3 py-3.5">
            <Skeleton width={BADGE} height={BADGE} radius="full" />
            <View className="flex-1 gap-2">
              <Skeleton width="58%" height={14} />
              <Skeleton width="82%" height={12} />
              <Skeleton width="34%" height={10} />
            </View>
          </View>
        </View>
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
  // owner alerts — approvals waiting, next Termin, DLQ, TSE headroom). The live
  // section scrolls away; the filter row sticks.
  const topBlock = useMemo(
    () => (
      <View className="pb-3">
        <LiveAlertsSection />
      </View>
    ),
    [],
  )

  // Sticky header — the gilt-sealed „Verlauf" opener + the live unread summary
  // line + the filter chips. The whole header sits on a single warm hairline; the
  // gilt seal is the one gold thread on the screen (DESIGN §1, §6).
  const header = useMemo(
    () => (
      <View className="bg-background gap-2.5 pb-2.5 pt-1">
        {feed.items.length > 0 ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(160)}
            className="gap-2 px-4"
          >
            <View className="flex-row items-center gap-2">
              <SealMark size={12} color={t.colors.gilt} />
              <Text
                className="font-display-semibold text-xs"
                style={{ color: t.colors.inkAged, letterSpacing: 1.4, textTransform: "uppercase" }}
              >
                Verlauf
              </Text>
              <View className="flex-1">
                <Hairline />
              </View>
            </View>
            <View className="flex-row items-center gap-2">
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
            </View>
          </Animated.View>
        ) : null}
        <ChannelFilter value={filter} options={options} onChange={setFilter} />
      </View>
    ),
    [feed.items.length, feed.unread, feed.hasCriticalUnread, filter, options, t],
  )

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <FlatList
        data={visible}
        keyExtractor={(it) => String(it.id)}
        ListHeaderComponent={
          <View>
            {topBlock}
            {header}
          </View>
        }
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
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
        // One warm hairline between rows is the ONLY divider — bare rows on a
        // single sheet, never stacked cards (DESIGN §1, §9). Inset so the rule
        // begins under the title, not under the circular badge.
        ItemSeparatorComponent={() => <Hairline inset={64} />}
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
                    : `Nichts unter ${CHANNEL_LABELS[filter]}`
                }
                description={
                  filter == null
                    ? "Sobald etwas geschieht, eine Freigabe, ein Termin oder ein Hinweis, erscheint es hier."
                    : "In diesem Kanal liegt gerade nichts an. Wähle Alle, um den ganzen Verlauf zu sehen."
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
