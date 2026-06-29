/**
 * Belege / Dokumente — die Owner-Fläche über das GoBD-Belegregister. Sie ist
 * READ-FIRST und CLIENT-ONLY über die Server-Endpunkte: der Server besitzt den
 * Beleg-Speicher: jede Rechnung, jeder Ankaufbeleg, jeder Versand-, Expertise-,
 * Zertifikat- oder Ausweis-Scan, den ein Verkauf oder Ankauf erzeugt hat, ist
 * hier als Zeile registriert, die auf ein unveränderliches Objekt zeigt
 * (r2-Schlüssel + sha256 für die GoBD-Unveränderlichkeit). Diese Fläche zeigt
 * nur, was wirklich da ist, und erfindet nichts.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Das Register lebt direkt auf
 * dem warmen Papier — eine ruhige Kopf-Bilanz, eine boxlose Filter-Reihe mit
 * einem Gilt-Faden unter der aktiven Kategorie, und die Belege als nackte Zeilen,
 * getrennt nur durch eine einzige warme Haarlinie. Tiefe kommt aus dem geschich-
 * teten Papier und der Linie, nie aus gestapelten Karten.
 *
 * Aufbau:
 *   • Register-Kopf — echte Summen aus echten Belegen (gesamt, fiskalisch
 *     relevant, archiviert) als boxlose Bilanz. Nichts da → ehrlicher leerer
 *     Zustand.
 *   • Kategorie-Filter — eine ruhige, boxlose Reihe (Alle + je Kategorie mit
 *     echter Anzahl). Die aktive Kategorie trägt einen Gilt-Faden. Der Filter
 *     läuft serverseitig über den `category`-Parameter.
 *   • Beleg-Zeilen — je Beleg ein ruhiges Kategorie-Glyph, der Dateiname, eine
 *     leise Meta-Zeile (Typ · Größe · Datum · Verknüpfung) und — als Vertrauens-
 *     Signal — der verkürzte sha256-Integritäts-Hash. Archivierte Belege sind
 *     ehrlich markiert (GoBD-soft-deleted, nicht versteckt).
 *
 * Ehrlichkeitsregel (absolut): jede Zahl ist eine echte Summe aus einer echten
 * Antwort. Der Byte-Strom eines Belegs liegt im Objekt-Speicher; die App hat
 * KEINEN Download-Endpunkt darauf — also bleibt das Öffnen ehrlich GESPERRT
 * (im Kassensystem öffnen) statt einen Link vorzutäuschen. Die steuerlichen
 * GoBD-Exporte (DATEV, Kassenbericht) leben am Tagesabschluss in der Kasse und
 * werden von dort geteilt; ein ruhiger Hinweis verlinkt dorthin. Gebaut auf dem
 * geteilten Spine (UI-Primitive, §6-Motion + §7-Haptik, nur W14-Theme-Tokens).
 * Deutsche UI.
 */
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import Svg, { Circle, Path } from "react-native-svg"
import {
  FileArchive,
  FileText,
  Hash,
  Link2,
  Lock,
} from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { listDocuments } from "@/warehouse14/api"
import {
  type CategoryMeta,
  categoryMeta,
  CATEGORY_ORDER,
  type DocumentCategory,
  type DocumentRow,
  fileKindLabel,
  formatDocDate,
  formatFileSize,
  isArchived,
  linkSummary,
  type RegisterSummary,
  shortHash,
  sortDocuments,
  summarizeRegister,
} from "@/warehouse14/belege-ui"
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

// The list is a generous page; the register is read-mostly and rarely huge for a
// single shop, so one page covers the common case. The honest hint below the
// list calls out when the server reports more than we fetched.
const PAGE_LIMIT = 100

type Filter = "ALL" | DocumentCategory

// ────────────────────────────────────────────────────────────────────────────
// SealMark — ein bespoke Register-Siegel (react-native-svg). Ein gestempelter
// Kreis mit einem Beleg-/Buch-Falz: die ruhige Marke des GoBD-Registers. Der
// Faden (Falz) tönt in Gilt, der Ring bleibt Tinte — Gold nur als Faden/Siegel.
// ────────────────────────────────────────────────────────────────────────────

function SealMark({
  size = 22,
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
      {/* Beleg-Falz — der Gilt-Faden im Siegel (Gold nur als Faden). */}
      <Path
        d="M9 9 L13.4 9 L15 10.6 L15 15 L9 15 Z"
        stroke={gilt}
        strokeWidth={1.3}
        strokeLinejoin="round"
        fill="none"
      />
      <Path d="M13.2 9 L13.2 10.8 L15 10.8" stroke={gilt} strokeWidth={1} strokeLinejoin="round" fill="none" />
      <Path d="M10.4 12 L13.6 12 M10.4 13.4 L12.6 13.4" stroke={gilt} strokeWidth={0.9} strokeLinecap="round" />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Register-Kopf — die echten Beleg-Summen als boxlose Bilanz (keine Karten)
// ────────────────────────────────────────────────────────────────────────────

function RegisterBalance({ summary }: { summary: RegisterSummary }) {
  const t = useW14Theme()
  // Die „Belege"-Spalte ist die exakte Server-Gesamtzahl (genau bei jeder
  // Registergröße). „Fiskalisch"/„Archiviert" sind aus den geladenen Zeilen
  // abgeleitet; hält der Server mehr als geladen (`truncated`), sind sie untere
  // Schranken und tragen den „≥"-Marker statt einer falschen genauen Zahl.
  const cells: {
    label: string
    value: number
    active: boolean
    color: string
    approx: boolean
  }[] = [
    {
      label: "Belege",
      value: summary.total,
      active: summary.total > 0,
      color: t.colors.primary,
      approx: false,
    },
    {
      label: "Fiskalisch",
      value: summary.fiscal,
      active: summary.fiscal > 0,
      color: t.colors.verdigris,
      approx: summary.truncated,
    },
    {
      label: "Archiviert",
      value: summary.archived,
      active: summary.archived > 0,
      color: t.colors.mutedForeground,
      approx: summary.truncated,
    },
  ]
  return (
    <View className="flex-row items-stretch">
      {cells.map((cell, i) => (
        <View key={cell.label} className="flex-1 flex-row">
          {i > 0 ? <Hairline vertical length={36} /> : null}
          <View className="flex-1 gap-1" style={{ paddingLeft: i > 0 ? 16 : 0 }}>
            <Text
              className="text-muted-foreground text-2xs font-medium"
              style={{ letterSpacing: 0.6 }}
              numberOfLines={1}
            >
              {cell.label}
            </Text>
            <Text
              className="font-mono-medium text-3xl leading-none"
              style={{ color: cell.active ? cell.color : t.colors.mutedForeground }}
              accessibilityLabel={
                cell.approx ? `${cell.label}, mindestens ${cell.value}` : undefined
              }
            >
              {cell.approx ? `≥${cell.value}` : cell.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Kategorie-Filter — eine boxlose Reihe; die aktive Kategorie trägt einen Gilt-
// Faden (DESIGN-SYSTEM.md §1: Gold als Faden/Kante). Keine Pillen, keine Kästen.
// ────────────────────────────────────────────────────────────────────────────

function FilterChip({
  label,
  count,
  approx,
  active,
  onPress,
}: {
  label: string
  count: number | null
  /** Whether `count` is a derived lower bound (server holds more than loaded). */
  approx: boolean
  active: boolean
  onPress: () => void
}) {
  const t = useW14Theme()
  const countText = count != null ? (approx ? `≥${count}` : `${count}`) : null
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        count != null
          ? `${label}, ${approx ? "mindestens " : ""}${count}`
          : label
      }
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
          {countText != null ? (
            <Text
              className="font-mono text-2xs"
              style={{ color: active ? t.colors.foreground : t.colors.mutedForeground }}
            >
              {countText}
            </Text>
          ) : null}
        </View>
        {/* Der Gilt-Faden unter der aktiven Kategorie — Gold nur als Kante. */}
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

function FilterRow({
  filter,
  onChange,
  byCategory,
  total,
  approxCategory,
}: {
  filter: Filter
  onChange: (f: Filter) => void
  byCategory: Readonly<Record<DocumentCategory, number>>
  total: number
  /**
   * Whether the per-category counts are derived lower bounds (the server holds
   * more documents than the summary loaded). The "Alle" total stays exact (it is
   * the server's own count), so only the category chips get the „≥" marker.
   */
  approxCategory: boolean
}) {
  const select = useCallback(
    (f: Filter) => {
      if (f === filter) return
      haptics.selection()
      onChange(f)
    },
    [filter, onChange],
  )
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
        approx={false}
        active={filter === "ALL"}
        onPress={() => select("ALL")}
      />
      {CATEGORY_ORDER.map((cat) => (
        <FilterChip
          key={cat}
          label={categoryMeta(cat).label}
          count={byCategory[cat]}
          approx={approxCategory}
          active={filter === cat}
          onPress={() => select(cat)}
        />
      ))}
    </ScrollView>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Eine Beleg-Zeile — eine NACKTE Zeile auf dem Papier (kein Kasten). Ein ruhiges
// Kategorie-Glyph, der Dateiname, eine leise Meta-Zeile + der Integritäts-Hash.
// Öffnen bleibt ehrlich gesperrt (kein Byte-Endpunkt). Getrennt nur durch eine
// einzige warme Haarlinie zwischen den Zeilen.
// ────────────────────────────────────────────────────────────────────────────

function MetaDot() {
  const t = useW14Theme()
  return <Text className="text-2xs" style={{ color: t.colors.mutedForeground }}>·</Text>
}

function DocumentRow({ doc, meta }: { doc: DocumentRow; meta: CategoryMeta }) {
  const t = useW14Theme()
  const archived = isArchived(doc)
  const size = formatFileSize(doc.sizeBytes)
  const kind = fileKindLabel(doc.mimeType)
  const created = formatDocDate(doc.createdAt)
  const hash = shortHash(doc.sha256Hex)
  const link = linkSummary(doc)
  const Icon = meta.icon

  // The byte stream lives in object storage and the app has no in-reach download
  // URL for it — so "open" stays HONESTLY locked rather than faking a link.
  const onLockedPress = useCallback(() => {
    haptics.warning()
  }, [])

  return (
    <PressableScale
      onPress={onLockedPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}, ${doc.fileName}${
        archived ? ", archiviert" : ""
      }. Öffnen ist in dieser App nicht verfügbar bitte im Kassensystem öffnen.`}
    >
      <View
        className="flex-row items-start gap-3 py-3.5"
        style={{ opacity: archived ? 0.55 : 1 }}
      >
        {/* Das Kategorie-Glyph sitzt bare — kein getöntes Chip-Kästchen. */}
        <View className="h-9 w-9 items-center justify-center" style={{ marginTop: 1 }}>
          <Icon size={t.icon.lg} color={t.colors.foreground} />
        </View>

        <View className="flex-1 gap-1">
          {/* Titel-Zeile: Dateiname + leiser Kategorie-Faden (Gilt-Punkt). */}
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-base font-semibold leading-tight" numberOfLines={1}>
              {doc.fileName}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <View
                style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }}
              />
              <Text
                className="text-2xs font-medium"
                style={{ color: t.colors.inkAged, letterSpacing: 0.2 }}
                numberOfLines={1}
              >
                {meta.label}
              </Text>
            </View>
          </View>

          {/* Leise Meta-Zeile — Typ · Größe · Datum, alles in einer ruhigen Reihe. */}
          <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <Text
              className="text-muted-foreground text-2xs font-medium"
              style={{ letterSpacing: 0.3 }}
            >
              {kind}
            </Text>
            {size != null ? (
              <>
                <MetaDot />
                <Text className="text-muted-foreground font-mono text-2xs">{size}</Text>
              </>
            ) : null}
            {created != null ? (
              <>
                <MetaDot />
                <Text className="text-muted-foreground text-2xs">{created}</Text>
              </>
            ) : null}
          </View>

          {/* Verknüpfung + Integrität — die ruhige Vertrauens-Zeile, ohne Kasten. */}
          <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
            <View className="flex-row items-center gap-1">
              <Link2 size={t.icon.xs} color={t.colors.mutedForeground} />
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                {link}
              </Text>
            </View>
            {hash != null ? (
              <View className="flex-row items-center gap-1">
                <Hash size={t.icon.xs} color={t.colors.mutedForeground} />
                <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
                  {hash}
                </Text>
                <Text className="text-2xs" style={{ color: t.colors.verdigris }}>
                  GoBD-geprüft
                </Text>
              </View>
            ) : null}
          </View>

          {/* Öffnen ehrlich gesperrt — eine leise Inline-Zeile, kein Kasten. */}
          <View className="mt-1 flex-row items-center gap-1.5">
            <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
            <Text className="text-muted-foreground flex-1 text-2xs leading-4">
              {archived
                ? "Archiviert bleibt revisionssicher im Kassensystem."
                : "Öffnen und Teilen erfolgt im Kassensystem."}
            </Text>
          </View>
        </View>
      </View>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Bildschirm
// ────────────────────────────────────────────────────────────────────────────

export default function BelegeScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const router = useRouter()

  const [filter, setFilter] = useState<Filter>("ALL")

  // ── Register-Übersicht — eine eigene, filter-FREIE Abfrage ──────────────────
  // Die Kopf-Bilanz und die „Alle"-/Kategorie-Zahlen müssen filter-unabhängig
  // sein und die ganze Register-Wahrheit zeigen. Würden sie aus der unten
  // gefilterten Listen-Abfrage kommen, läse die „Alle"-Zahl unter dem Filter
  // „Rechnung" die Rechnungs-Zahl, und die Bilanz würde jenseits einer Seite
  // unterzählen. Diese Abfrage trägt deshalb NIE einen `category`-Filter: ihr
  // Server-`total` ist die exakte Gesamtzahl bei jeder Registergröße; die
  // abgeleiteten Teil-Summen (fiskalisch/archiviert/je Kategorie) sind exakt,
  // solange das Register auf eine Seite passt, und werden sonst ehrlich als
  // untere Schranken markiert. Der Schlüssel hängt NICHT vom Filter ab, damit
  // diese Übersicht beim Kategorie-Wechsel stabil bleibt (kein Flackern).
  const summaryQuery = useQuery(
    () =>
      listDocuments({
        includeArchived: true,
        limit: PAGE_LIMIT,
      }),
    {
      key: "belege:summary",
      staleTimeMs: 15_000,
    },
  )

  // The list query is keyed by the active filter so switching categories is a
  // real server-side filter (the displayed ROWS reflect what the server holds),
  // while stale-while-revalidate keeps the previous rows on screen during the
  // refetch. We always include archived so archived rows are dimmed + labelled,
  // never silently dropped. NOTE: this query's `total` is the FILTERED count and
  // must NOT feed the header/chip totals — those come from `summaryQuery` above.
  const docs = useQuery(
    () =>
      listDocuments({
        ...(filter === "ALL" ? {} : { category: filter }),
        includeArchived: true,
        limit: PAGE_LIMIT,
      }),
    {
      key: `belege:list:${filter}`,
      staleTimeMs: 15_000,
    },
  )
  // Pull-to-refresh: the spinner tracks the rows query, but the same pull also
  // refetches the filter-free summary so the header totals and the visible rows
  // stay in lock-step (no stale "Alle" total after a refresh).
  const baseRc = useRefreshControl(docs)
  const rc = useMemo(
    () => ({
      ...baseRc,
      onRefresh: () => {
        baseRc.onRefresh()
        void summaryQuery.refresh()
      },
    }),
    [baseRc, summaryQuery],
  )

  const sorted = useMemo(
    () => (docs.data ? sortDocuments(docs.data.items) : []),
    [docs.data],
  )
  // The register summary (header balance + true "Alle" total + per-category
  // counts) is derived from the filter-free query, so it is honest regardless of
  // the active filter and reports the real server total at any register size.
  const summary = useMemo<RegisterSummary | null>(
    () =>
      summaryQuery.data
        ? summarizeRegister({
            items: summaryQuery.data.items,
            total: summaryQuery.data.total,
            hasMore: summaryQuery.data.hasMore,
          })
        : null,
    [summaryQuery.data],
  )
  const total = summary?.total ?? 0
  const hasDocs = sorted.length > 0
  const firstLoading = docs.status === "loading" && docs.data == null
  // The header balance + chips track the filter-free summary query independently
  // of the (filter-keyed) rows query, so switching categories never re-skeletons
  // the header — it only ever loads once on first paint.
  const summaryFirstLoading = summaryQuery.status === "loading" && summary == null

  // ── Ein einziger, ruhiger Fehlerzustand ─────────────────────────────────────
  // Früher konnten ZWEI Fehlerkarten gleichzeitig stehen (Übersicht + Liste).
  // Wir fassen das zu EINER Karte zusammen: solange die Übersicht nie geladen
  // hat, ist ihr Fehler der eine, der zählt (ohne sie steht der Kopf leer); sonst
  // trägt der Listen-Fehler die eine Karte. So sieht der Owner nie zwei Kästen.
  const summaryHardError =
    summaryQuery.error != null && summary == null ? summaryQuery.error : null
  const listHardError = docs.error != null && docs.data == null ? docs.error : null
  const oneError = summaryHardError ?? listHardError
  const retryAll = useCallback(() => {
    if (summaryHardError != null) void summaryQuery.refetch()
    void docs.refetch()
  }, [summaryHardError, summaryQuery, docs])

  // Empty per-category chip counts while the summary is still loading (the chips
  // simply show no number until the real, filter-free counts arrive).
  const emptyByCategory: Readonly<Record<DocumentCategory, number>> = {
    RECHNUNG: 0,
    ANKAUFBELEG: 0,
    VERSANDBELEG: 0,
    EXPERTISE: 0,
    ZERTIFIKAT: 0,
    AUSWEIS: 0,
  }

  const emptyForFilter = filter !== "ALL"
  const showFilterRow = oneError == null && (summary != null || summaryFirstLoading)

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas: depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN-SYSTEM.md §1, §5). */}
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
          {/* Kicker + Titel — der Register-Faden öffnet mit dem bespoke Siegel. */}
          <View className="gap-1.5">
            <View className="flex-row items-center gap-2">
              <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
              <Text
                className="text-muted-foreground text-2xs font-semibold"
                style={{ letterSpacing: 1.2 }}
              >
                GOBD-REGISTER
              </Text>
            </View>
            <View className="flex-row items-center gap-2.5">
              <SealMark size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
              {/* Bricolage Grotesque display voice (DESIGN-SYSTEM.md §3). */}
              <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
                Belege & Dokumente
              </Text>
            </View>
          </View>

          {summaryFirstLoading ? (
            <View className="flex-row items-stretch" accessibilityElementsHidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <View key={i} className="flex-1 flex-row">
                  {i > 0 ? <Hairline vertical length={36} /> : null}
                  <View className="flex-1 gap-2" style={{ paddingLeft: i > 0 ? 16 : 0 }}>
                    <Skeleton width="55%" height={9} />
                    <Skeleton width="40%" height={26} />
                  </View>
                </View>
              ))}
            </View>
          ) : oneError != null ? (
            // EIN ruhiger Fehlerzustand für das ganze Register (nie zwei Kästen).
            <InlineError message={oneError} onRetry={retryAll} />
          ) : summary != null ? (
            <RegisterBalance summary={summary} />
          ) : null}

          {/* Die warme Haarlinie kappt den Kopf vom Filter — die einzige Linie. */}
          {showFilterRow ? (
            <View className="gap-1">
              <Hairline />
              <FilterRow
                filter={filter}
                onChange={setFilter}
                byCategory={summary?.byCategory ?? emptyByCategory}
                total={total}
                approxCategory={summary?.truncated ?? false}
              />
            </View>
          ) : null}
        </View>

        {/* ── Beleg-Zeilen ───────────────────────────────────────────────────── */}
        {oneError == null ? (
          <View>
            {firstLoading ? (
              <View accessibilityElementsHidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <View key={i}>
                    {i > 0 ? <Hairline inset={48} /> : null}
                    <View className="flex-row items-center gap-3 py-3.5">
                      <Skeleton width={36} height={36} radius="card" />
                      <View className="flex-1 gap-2">
                        <Skeleton width="70%" height={14} />
                        <Skeleton width="50%" height={10} />
                        <Skeleton width="40%" height={10} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : !hasDocs && docs.data != null ? (
              <EmptyState
                icon={emptyForFilter ? FileText : FileArchive}
                title={emptyForFilter ? "Keine Belege in dieser Kategorie" : "Noch keine Belege"}
                description={
                  emptyForFilter
                    ? "In dieser Kategorie liegt noch kein Beleg. Wähle Alle oder eine andere Kategorie."
                    : "Sobald an der Kasse ein Verkauf oder Ankauf einen Beleg erzeugt, erscheint er hier revisionssicher und nach Kategorie geordnet."
                }
              />
            ) : (
              <View>
                {sorted.map((doc, index) => (
                  <StaggerItem key={doc.id} index={Math.min(index, 8)} exit={false}>
                    {index > 0 ? <Hairline inset={48} /> : null}
                    <DocumentRow doc={doc} meta={categoryMeta(doc.category)} />
                  </StaggerItem>
                ))}
                {/* Ehrliche Seiten-Notiz: der Server hält mehr als wir geladen haben. */}
                {docs.data != null && docs.data.hasMore ? (
                  <Text className="text-muted-foreground px-1 pt-3 text-center text-2xs">
                    {`Es werden die ${sorted.length} neuesten Belege gezeigt. Weitere liegen im Kassensystem.`}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        ) : null}

        {/* ── Ehrlicher Scope-Hinweis + Verweis auf die steuerlichen Exporte ─── */}
        {/* Die EINE bewusste Karte auf dieser Fläche — eine Museums-Tafel, die das
            Register erklärt. Sonst lebt alles boxlos auf dem Papier. */}
        <SectionCard
          title="So funktioniert das Belegregister"
          subtitle="Belege liegen revisionssicher im Kassensystem; hier siehst du sie geordnet."
          icon={FileText}
        >
          <Text className="text-muted-foreground text-xs leading-5">
            Jeder Beleg verweist auf eine unveränderliche Datei mit Prüfsumme (sha256) für die
            GoBD-Konformität. Das Öffnen und Teilen der Datei selbst erfolgt im Kassensystem;
            diese App zeigt das Register ehrlich an, ohne einen Download vorzutäuschen.
          </Text>
          {/* Der Verweis sitzt als Gilt-gefädelte Zeile, kein getönter Kasten. */}
          <Hairline />
          <Pressable
            onPress={() => {
              haptics.selection()
              router.push("/kasse" as Href)
            }}
            accessibilityRole="button"
            accessibilityLabel="Zur Kasse, steuerliche Exporte (DATEV, Kassenbericht)"
            className="flex-row items-center gap-2 self-start py-1"
            style={{ minHeight: t.touch.min }}
          >
            <View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }} />
            <Text className="text-sm font-medium" style={{ color: t.colors.foreground }}>
              Steuerliche Exporte (DATEV, Kassenbericht) in der Kasse
            </Text>
          </Pressable>
        </SectionCard>
      </ScrollView>
    </View>
  )
}
