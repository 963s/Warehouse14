/**
 * Bestellungen — die Inhaber-Sicht auf Web-Reservierungen zur Abholung (0099).
 *
 * Das Geschäftsmodell ist reserve-and-collect: die Kundschaft reserviert ein
 * Einzelstück im Online-Shop, kommt binnen drei Tagen ins Geschäft, zahlt an der
 * Theke und nimmt es mit. KEINE Online-Zahlung, KEIN Versand. Diese Fläche
 * beantwortet die vier Fragen des Inhabers zu jeder offenen Reservierung:
 *
 *   • WER hat bestellt — der Name, dazu Telefon und E-Mail als tippbare Kontakte.
 *   • WAS wurde bestellt — die Positionen mit Name, SKU und Preis, plus die Summe.
 *   • WIE WEIT ist die Vorbereitung — die deutsche Abholstufe mit einem kleinen
 *     Fortschritts-Faden (Offen → Angenommen → In Vorbereitung → Abholbereit).
 *   • WIE LANGE noch — der Countdown bis zum Ende der Abholfrist aus `expiresAt`.
 *
 * Drei reine Zustandsübergänge liegen hier: Annehmen, In Vorbereitung, Abholbereit
 * melden. Jeder läuft mit einem EIGENEN Ladezustand pro Bestellung (kein globaler
 * Spinner). Der Server verweigert einen Schritt aus dem falschen Stand mit 409;
 * den zeigen wir ehrlich über `describeError` und laden danach neu, damit die
 * Warteschlange die Wahrheit zeigt. Der „Abholbereit"-Schritt reiht den Brief
 * „Ihr Stück liegt bereit" ein; ging das schief (`mailed: false`), sagen wir es
 * offen — niemand soll glauben, der Brief sei unterwegs.
 *
 * Die Übergabe (kassieren + aushändigen) passiert NICHT hier, sondern an der
 * Kasse über den normalen Verkauf mit der Bestellnummer. Deshalb gibt es hier
 * keinen Verkaufen-Knopf: eine abholbereite Bestellung wartet nur noch auf die
 * Kundschaft an der Theke.
 *
 * Form (DESIGN-SYSTEM.md §1, §6, §9): keine Kästen in Kästen. Die Warteschlange
 * lebt boxlos auf dem warmen Papier, getrennt durch eine einzige Haarlinie; Gold
 * bleibt Faden, Kante, Siegel — nie eine Füllung. Ein fehlgeschlagener Ladeversuch
 * liest sich NIE als „nichts bestellt", sondern sagt ehrlich, dass nicht geladen
 * werden konnte.
 */
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { Linking, Pressable, RefreshControl, ScrollView, View } from "react-native"
import Svg, { Path, Rect } from "react-native-svg"
import type { OrderView, PickupStage } from "@warehouse14/api-client"
import { Check, Clock, Mail, PackageCheck, Phone, ShoppingBag } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import {
  approveOrder,
  describeError,
  formatEur,
  listOrders,
  prepareOrder,
  readyOrder,
} from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  Hairline,
  haptics,
  InlineError,
  PaperGrain,
  PressableScale,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// ────────────────────────────────────────────────────────────────────────────
// Abholstufen — die deutschen Labels + ihre Reihenfolge (mirrors 0099).
// ────────────────────────────────────────────────────────────────────────────

const PICKUP_STAGE_ORDER = ["OFFEN", "ANGENOMMEN", "IN_VORBEREITUNG", "ABHOLBEREIT"] as const

const STAGE_LABEL: Record<PickupStage, string> = {
  OFFEN: "Offen",
  ANGENOMMEN: "Angenommen",
  IN_VORBEREITUNG: "In Vorbereitung",
  ABHOLBEREIT: "Abholbereit",
}

/** A pickup stage from the wire (typed loosely as `string | null`) → its German
 *  label. An unknown/future member degrades to „Unbekannt", never a raw token. */
function stageLabel(stage: string | null): string {
  if (stage != null && stage in STAGE_LABEL) return STAGE_LABEL[stage as PickupStage]
  return "Unbekannt"
}

/** The 0-based position of a stage in the flow, or -1 when unknown. */
function stageIndex(stage: string | null): number {
  return stage != null ? PICKUP_STAGE_ORDER.indexOf(stage as PickupStage) : -1
}

// The filter buckets: „Alle" plus the four stages, in flow order.
type StageFilter = PickupStage | "ALLE"
const STAGE_FILTERS: readonly { value: StageFilter; label: string }[] = [
  { value: "ALLE", label: "Alle" },
  ...PICKUP_STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABEL[s] })),
]

// ────────────────────────────────────────────────────────────────────────────
// Abholfrist-Countdown — ehrliches Deutsch aus `expiresAt`, oder null.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a server instant to millis. The orders API emits microseconds (…​.US"Z"),
 * but the on-device Hermes engine only parses ISO 8601 up to three fractional
 * digits — a six-digit fraction yields an Invalid Date. Clamp to ms so the
 * countdown is real; NaN on anything unparseable (then no countdown is shown,
 * rather than a fabricated one).
 */
function parseInstant(iso: string): number {
  return new Date(iso.replace(/(\.\d{3})\d+/, "$1")).getTime()
}

interface Countdown {
  label: string
  overdue: boolean
}

/** A calm German „noch …"-countdown to the pickup deadline, „Abholfrist
 *  abgelaufen" once it has passed, or null when there is no trustworthy date. */
function pickupCountdown(expiresAt: string | null, now: number = Date.now()): Countdown | null {
  if (!expiresAt) return null
  const end = parseInstant(expiresAt)
  if (!Number.isFinite(end)) return null
  const diff = end - now
  if (diff <= 0) return { label: "Abholfrist abgelaufen", overdue: true }
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return { label: `Noch ${mins} Min.`, overdue: false }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { label: `Noch ${hours} Std.`, overdue: false }
  const days = Math.floor(hours / 24)
  return { label: `Noch ${days} ${days === 1 ? "Tag" : "Tage"}`, overdue: false }
}

// ────────────────────────────────────────────────────────────────────────────
// ParcelSeal — ein bespoke Paket-Siegel (react-native-svg): ein Karton mit einer
// Gilt-Schnur. Der Karton bleibt Tinte, die Schnur (der Faden) tönt in Gilt —
// Gold nur als Faden / Siegel, nie als Füllung (DESIGN-SYSTEM.md §1, §6).
// ────────────────────────────────────────────────────────────────────────────

function ParcelSeal({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Der Karton — die Tinte. */}
      <Rect x="4.4" y="7.6" width="15.2" height="11.4" rx="1.2" stroke={ink} strokeWidth="1.2" />
      {/* Die Deckelkante. */}
      <Path d="M4.4 11.2h15.2" stroke={ink} strokeWidth="1.1" opacity={0.6} />
      {/* Die Schnur — der eine Gilt-Faden, über die Mitte gebunden. */}
      <Path d="M12 7.6v11.4" stroke={gilt} strokeWidth="1.3" strokeLinecap="round" />
      <Path d="M9.6 6.2 12 7.6l2.4-1.4" stroke={gilt} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// StageProgress — der kleine Fortschritts-Faden: vier Knoten auf einer Gilt-
// Linie, gefüllt bis zur aktuellen Stufe. Der aktuelle Knoten trägt den Gilt-
// Ring, erledigte tönen Verdigris, kommende bleiben hohle Kante. Boxlos.
// ────────────────────────────────────────────────────────────────────────────

function StageProgress({ stage }: { stage: string | null }): ReactNode {
  const t = useW14Theme()
  const current = stageIndex(stage)

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center">
        {PICKUP_STAGE_ORDER.map((s, i) => {
          const reached = current >= 0 && i <= current
          const isCurrent = i === current
          return (
            <View key={s} className="flex-1 flex-row items-center">
              <View style={{ width: 12, alignItems: "center" }}>
                <View
                  style={{
                    height: isCurrent ? 12 : 10,
                    width: isCurrent ? 12 : 10,
                    borderRadius: 6,
                    backgroundColor: reached
                      ? isCurrent
                        ? t.colors.foreground
                        : t.colors.verdigris
                      : "transparent",
                    borderWidth: isCurrent ? 2 : 1,
                    borderColor: isCurrent
                      ? t.colors.gilt
                      : reached
                        ? t.colors.verdigris
                        : t.colors.border,
                  }}
                />
              </View>
              {i < PICKUP_STAGE_ORDER.length - 1 ? (
                <View
                  style={{
                    flex: 1,
                    height: 1.5,
                    borderRadius: 1,
                    backgroundColor: current > i ? t.colors.verdigris : t.colors.gilt + "40",
                  }}
                />
              ) : null}
            </View>
          )
        })}
      </View>
      <View className="flex-row items-center">
        {PICKUP_STAGE_ORDER.map((s, i) => (
          <Text
            key={s}
            className="text-2xs"
            style={{
              flex: 1,
              textAlign: i === 0 ? "left" : i === PICKUP_STAGE_ORDER.length - 1 ? "right" : "center",
              color: i === current ? t.colors.foreground : t.colors.mutedForeground,
              fontWeight: i === current ? "600" : "400",
            }}
            numberOfLines={1}
          >
            {STAGE_LABEL[s]}
          </Text>
        ))}
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// ContactLink — ein tippbarer Kontakt (Telefon/E-Mail) über `Linking`. Öffnet
// den Wähler bzw. das Mail-Programm; ein leises Icon + der Wert in Tinte.
// ────────────────────────────────────────────────────────────────────────────

function ContactLink({
  icon: Icon,
  value,
  href,
  label,
}: {
  icon: typeof Phone
  value: string
  href: string
  label: string
}): ReactNode {
  const t = useW14Theme()
  return (
    <PressableScale
      onPress={() => {
        haptics.selection()
        void Linking.openURL(href).catch(() => {
          // Kein Wähler / Mail-Programm verfügbar — still schlucken, kein Absturz.
        })
      }}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <View className="flex-row items-center gap-1.5">
        <Icon size={t.icon.xs} color={t.colors.mutedForeground} />
        <Text className="text-sm underline" style={{ color: t.colors.inkAged }} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Die Aktion je Stufe — was der nächste Schritt heißt und was er ruft.
// ABHOLBEREIT hat keine Aktion mehr: die Bestellung wartet auf die Theke.
// ────────────────────────────────────────────────────────────────────────────

interface StageAction {
  label: string
  busyLabel: string
  run: (orderNumber: string) => Promise<{ ok: boolean; mailed?: boolean }>
}

function nextAction(stage: string | null): StageAction | null {
  switch (stage) {
    case "OFFEN":
      return { label: "Annehmen", busyLabel: "Wird angenommen…", run: approveOrder }
    case "ANGENOMMEN":
      return { label: "In Vorbereitung", busyLabel: "Wird übernommen…", run: prepareOrder }
    case "IN_VORBEREITUNG":
      return { label: "Abholbereit melden", busyLabel: "Wird gemeldet…", run: readyOrder }
    default:
      return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// OrderCard — eine Bestellung, boxlos auf dem Papier: Kopf (Nummer + Stufe),
// Kontakt, Fortschritt, Countdown, Positionen + Summe, und die eine Aktion.
// ────────────────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onChanged,
  onMailNotSent,
}: {
  order: OrderView
  /** Nach jedem Übergang (Erfolg ODER 409), damit die Warteschlange neu lädt. */
  onChanged: () => void
  /** Der „Abholbereit"-Brief wurde NICHT eingereiht — an die Fläche gemeldet. */
  onMailNotSent: (orderNumber: string) => void
}): ReactNode {
  const t = useW14Theme()
  const orderNumber = order.orderNumber
  const action = nextAction(order.pickupStage)
  const countdown = pickupCountdown(order.expiresAt)
  const isReady = order.pickupStage === "ABHOLBEREIT"

  const displayNumber = orderNumber ?? order.id.slice(0, 8).toUpperCase()

  const m = useMutation(
    (run: () => Promise<{ ok: boolean; mailed?: boolean }>) => run(),
    {
      onSuccess: (data) => {
        haptics.success()
        // Nur der „Abholbereit"-Schritt trägt `mailed`; false heißt ehrlich: der
        // Brief ging nicht raus. approve/prepare liefern kein `mailed` (undefined).
        if (data && data.mailed === false && orderNumber != null) onMailNotSent(orderNumber)
        onChanged()
      },
      onError: () => {
        // 409 = ein anderes Gerät hat den Stand schon weitergeschaltet. Der
        // Grund steht als describeError in `m.error`; danach neu laden, damit die
        // Warteschlange die Wahrheit zeigt.
        haptics.error()
        onChanged()
      },
    },
  )

  const stageTone =
    order.pickupStage === "OFFEN"
      ? t.colors.gilt
      : isReady
        ? t.colors.verdigris
        : t.colors.inkAged

  return (
    <View className="gap-3 py-4">
      {/* Kopf — Bestellnummer in Ziffern, die Stufe als leises farbiges Wort. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-mono text-sm font-semibold" numberOfLines={1}>
          {displayNumber}
        </Text>
        <Text className="text-xs font-semibold" style={{ color: stageTone }} numberOfLines={1}>
          {stageLabel(order.pickupStage)}
        </Text>
      </View>

      {/* WER — Name, dazu Telefon + E-Mail als tippbare Kontakte. Fehlt der Name,
          sagt es das ehrlich statt eine leere Zeile zu zeigen. */}
      <View className="gap-1.5">
        <Text className="text-base font-display-semibold leading-tight" numberOfLines={1}>
          {order.contactName ?? "Name nicht hinterlegt"}
        </Text>
        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
          {order.contactPhone ? (
            <ContactLink
              icon={Phone}
              value={order.contactPhone}
              href={`tel:${order.contactPhone.replace(/\s+/g, "")}`}
              label={`${order.contactPhone} anrufen`}
            />
          ) : null}
          {order.contactEmail ? (
            <ContactLink
              icon={Mail}
              value={order.contactEmail}
              href={`mailto:${order.contactEmail}`}
              label={`E-Mail an ${order.contactEmail}`}
            />
          ) : null}
        </View>
      </View>

      {/* WIE WEIT — der Fortschritts-Faden über die vier Stufen. */}
      <StageProgress stage={order.pickupStage} />

      {/* WIE LANGE — der Countdown der Abholfrist, wenn eine Frist bekannt ist. */}
      {countdown != null ? (
        <View className="flex-row items-center gap-1.5">
          <Clock
            size={t.icon.xs}
            color={countdown.overdue ? t.colors.destructive : t.colors.gilt}
          />
          <Text
            className="text-xs font-medium"
            style={{ color: countdown.overdue ? t.colors.destructive : t.colors.gilt }}
          >
            {countdown.label}
          </Text>
        </View>
      ) : null}

      {/* WAS — die Positionen mit Name, SKU und Einzelpreis, plus die Summe. */}
      <View className="gap-1.5">
        <Hairline />
        {order.lines.length > 0 ? (
          order.lines.map((line) => (
            <View
              key={`${order.id}-${line.productId ?? line.sku ?? line.name}`}
              className="flex-row items-start justify-between gap-3"
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-sm" numberOfLines={1}>
                  {line.quantity > 1 ? `${line.quantity} × ` : ""}
                  {line.name}
                </Text>
                {line.sku ? (
                  <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
                    {line.sku}
                  </Text>
                ) : null}
              </View>
              <Text className="font-mono text-sm" style={{ color: t.colors.inkAged }}>
                {formatEur(line.unitPriceEur)}
              </Text>
            </View>
          ))
        ) : (
          <Text className="text-muted-foreground text-sm">Keine Positionen hinterlegt.</Text>
        )}
        <Hairline />
        <View className="flex-row items-center justify-between gap-3 pt-0.5">
          <Text className="text-muted-foreground text-xs">
            {order.itemCount} {order.itemCount === 1 ? "Artikel" : "Artikel"} · Summe
          </Text>
          <Text className="font-mono text-sm font-semibold">{formatEur(order.totalEur)}</Text>
        </View>
      </View>

      {/* Der 409-Grund, ehrlich und übersetzt; danach ist die Liste schon neu
          geladen, der Knopf zeigt die wahre nächste Aktion. */}
      {m.error != null ? <InlineError message={m.error} onDismiss={m.reset} /> : null}

      {/* Die eine Aktion — oder, bei ABHOLBEREIT, der ruhige Warte-Hinweis. Die
          Übergabe passiert an der Kasse, nicht hier: kein Verkaufen-Knopf. */}
      {isReady ? (
        <View className="flex-row items-center gap-2 pt-0.5">
          <PackageCheck size={t.icon.sm} color={t.colors.verdigris} />
          <Text className="flex-1 text-sm leading-5" style={{ color: t.colors.verdigris }}>
            Liegt bereit. Wartet auf Abholung und Zahlung an der Theke.
          </Text>
        </View>
      ) : action != null && orderNumber != null ? (
        <Button
          onPress={() => void m.mutate(() => action.run(orderNumber))}
          onPressIn={() => haptics.selection()}
          disabled={m.isPending}
          accessibilityLabel={`${action.label}, Bestellung ${displayNumber}`}
        >
          <Check size={t.icon.sm} color={t.colors.primaryForeground} />
          <Text>{m.isPending ? action.busyLabel : action.label}</Text>
        </Button>
      ) : orderNumber == null ? (
        <Text className="text-muted-foreground text-xs leading-5">
          Ohne Bestellnummer lässt sich der nächste Schritt hier nicht auslösen.
        </Text>
      ) : null}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Die Fläche.
// ────────────────────────────────────────────────────────────────────────────

export default function BestellungenScreen(): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [filter, setFilter] = useState<StageFilter>("ALLE")
  // Der „Brief ging nicht raus"-Hinweis lebt auf Flächen-Ebene, damit er auch
  // dann sichtbar bleibt, wenn die Bestellung durch den Wechsel auf ABHOLBEREIT
  // aus dem gerade gefilterten Fach fällt.
  const [mailNotSent, setMailNotSent] = useState<string | null>(null)

  const orders = useQuery(() => listOrders(filter === "ALLE" ? undefined : filter), {
    key: `orders:${filter}`,
    staleTimeMs: 10_000,
    pollIntervalMs: 60_000,
    // Beim Fachwechsel die vorherigen Zeilen stehen lassen, statt auf ein Skelett
    // zurückzufallen — der Filter fühlt sich sonst wie ein Neuladen an.
    keepPreviousData: true,
  })
  const rc = useRefreshControl(orders)

  const items = orders.data?.items ?? []
  const hasOrders = items.length > 0
  const firstLoading = orders.status === "loading" && orders.data == null
  const hardError = orders.error != null && orders.data == null ? orders.error : null

  // Kopf-Bilanz — nur echte Summen aus echten Zeilen. Im „Alle"-Fach zählen wir
  // die noch nicht abholbereiten (offene Arbeit); in einem Stufen-Fach die Zeilen
  // dieses Fachs. Nie eine erfundene Zahl.
  const openWork = useMemo(
    () => items.filter((o) => o.pickupStage !== "ABHOLBEREIT").length,
    [items],
  )

  const refetch = useCallback(() => void orders.refetch(), [orders])

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 24,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* ── Kopf ─────────────────────────────────────────────────────────── */}
        <View className="gap-4">
          <View className="gap-1.5">
            <View className="flex-row items-center gap-2">
              <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
              <Text
                className="text-muted-foreground text-2xs font-semibold"
                style={{ letterSpacing: 1.2 }}
              >
                ONLINE-SHOP · ABHOLUNG
              </Text>
            </View>
            <View className="flex-row items-center gap-2.5">
              <ParcelSeal size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
              <Text className="flex-1 text-2xl font-display-semibold leading-tight" numberOfLines={1}>
                Bestellungen
              </Text>
            </View>
          </View>

          {/* Kopf-Bilanz — echte Zahl aus echten Zeilen, sonst gar nichts. */}
          {orders.data != null ? (
            <View className="gap-2">
              <Hairline />
              <View className="flex-row items-center gap-2 py-1">
                <View
                  style={{
                    height: 5,
                    width: 5,
                    borderRadius: 3,
                    backgroundColor: openWork > 0 ? t.colors.gilt : t.colors.verdigris,
                  }}
                />
                <Text className="flex-1 text-sm leading-5">
                  {filter === "ALLE"
                    ? openWork > 0
                      ? openWork === 1
                        ? "1 Reservierung wartet auf Vorbereitung."
                        : `${openWork} Reservierungen warten auf Vorbereitung.`
                      : hasOrders
                        ? "Alles vorbereitet. Nichts wartet auf einen nächsten Schritt."
                        : "Keine offenen Reservierungen."
                    : items.length === 1
                      ? "1 Bestellung in diesem Fach."
                      : `${items.length} Bestellungen in diesem Fach.`}
                </Text>
              </View>
              <Hairline />
            </View>
          ) : null}

          {/* Fächer — nackte Marken, keine Kästen. */}
          <View className="flex-row flex-wrap gap-x-4 gap-y-2">
            {STAGE_FILTERS.map((b) => {
              const active = filter === b.value
              return (
                <Pressable
                  key={b.value}
                  onPress={() => {
                    haptics.selection()
                    setFilter(b.value)
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Fach ${b.label}`}
                >
                  <View className="gap-1">
                    <Text
                      className={active ? "text-sm font-semibold" : "text-muted-foreground text-sm"}
                    >
                      {b.label}
                    </Text>
                    <View
                      style={{
                        height: 1.5,
                        borderRadius: 1,
                        backgroundColor: active ? t.colors.gilt : "transparent",
                      }}
                    />
                  </View>
                </Pressable>
              )
            })}
          </View>
        </View>

        {/* Der „Brief ging nicht raus"-Hinweis — ehrlich und ausblendbar. */}
        {mailNotSent != null ? (
          <InlineError
            title="Abhol-Hinweis nicht versendet"
            message={`Für Bestellung ${mailNotSent} konnte der Hinweis „Ihr Stück liegt bereit" nicht eingereiht werden. Die Kundschaft wurde nicht automatisch benachrichtigt. Bitte selbst kurz anrufen oder schreiben.`}
            onDismiss={() => setMailNotSent(null)}
          />
        ) : null}

        {hardError != null ? (
          // Ehrlicher Fehlzustand: ein misslungener Ladeversuch liest sich NIE als
          // „nichts bestellt". Er sagt, dass nicht geladen werden konnte, mit Retry.
          <InlineError message={hardError} onRetry={refetch} />
        ) : (
          <View>
            {firstLoading ? (
              <View accessibilityElementsHidden>
                {Array.from({ length: 3 }).map((_, i) => (
                  <View key={i}>
                    {i > 0 ? <Hairline /> : null}
                    <View className="gap-3 py-4">
                      <View className="flex-row items-center justify-between">
                        <Skeleton width="32%" height={14} />
                        <Skeleton width={70} height={12} />
                      </View>
                      <Skeleton width="55%" height={16} />
                      <Skeleton width="100%" height={12} />
                      <Skeleton width="100%" height={44} radius="button" />
                    </View>
                  </View>
                ))}
              </View>
            ) : !hasOrders && orders.data != null ? (
              <EmptyState
                icon={ShoppingBag}
                title={filter === "ALLE" ? "Keine offenen Reservierungen" : "Kein Fach-Eintrag"}
                description="Neue Reservierungen aus dem Online-Shop erscheinen hier von selbst. Die Zahlung und Übergabe laufen an der Kasse."
              />
            ) : (
              <View>
                {items.map((order, index) => (
                  <StaggerItem key={order.id} index={Math.min(index, 8)} exit={false}>
                    {index > 0 ? <Hairline /> : null}
                    <OrderCard order={order} onChanged={refetch} onMailNotSent={setMailNotSent} />
                  </StaggerItem>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Die EINE bewusste Karte — eine Museums-Tafel über den Weg der Abholung. */}
        <SectionCard
          title="Wie eine Abholung läuft"
          subtitle="Reservieren im Shop, vorbereiten hier, zahlen und abholen an der Theke."
          icon={PackageCheck}
        >
          <Text className="text-muted-foreground text-xs leading-5">
            Die Kundschaft reserviert ein Einzelstück online und kommt binnen drei Tagen vorbei.
            Hier nimmst du die Reservierung an, bereitest sie vor und meldest sie als abholbereit.
            Der Hinweis „Ihr Stück liegt bereit" geht dann an die hinterlegte Adresse. Kassiert und
            ausgehändigt wird an der Kasse über die Bestellnummer, damit Beleg und Fiskal-Aufzeichnung
            dieselben bleiben.
          </Text>
        </SectionCard>
      </ScrollView>
    </View>
  )
}
