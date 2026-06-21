/**
 * Tagebuch — die Owner-Fläche über das GoBD-Ereignisregister (`ledger_events`).
 * Sie ist READ-ONLY und CLIENT-ONLY über `GET /api/ledger`: der Server besitzt
 * das fortlaufende, hash-verkettete Append-only-Protokoll jeder bedeutsamen
 * Handlung — wer hat wann was getan. Diese Fläche LIEST dieses Protokoll und
 * verändert nichts. Anders als die Benachrichtigungszentrale (die nur die
 * lautesten Ereignisse kuratiert) zeigt das Tagebuch das VOLLSTÄNDIGE Protokoll.
 *
 * Aufbau:
 *   • Register-Kopf — die echte Gesamtzahl der Einträge im gewählten Zeitraum
 *     (vom Server, nicht aus der geladenen Seite geraten) + der jüngste Eintrag.
 *   • Zeitraum-Filter — ehrlich serverseitig über `fromBusinessDay`/`toBusinessDay`
 *     (Heute · 7 Tage · 30 Tage · Alle). Das treibt die echte Gesamtzahl.
 *   • Kategorie-Filter — eine ruhige Chip-Reihe. Der Endpunkt filtert NICHT nach
 *     unserer Kategorie (er kennt nur exakte Ereignistypen), darum filtert diese
 *     Reihe die GELADENEN Einträge clientseitig — die Zähler sind ehrlich als
 *     „in den geladenen Einträgen" zu lesen, nie als Server-Gesamtsumme getarnt.
 *   • Ereignis-Zeilen — nach Tag gruppiert (Heute/Gestern/…), je Zeile die
 *     deutsche Überschrift, der Akteur (wer), die Entität (woran) und die Uhrzeit.
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
import { Activity, type LucideIcon } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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
// Register-Kopf — die echte Gesamtzahl + der jüngste Eintrag
// ────────────────────────────────────────────────────────────────────────────

function RegisterHeader({
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
    <View className="flex-row gap-2.5">
      <Card className="flex-1 gap-1.5 px-3 py-3">
        <Text
          className="text-muted-foreground text-2xs font-medium uppercase"
          style={{ letterSpacing: 0.4 }}
          numberOfLines={1}
        >
          Einträge
        </Text>
        <Text
          className="font-mono-medium text-2xl"
          style={{ color: total > 0 ? t.colors.primary : t.colors.mutedForeground }}
        >
          {total.toLocaleString("de-DE")}
        </Text>
        {total > loadedCount ? (
          <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
            {`${loadedCount.toLocaleString("de-DE")} geladen`}
          </Text>
        ) : null}
      </Card>
      <Card className="flex-[1.4] gap-1.5 px-3 py-3">
        <Text
          className="text-muted-foreground text-2xs font-medium uppercase"
          style={{ letterSpacing: 0.4 }}
          numberOfLines={1}
        >
          Jüngster Eintrag
        </Text>
        <Text
          className="text-base font-semibold"
          style={{ color: latest ? t.colors.foreground : t.colors.mutedForeground }}
          numberOfLines={1}
        >
          {latest ?? "—"}
        </Text>
      </Card>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Filter-Chips (Zeitraum: serverseitig · Kategorie: clientseitig)
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
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
      style={{ minHeight: t.touch.min, justifyContent: "center" }}
    >
      <View
        className="flex-row items-center gap-1.5 rounded-md border px-3 py-1.5"
        style={{
          backgroundColor: active ? t.colors.primary : t.colors.card,
          borderColor: active ? t.colors.primary : t.colors.border,
        }}
      >
        <Text
          className="text-sm font-medium"
          style={{ color: active ? t.colors.primaryForeground : t.colors.foreground }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {count != null ? (
          <Text
            className="font-mono text-2xs"
            style={{
              color: active ? t.colors.primaryForeground : t.colors.mutedForeground,
            }}
          >
            {count}
          </Text>
        ) : null}
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
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
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
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
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
// Eine Ereignis-Zeile (tippbar → Detail)
// ────────────────────────────────────────────────────────────────────────────

function EventRow({ row, onPress }: { row: LedgerListRow; onPress: () => void }) {
  const t = useW14Theme()
  const meta = categoryMeta(eventCategory(row.eventType))
  const Icon = meta.icon
  const title = eventLabel(row.eventType)
  const actor = actorInfo(row.actorUserId, row.payload)
  const entity = entityLabel(row.entityTable)
  const time = formatEventTime(row.createdAt)
  const tint = meta.emphasis ? t.colors.destructive : t.colors.primary

  return (
    <PressableScale
      onPress={() => {
        haptics.selection()
        onPress()
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${entity}. ${actor.label}. ${time ?? ""}. Details öffnen.`}
    >
      <Card className="flex-row items-center gap-3 rounded-xl border px-3.5 py-3">
        <View
          className="h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: tint + "14" }}
        >
          <Icon size={t.icon.md} color={tint} />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-base font-semibold" numberOfLines={1}>
              {title}
            </Text>
            {time ? (
              <Text className="text-muted-foreground font-mono text-2xs">{time}</Text>
            ) : null}
          </View>
          <View className="flex-row flex-wrap items-center gap-x-1.5">
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {entity}
            </Text>
            <Text className="text-muted-foreground text-2xs">·</Text>
            <Text
              className="text-xs"
              style={{ color: actor.isHuman ? t.colors.foreground : t.colors.mutedForeground }}
              numberOfLines={1}
            >
              {actor.label}
            </Text>
          </View>
        </View>
      </Card>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Detail — die rohe Wahrheit eines Eintrags (Forensik + Payload)
// ────────────────────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="flex-row items-start justify-between gap-3 py-1">
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
  const tint = meta.emphasis ? t.colors.destructive : t.colors.primary
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
            <View
              className="h-9 w-9 items-center justify-center rounded-xl"
              style={{ backgroundColor: tint + "14" }}
            >
              <Icon size={t.icon.md} color={tint} />
            </View>
            <View className="flex-1">
              <DialogTitle>{eventLabel(row.eventType)}</DialogTitle>
              <DialogDescription>{fullDate ?? "Zeitpunkt unbekannt"}</DialogDescription>
            </View>
            <Badge variant={meta.variant}>
              <Text>{meta.label}</Text>
            </Badge>
          </View>
        </DialogHeader>

        <ScrollView
          className="max-h-[440px]"
          contentContainerStyle={{ gap: 14 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Forensik (wer · woran · welches Gerät · Signatur) ──────────── */}
          <View className="gap-0.5 rounded-xl border bg-card px-3.5 py-2.5" style={{ borderColor: t.colors.border }}>
            <DetailRow label="Ereignistyp">
              <MonoValue>{row.eventType}</MonoValue>
            </DetailRow>
            <DetailRow label="Akteur">
              <PlainValue>{actor.label}</PlainValue>
            </DetailRow>
            {actorShort != null ? (
              <DetailRow label="Benutzer-ID">
                <MonoValue>{actorShort}</MonoValue>
              </DetailRow>
            ) : null}
            <DetailRow label="Entität">
              <PlainValue>{entityLabel(row.entityTable)}</PlainValue>
            </DetailRow>
            {entityShort != null ? (
              <DetailRow label="Entitäts-ID">
                <MonoValue>{entityShort}</MonoValue>
              </DetailRow>
            ) : null}
            {deviceShort != null ? (
              <DetailRow label="Gerät">
                <MonoValue>{deviceShort}</MonoValue>
              </DetailRow>
            ) : null}
            {hash != null ? (
              <DetailRow label="Zeilen-Signatur">
                <MonoValue>{hash}</MonoValue>
              </DetailRow>
            ) : null}
          </View>

          {/* ── Payload (die echten Felder, lesbar; nie erfunden) ──────────── */}
          {showPayload ? (
            <View className="gap-1.5">
              <Text
                className="text-muted-foreground px-1 text-2xs font-medium uppercase"
                style={{ letterSpacing: 0.4 }}
              >
                Details
              </Text>
              <View
                className="gap-0.5 rounded-xl border bg-card px-3.5 py-2.5"
                style={{ borderColor: t.colors.border }}
              >
                {entries.map((e) => (
                  <DetailRow key={e.key} label={e.label}>
                    {e.mono ? <MonoValue>{e.value}</MonoValue> : <PlainValue>{e.value}</PlainValue>}
                  </DetailRow>
                ))}
              </View>
            </View>
          ) : (
            <Text className="text-muted-foreground px-1 text-xs leading-5">
              Dieser Eintrag trägt keine zusätzlichen Felder — Typ, Akteur und Zeitpunkt oben sind
              die vollständige Wahrheit.
            </Text>
          )}

          {/* Ehrlicher Hinweis: revisionssicher, unveränderlich. */}
          <Text className="text-muted-foreground px-1 text-2xs leading-4">
            Eintrag #{row.id} · revisionssicher und unveränderlich im Protokoll. Die Zeilen-Signatur
            verkettet jeden Eintrag mit dem vorherigen (GoBD).
          </Text>
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

  const openDetail = useCallback((row: LedgerListRow) => {
    setSelected(row)
    setDetailOpen(true)
  }, [])

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand — Tiefe aus dem geschichteten
          Creme plus dieser feinen warmen Struktur, nie eine flache Fläche
          (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* ── Register-Kopf ──────────────────────────────────────────────────── */}
        <View className="gap-3">
          <View className="flex-row items-center gap-2.5">
            <Activity size={t.icon.lg} color={t.colors.primary} />
            {/* Bildschirmtitel in der antiken Cormorant-Display-Stimme (DESIGN §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              Tagebuch
            </Text>
          </View>

          {firstLoading ? (
            <View className="flex-row gap-2.5" accessibilityElementsHidden>
              {[0, 1].map((i) => (
                <Card key={i} className={`${i === 0 ? "flex-1" : "flex-[1.4]"} gap-2 px-3 py-3`}>
                  <Skeleton width="60%" height={10} />
                  <Skeleton width="45%" height={24} />
                </Card>
              ))}
            </View>
          ) : ledger.error != null && ledger.data == null ? (
            <InlineError message={ledger.error} onRetry={() => void ledger.refetch()} />
          ) : ledger.data != null ? (
            <RegisterHeader total={total} loadedCount={items.length} latestIso={latestIso} />
          ) : null}

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

        {/* ── Ereignis-Zeilen (nach Tag gruppiert) ───────────────────────────── */}
        <View className="gap-4">
          {firstLoading ? (
            <View className="gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="flex-row items-center gap-3 rounded-xl border px-3.5 py-3">
                  <Skeleton width={36} height={36} radius="card" />
                  <View className="flex-1 gap-2">
                    <Skeleton width="65%" height={14} />
                    <Skeleton width="40%" height={11} />
                  </View>
                </Card>
              ))}
            </View>
          ) : ledger.error != null && ledger.data == null ? (
            <InlineError message={ledger.error} onRetry={() => void ledger.refetch()} />
          ) : !hasRows && ledger.data != null ? (
            <EmptyState
              icon={Activity}
              title={
                categoryActive ? "Keine Einträge in dieser Kategorie" : "Noch keine Einträge"
              }
              description={
                categoryActive
                  ? "In den geladenen Einträgen liegt nichts in dieser Kategorie. Wähle „Alle“ oder einen größeren Zeitraum."
                  : range === "all"
                    ? "Sobald im Betrieb etwas passiert — ein Verkauf, eine Änderung, eine Anmeldung — erscheint es hier, lückenlos und in der echten Reihenfolge."
                    : "In diesem Zeitraum wurde nichts protokolliert. Wähle einen größeren Zeitraum."
              }
            />
          ) : (
            <View className="gap-4">
              {groups.map((group, gi) => (
                <View key={group.key} className="gap-2.5">
                  <Text
                    className="text-muted-foreground px-1 text-2xs font-medium uppercase"
                    style={{ letterSpacing: 0.4 }}
                  >
                    {group.heading}
                  </Text>
                  <View className="gap-2.5">
                    {group.items.map((row, ri) => (
                      <StaggerItem key={row.id} index={Math.min(gi * 4 + ri, 8)} exit={false}>
                        <EventRow row={row} onPress={() => openDetail(row)} />
                      </StaggerItem>
                    ))}
                  </View>
                </View>
              ))}

              {/* Ehrliche Seiten-Notiz: der Server hält mehr, als wir geladen haben. */}
              {ledger.data != null && ledger.data.hasMore ? (
                <Text className="text-muted-foreground px-1 pt-1 text-center text-2xs">
                  {`Es werden die ${items.length.toLocaleString("de-DE")} jüngsten Einträge dieses Zeitraums gezeigt. Ältere liegen im Protokoll.`}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {/* ── Ehrlicher Scope-Hinweis ────────────────────────────────────────── */}
        <SectionCard
          title="So funktioniert das Tagebuch"
          subtitle="Ein lückenloses, unveränderliches Protokoll — gelesen, nie verändert."
          icon={Activity}
        >
          <Text className="text-muted-foreground text-xs leading-5">
            Jede bedeutsame Handlung im Betrieb schreibt einen unveränderlichen, hash-verketteten
            Eintrag (GoBD). Diese App zeigt das Protokoll ehrlich an — wer, was, wann — und
            verändert nichts daran. Der Zeitraum-Filter läuft serverseitig; der Kategorie-Filter
            ordnet die geladenen Einträge.
          </Text>
        </SectionCard>
      </ScrollView>

      <EventDetailDialog row={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </View>
  )
}
