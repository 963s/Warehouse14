/**
 * Tagebuch — die Owner-Fläche über das GoBD-Ereignisregister (`ledger_events`).
 * Sie ist READ-ONLY und CLIENT-ONLY über `GET /api/ledger`: der Server besitzt
 * das fortlaufende, hash-verkettete Append-only-Protokoll jeder bedeutsamen
 * Handlung — wer hat wann was getan. Diese Fläche LIEST dieses Protokoll und
 * verändert nichts. Anders als die Benachrichtigungszentrale (die nur die
 * lautesten Ereignisse kuratiert) zeigt das Tagebuch das VOLLSTÄNDIGE Protokoll.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Das Protokoll lebt direkt auf
 * dem warmen Papier — ein Kicker mit bespoke Journal-Siegel, eine boxlose
 * Kopf-Bilanz, boxlose Filter-Reihen mit einem Gilt-Faden unter dem aktiven Chip,
 * und die Ereignisse als nackte Zeilen, nach Tag gruppiert und getrennt nur durch
 * eine einzige warme Haarlinie. Tiefe kommt aus dem geschichteten Papier und der
 * Linie, nie aus gestapelten Karten.
 *
 * Aufbau:
 *   • Register-Kopf — die echte Gesamtzahl der Einträge im gewählten Zeitraum
 *     (vom Server, nicht aus der geladenen Seite geraten) + der jüngste Eintrag,
 *     als boxlose Bilanz mit einer warmen Trennlinie.
 *   • Zeitraum-Filter — ehrlich serverseitig über `fromBusinessDay`/`toBusinessDay`
 *     (Heute · 7 Tage · 30 Tage · Alle). Das treibt die echte Gesamtzahl.
 *   • Kategorie-Filter — eine ruhige, boxlose Chip-Reihe. Der Endpunkt filtert
 *     NICHT nach unserer Kategorie (er kennt nur exakte Ereignistypen), darum
 *     filtert diese Reihe die GELADENEN Einträge clientseitig — die Zähler sind
 *     ehrlich als in den geladenen Einträgen zu lesen, nie als Server-Summe.
 *   • Ereignis-Zeilen — nach Tag gruppiert (Heute/Gestern/…), je Zeile ein ruhiges
 *     Kategorie-Glyph, die deutsche Überschrift, der Akteur (wer), die Entität
 *     (woran) und die Uhrzeit. Getrennt nur durch eine warme Haarlinie.
 *   • Tippen → Detail — die rohe Wahrheit eines Eintrags: voller Ereignistyp,
 *     Akteur-/Geräte-/Entitäts-IDs, der Zeilen-Hash (Forensik) und die komplette
 *     Payload als lesbare Schlüssel/Wert-Liste. Nichts wird erfunden.
 *
 * Ehrlichkeitsregel (absolut): jede Zahl ist eine echte Summe aus einer echten
 * Antwort; jedes Label stammt aus dem echten Ereignistyp oder der echten Payload.
 * Gebaut auf dem geteilten Spine (UI-Primitive, §6-Motion + §7-Haptik, nur
 * W14-Theme-Tokens). Deutsche UI.
 */
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, View } from "react-native"
import Svg, { Circle, Path } from "react-native-svg"
import { type LucideIcon } from "lucide-react-native"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Text } from "@/components/ui/text"
import { listLedger } from "@/warehouse14/api"
import type { LedgerListRow } from "@warehouse14/api-client"
import {
  actorInfo,
  categoryMeta,
  CATEGORY_ORDER,
  countByCategory,
  DATE_RANGE_LABELS,
  DATE_RANGE_ORDER,
  type DateRange,
  dateRangeQuery,
  entityLabel,
  type EventCategory,
  eventCategory,
  eventLabel,
  formatEventDate,
  formatEventTime,
  groupByDay,
  hasPayload,
  payloadEntries,
  relativeTime,
  shortHash,
  shortId,
} from "@/warehouse14/audit-ui"
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
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// A generous page: the audit log is read-mostly and the route caps at 200. One
// page covers the common "scroll the recent history" case; the honest hint below
// the list calls out when the server holds more than we fetched.
const PAGE_LIMIT = 150

type CategoryFilter = "ALL" | EventCategory

// ────────────────────────────────────────────────────────────────────────────
// LedgerSeal — ein bespoke Journal-Siegel (react-native-svg). Ein gestempelter
// Ring (die Siegel-Tinte) mit zwei verketteten Gliedern im Inneren: die ruhige
// Marke des hash-verketteten GoBD-Protokolls — jeder Eintrag mit dem vorherigen
// verbunden. Der Faden (die Kette) tönt in Gilt, der Ring bleibt Tinte: Gold nur
// als Faden/Siegel (DESIGN-SYSTEM.md §1).
// ────────────────────────────────────────────────────────────────────────────

function LedgerSeal({
  size = 26,
  ink,
  gilt,
}: {
  size?: number
  ink: string
  gilt: string
}): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Gestempelter Ring — die Siegel-Tinte. */}
      <Circle cx={12} cy={12} r={8.4} stroke={ink} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={6.2} stroke={ink} strokeWidth={0.7} strokeOpacity={0.4} fill="none" />
      {/* Zwei verkettete Glieder — der Gilt-Faden der Signaturkette. */}
      <Path
        d="M9.4 13.2 a1.9 1.9 0 1 1 1.5 -3 a1.9 1.9 0 0 1 0 2.2"
        stroke={gilt}
        strokeWidth={1.3}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M14.6 10.8 a1.9 1.9 0 1 1 -1.5 3 a1.9 1.9 0 0 1 0 -2.2"
        stroke={gilt}
        strokeWidth={1.3}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Register-Kopf — die echte Gesamtzahl + der jüngste Eintrag als boxlose Bilanz
// (keine Karten). Zwei Spalten, getrennt durch eine einzige warme Haarlinie.
// ────────────────────────────────────────────────────────────────────────────

function RegisterBalance({
  total,
  loadedCount,
  latestIso,
}: {
  total: number
  loadedCount: number
  latestIso: string | null
}) {
  const t = useW14Theme()
  const latest = latestIso ? relativeTime(latestIso) : null
  return (
    <View className="flex-row items-stretch">
      <View className="flex-1 gap-1">
        <Text
          className="text-muted-foreground text-2xs font-medium"
          style={{ letterSpacing: 0.6 }}
          numberOfLines={1}
        >
          Einträge
        </Text>
        <Text
          className="font-mono-medium text-3xl leading-none"
          style={{ color: total > 0 ? t.colors.primary : t.colors.mutedForeground }}
        >
          {total.toLocaleString("de-DE")}
        </Text>
        {total > loadedCount ? (
          <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
            {`${loadedCount.toLocaleString("de-DE")} geladen`}
          </Text>
        ) : null}
      </View>
      <Hairline vertical length={40} />
      <View className="flex-[1.3] gap-1" style={{ paddingLeft: 16 }}>
        <Text
          className="text-muted-foreground text-2xs font-medium"
          style={{ letterSpacing: 0.6 }}
          numberOfLines={1}
        >
          Jüngster Eintrag
        </Text>
        <Text
          className="text-lg font-semibold leading-tight"
          style={{ color: latest ? t.colors.foreground : t.colors.mutedForeground }}
          numberOfLines={2}
        >
          {latest ?? "Noch keiner"}
        </Text>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Filter-Chips — boxlos; der aktive Chip trägt einen Gilt-Faden (DESIGN-SYSTEM.md
// §1: Gold als Faden/Kante). Keine Pillen, keine Kästen, kein getönter Fill.
// (Zeitraum: serverseitig · Kategorie: clientseitig über die geladene Seite.)
// ────────────────────────────────────────────────────────────────────────────

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string
  count: number | null
  active: boolean
  onPress: () => void
}) {
  const t = useW14Theme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
      style={{ minHeight: t.touch.min, justifyContent: "center" }}
    >
      <View className="items-center gap-1.5 px-0.5 pb-1">
        <View className="flex-row items-center gap-1.5">
          <Text
            className="text-sm"
            style={{
              color: active ? t.colors.foreground : t.colors.mutedForeground,
              fontFamily: active ? t.fonts.semibold : t.fonts.medium,
            }}
            numberOfLines={1}
          >
            {label}
          </Text>
          {count != null ? (
            <Text
              className="font-mono text-2xs"
              style={{ color: active ? t.colors.foreground : t.colors.mutedForeground }}
            >
              {count}
            </Text>
          ) : null}
        </View>
        {/* Der Gilt-Faden unter dem aktiven Chip — Gold nur als Kante. */}
        <View
          style={{
            height: 2,
            width: "100%",
            borderRadius: 1,
            backgroundColor: active ? t.colors.gilt : "transparent",
          }}
        />
      </View>
    </Pressable>
  )
}

function DateRangeRow({
  range,
  onChange,
}: {
  range: DateRange
  onChange: (r: DateRange) => void
}) {
  const select = useCallback(
    (r: DateRange) => {
      if (r === range) return
      haptics.selection()
      onChange(r)
    },
    [range, onChange],
  )
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 18, paddingRight: 8 }}
      accessibilityRole="tablist"
    >
      {DATE_RANGE_ORDER.map((r) => (
        <FilterChip
          key={r}
          label={DATE_RANGE_LABELS[r]}
          count={null}
          active={range === r}
          onPress={() => select(r)}
        />
      ))}
    </ScrollView>
  )
}

function CategoryRow({
  filter,
  onChange,
  byCategory,
  total,
}: {
  filter: CategoryFilter
  onChange: (f: CategoryFilter) => void
  byCategory: Readonly<Record<EventCategory, number>>
  total: number
}) {
  const select = useCallback(
    (f: CategoryFilter) => {
      if (f === filter) return
      haptics.selection()
      onChange(f)
    },
    [filter, onChange],
  )
  // Only show category chips that actually occur in the loaded page — a chip with
  // a real count is honest; an always-on chip reading "0" is noise.
  const present = CATEGORY_ORDER.filter((c) => byCategory[c] > 0)
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 18, paddingRight: 8 }}
      accessibilityRole="tablist"
    >
      <FilterChip
        label="Alle"
        count={total}
        active={filter === "ALL"}
        onPress={() => select("ALL")}
      />
      {present.map((c) => (
        <FilterChip
          key={c}
          label={categoryMeta(c).label}
          count={byCategory[c]}
          active={filter === c}
          onPress={() => select(c)}
        />
      ))}
    </ScrollView>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Eine Ereignis-Zeile — eine NACKTE Zeile auf dem Papier (kein Kasten, kein
// getöntes Glyph-Chip). Ein ruhiges Kategorie-Glyph, die deutsche Überschrift,
// die Uhrzeit, und eine leise Meta-Zeile (Entität · Akteur). Ein Sicherheits-
// Signal trägt einen leisen wax-roten Faden (die einzige laute Kategorie).
// Getrennt nur durch eine warme Haarlinie zwischen den Zeilen.
// ────────────────────────────────────────────────────────────────────────────

function MetaDot() {
  const t = useW14Theme()
  return <Text className="text-2xs" style={{ color: t.colors.mutedForeground }}>·</Text>
}

function EventRow({ row, onPress }: { row: LedgerListRow; onPress: () => void }) {
  const t = useW14Theme()
  const meta = categoryMeta(eventCategory(row.eventType))
  const Icon = meta.icon
  const title = eventLabel(row.eventType)
  const actor = actorInfo(row.actorUserId, row.payload)
  const entity = entityLabel(row.entityTable)
  const time = formatEventTime(row.createdAt)
  // Ein Sicherheits-Signal trägt echte Bedeutung — wax-rot. Sonst bleibt das
  // Glyph ruhige Tinte (Funktionsfarbe nur für Bedeutung, DESIGN-SYSTEM.md §1).
  const tint = meta.emphasis ? t.colors.destructive : t.colors.foreground

  return (
    <PressableScale
      onPress={() => {
        haptics.selection()
        onPress()
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${entity}. ${actor.label}. ${time ?? ""}. Details öffnen.`}
    >
      <View className="flex-row items-start gap-3 py-3.5">
        {/* Das Kategorie-Glyph sitzt bare — kein getöntes Chip-Kästchen. */}
        <View className="h-9 w-9 items-center justify-center" style={{ marginTop: 1 }}>
          <Icon size={t.icon.lg} color={tint} />
        </View>

        <View className="flex-1 gap-1">
          {/* Titel-Zeile: Überschrift + die Uhrzeit als ruhiger Mono-Stempel. */}
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-base font-semibold leading-tight" numberOfLines={1}>
              {title}
            </Text>
            {meta.emphasis ? (
              <View
                style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.destructive }}
              />
            ) : null}
            {time ? (
              <Text className="text-muted-foreground font-mono text-2xs">{time}</Text>
            ) : null}
          </View>

          {/* Leise Meta-Zeile — Entität · Akteur, in einer ruhigen Reihe. */}
          <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <Text
              className="text-muted-foreground text-2xs font-medium"
              style={{ letterSpacing: 0.3 }}
              numberOfLines={1}
            >
              {entity}
            </Text>
            <MetaDot />
            <Text
              className="text-2xs"
              style={{ color: actor.isHuman ? t.colors.inkAged : t.colors.mutedForeground }}
              numberOfLines={1}
            >
              {actor.label}
            </Text>
          </View>
        </View>
      </View>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Detail — die rohe Wahrheit eines Eintrags (Forensik + Payload), boxlos. Die
// Schlüssel/Wert-Paare leben als nackte Zeilen, getrennt nur durch eine warme
// Haarlinie — kein bordierter Kasten in der Karte.
// ────────────────────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="flex-row items-start justify-between gap-3 py-2">
      <Text className="text-muted-foreground text-xs" style={{ maxWidth: "42%" }} numberOfLines={2}>
        {label}
      </Text>
      <View className="flex-1 items-end">{children}</View>
    </View>
  )
}

function MonoValue({ children }: { children: ReactNode }) {
  return (
    <Text className="text-foreground font-mono text-xs" numberOfLines={1} selectable>
      {children}
    </Text>
  )
}

function PlainValue({ children }: { children: ReactNode }) {
  return (
    <Text className="text-foreground text-xs" numberOfLines={2} selectable>
      {children}
    </Text>
  )
}

/** Eine leise Bereichs-Überschrift im Detail (Forensik / Details). */
function DetailGroupLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      className="text-muted-foreground px-0.5 text-2xs font-semibold"
      style={{ letterSpacing: 0.8 }}
    >
      {children}
    </Text>
  )
}

function EventDetailDialog({
  row,
  open,
  onOpenChange,
}: {
  row: LedgerListRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useW14Theme()
  if (row == null) return null

  const meta = categoryMeta(eventCategory(row.eventType))
  const Icon: LucideIcon = meta.icon
  const tint = meta.emphasis ? t.colors.destructive : t.colors.foreground
  const actor = actorInfo(row.actorUserId, row.payload)
  const fullDate = formatEventDate(row.createdAt)
  const entries = payloadEntries(row.payload)
  const showPayload = hasPayload(row.payload)
  const actorShort = shortId(row.actorUserId)
  const deviceShort = shortId(row.deviceId)
  const entityShort = shortId(row.entityId)
  const hash = shortHash(row.rowHashHex)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <View className="flex-row items-center gap-2.5">
            {/* Das Glyph sitzt bare — kein getönter Disc-Kasten. */}
            <Icon size={t.icon.lg} color={tint} />
            <View className="flex-1">
              <DialogTitle>{eventLabel(row.eventType)}</DialogTitle>
              <DialogDescription>{fullDate ?? "Zeitpunkt unbekannt"}</DialogDescription>
            </View>
            {/* Die Kategorie als leise Gilt-gefädelte Marke, kein Pillen-Kasten. */}
            <View className="flex-row items-center gap-1.5">
              <View
                style={{
                  height: 5,
                  width: 5,
                  borderRadius: 3,
                  backgroundColor: meta.emphasis ? t.colors.destructive : t.colors.gilt,
                }}
              />
              <Text
                className="text-2xs font-medium"
                style={{ color: t.colors.inkAged, letterSpacing: 0.2 }}
              >
                {meta.label}
              </Text>
            </View>
          </View>
        </DialogHeader>

        <ScrollView
          className="max-h-[440px]"
          contentContainerStyle={{ gap: 18 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Forensik (wer · woran · welches Gerät · Signatur) — boxlos ─────── */}
          <View className="gap-1">
            <DetailGroupLabel>Forensik</DetailGroupLabel>
            <View>
              <DetailRow label="Akteur">
                <PlainValue>{actor.label}</PlainValue>
              </DetailRow>
              {actorShort != null ? (
                <>
                  <Hairline />
                  <DetailRow label="Benutzer-Kennung">
                    <MonoValue>{actorShort}</MonoValue>
                  </DetailRow>
                </>
              ) : null}
              <Hairline />
              <DetailRow label="Entität">
                <PlainValue>{entityLabel(row.entityTable)}</PlainValue>
              </DetailRow>
              {entityShort != null ? (
                <>
                  <Hairline />
                  <DetailRow label="Entitäts-Kennung">
                    <MonoValue>{entityShort}</MonoValue>
                  </DetailRow>
                </>
              ) : null}
              {deviceShort != null ? (
                <>
                  <Hairline />
                  <DetailRow label="Gerät">
                    <MonoValue>{deviceShort}</MonoValue>
                  </DetailRow>
                </>
              ) : null}
              {hash != null ? (
                <>
                  <Hairline />
                  <DetailRow label="Zeilen-Signatur">
                    <MonoValue>{hash}</MonoValue>
                  </DetailRow>
                </>
              ) : null}
            </View>
          </View>

          {/* ── Payload (die echten Felder, lesbar; nie erfunden) — boxlos ─────── */}
          {showPayload ? (
            <View className="gap-1">
              <DetailGroupLabel>Details</DetailGroupLabel>
              <View>
                {entries.map((e, i) => (
                  <View key={e.key}>
                    {i > 0 ? <Hairline /> : null}
                    <DetailRow label={e.label}>
                      {e.mono ? (
                        <MonoValue>{e.value}</MonoValue>
                      ) : (
                        <PlainValue>{e.value}</PlainValue>
                      )}
                    </DetailRow>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Text className="text-muted-foreground px-0.5 text-xs leading-5">
              Dieser Eintrag trägt keine zusätzlichen Felder. Typ, Akteur und Zeitpunkt oben sind
              die vollständige Wahrheit.
            </Text>
          )}

          {/* Ehrlicher Hinweis: revisionssicher, unveränderlich. */}
          <View className="gap-1.5 pt-1">
            <Hairline />
            <Text className="text-muted-foreground px-0.5 pt-1.5 text-2xs leading-4">
              {`Eintrag Nr. ${row.id} · revisionssicher und unveränderlich im Protokoll. Die Zeilen-Signatur verkettet jeden Eintrag mit dem vorherigen (GoBD).`}
            </Text>
          </View>
        </ScrollView>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Bildschirm
// ────────────────────────────────────────────────────────────────────────────

export default function TagebuchScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [range, setRange] = useState<DateRange>("all")
  const [category, setCategory] = useState<CategoryFilter>("ALL")
  const [selected, setSelected] = useState<LedgerListRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // The date range is the REAL server filter — it drives the honest `total`.
  // The category filter is applied client-side over the loaded page (the route
  // only knows exact event types, not our category buckets), so its counts read
  // as "in den geladenen Einträgen", never disguised as a server total.
  const rangeQuery = useMemo(() => dateRangeQuery(range), [range])
  const ledger = useQuery(
    () => listLedger({ ...rangeQuery, limit: PAGE_LIMIT }),
    {
      key: `tagebuch:list:${range}`,
      staleTimeMs: 15_000,
    },
  )
  const rc = useRefreshControl(ledger)

  const items = ledger.data?.items ?? []
  const total = ledger.data?.total ?? 0
  const byCategory = useMemo(() => countByCategory(items), [items])

  // Reset the category filter when the loaded page no longer contains it, so a
  // stale chip can never strand the list on an empty client-side filter.
  const effectiveCategory: CategoryFilter =
    category !== "ALL" && byCategory[category] === 0 ? "ALL" : category

  const visible = useMemo(
    () =>
      effectiveCategory === "ALL"
        ? items
        : items.filter((r) => eventCategory(r.eventType) === effectiveCategory),
    [items, effectiveCategory],
  )
  const groups = useMemo(() => groupByDay(visible, (r) => r.createdAt), [visible])

  const latestIso = items.length > 0 ? items[0].createdAt : null
  const firstLoading = ledger.status === "loading" && ledger.data == null
  const hasRows = visible.length > 0
  const categoryActive = effectiveCategory !== "ALL"
  const hardError = ledger.error != null && ledger.data == null

  const openDetail = useCallback((row: LedgerListRow) => {
    setSelected(row)
    setDetailOpen(true)
  }, [])

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand: Tiefe aus dem geschichteten
          Creme plus dieser feinen warmen Struktur, nie eine flache Fläche
          (DESIGN-SYSTEM.md §1, §5). */}
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
        {/* ── Register-Kopf ──────────────────────────────────────────────────── */}
        <View className="gap-4">
          {/* Kicker + Titel — der Protokoll-Faden öffnet mit dem bespoke Siegel. */}
          <View className="gap-1.5">
            <View className="flex-row items-center gap-2">
              <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
              <Text
                className="text-muted-foreground text-2xs font-semibold"
                style={{ letterSpacing: 1.2 }}
              >
                GOBD-PROTOKOLL
              </Text>
            </View>
            <View className="flex-row items-center gap-2.5">
              <LedgerSeal size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
              {/* Bricolage Grotesque display voice (DESIGN-SYSTEM.md §3). */}
              <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
                Tagebuch
              </Text>
            </View>
          </View>

          {firstLoading ? (
            <View className="flex-row items-stretch" accessibilityElementsHidden>
              <View className="flex-1 gap-2">
                <Skeleton width="50%" height={9} />
                <Skeleton width="40%" height={28} />
              </View>
              <Hairline vertical length={40} />
              <View className="flex-[1.3] gap-2" style={{ paddingLeft: 16 }}>
                <Skeleton width="55%" height={9} />
                <Skeleton width="60%" height={20} />
              </View>
            </View>
          ) : hardError ? (
            <InlineError message={ledger.error ?? ""} onRetry={() => void ledger.refetch()} />
          ) : ledger.data != null ? (
            <RegisterBalance total={total} loadedCount={items.length} latestIso={latestIso} />
          ) : null}

          {/* Die warme Haarlinie kappt den Kopf von den Filtern — die eine Linie. */}
          {hardError ? null : (
            <View className="gap-2.5">
              <Hairline />
              {/* Zeitraum (serverseitig) */}
              <DateRangeRow range={range} onChange={setRange} />
              {/* Kategorie (clientseitig über die geladene Seite) */}
              {items.length > 0 ? (
                <CategoryRow
                  filter={effectiveCategory}
                  onChange={setCategory}
                  byCategory={byCategory}
                  total={items.length}
                />
              ) : null}
            </View>
          )}
        </View>

        {/* ── Ereignis-Zeilen (nach Tag gruppiert) ───────────────────────────── */}
        {hardError ? null : (
          <View className="gap-5">
            {firstLoading ? (
              <View accessibilityElementsHidden>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i}>
                    {i > 0 ? <Hairline inset={48} /> : null}
                    <View className="flex-row items-start gap-3 py-3.5">
                      <Skeleton width={36} height={36} radius="card" />
                      <View className="flex-1 gap-2">
                        <Skeleton width="65%" height={14} />
                        <Skeleton width="40%" height={10} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : !hasRows && ledger.data != null ? (
              <EmptyState
                icon={categoryMeta(effectiveCategory === "ALL" ? "system" : effectiveCategory).icon}
                title={
                  categoryActive ? "Keine Einträge in dieser Kategorie" : "Noch keine Einträge"
                }
                description={
                  categoryActive
                    ? "In den geladenen Einträgen liegt nichts in dieser Kategorie. Wähle Alle oder einen größeren Zeitraum."
                    : range === "all"
                      ? "Sobald im Betrieb etwas passiert, ein Verkauf, eine Änderung, eine Anmeldung, erscheint es hier: lückenlos und in der echten Reihenfolge."
                      : "In diesem Zeitraum wurde nichts protokolliert. Wähle einen größeren Zeitraum."
                }
              />
            ) : (
              <View className="gap-5">
                {groups.map((group, gi) => (
                  <View key={group.key} className="gap-0.5">
                    {/* Tages-Überschrift — eine ruhige Overline auf dem Papier. */}
                    <Text
                      className="text-muted-foreground px-0.5 pb-1 text-2xs font-semibold"
                      style={{ letterSpacing: 0.8 }}
                    >
                      {group.heading}
                    </Text>
                    {group.items.map((row, ri) => (
                      <StaggerItem key={row.id} index={Math.min(gi * 4 + ri, 8)} exit={false}>
                        {ri > 0 ? <Hairline inset={48} /> : null}
                        <EventRow row={row} onPress={() => openDetail(row)} />
                      </StaggerItem>
                    ))}
                  </View>
                ))}

                {/* Ehrliche Seiten-Notiz: der Server hält mehr als wir geladen haben. */}
                {ledger.data != null && ledger.data.hasMore ? (
                  <Text className="text-muted-foreground px-1 pt-1 text-center text-2xs">
                    {`Es werden die ${items.length.toLocaleString("de-DE")} jüngsten Einträge dieses Zeitraums gezeigt. Ältere liegen im Protokoll.`}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* ── Ehrlicher Scope-Hinweis ────────────────────────────────────────── */}
        {/* Die EINE bewusste Karte auf dieser Fläche — eine Museums-Tafel, die das
            Protokoll erklärt. Sonst lebt alles boxlos auf dem Papier. */}
        <SectionCard
          title="So funktioniert das Tagebuch"
          subtitle="Ein lückenloses, unveränderliches Protokoll, gelesen und nie verändert."
          icon={categoryMeta("fiscal").icon}
        >
          <Text className="text-muted-foreground text-xs leading-5">
            Jede bedeutsame Handlung im Betrieb schreibt einen unveränderlichen, hash-verketteten
            Eintrag (GoBD). Diese App zeigt das Protokoll ehrlich an, wer, was, wann, und verändert
            nichts daran. Der Zeitraum-Filter läuft serverseitig; der Kategorie-Filter ordnet die
            geladenen Einträge.
          </Text>
        </SectionCard>
      </ScrollView>

      <EventDetailDialog row={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </View>
  )
}
