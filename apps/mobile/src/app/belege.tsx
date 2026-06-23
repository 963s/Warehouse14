/**
 * Belege / Dokumente — die Owner-Fläche über das GoBD-Belegregister. Sie ist
 * READ-FIRST und CLIENT-ONLY über die Server-Endpunkte: der Server besitzt den
 * Beleg-Speicher: jede Rechnung, jeder Ankaufbeleg, jeder Versand-, Expertise-,
 * Zertifikat- oder Ausweis-Scan, den ein Verkauf oder Ankauf erzeugt hat, ist
 * hier als Zeile registriert, die auf ein unveränderliches Objekt zeigt
 * (r2-Schlüssel + sha256 für die GoBD-Unveränderlichkeit). Diese Fläche zeigt
 * nur, was wirklich da ist, und erfindet nichts.
 *
 * Aufbau:
 *   • Register-Kopf — echte Summen aus echten Belegen (gesamt, fiskalisch
 *     relevant, archiviert). Nichts da → ehrlicher leerer Zustand.
 *   • Kategorie-Filter — eine ruhige Chip-Reihe (Alle + je Kategorie mit echter
 *     Anzahl). Der Filter läuft serverseitig über den `category`-Parameter.
 *   • Beleg-Zeilen — je Beleg die Kategorie-Badge, der Dateityp, die echte
 *     Dateigröße, die Verknüpfung (Vorgang/Kunde/…), das Datum und — als
 *     Vertrauens-Signal — der verkürzte sha256-Integritäts-Hash. Archivierte
 *     Belege sind ehrlich markiert (GoBD-soft-deleted, nicht versteckt).
 *
 * Ehrlichkeitsregel (absolut): jede Zahl ist eine echte Summe aus einer echten
 * Antwort. Der Byte-Strom eines Belegs liegt im Objekt-Speicher; die App hat
 * KEINEN Download-Endpunkt darauf — also bleibt das Öffnen ehrlich GESPERRT
 * („im Kassensystem öffnen") statt einen Link vorzutäuschen. Die steuerlichen
 * GoBD-Exporte (DATEV, Kassenbericht) leben am Tagesabschluss in der Kasse und
 * werden von dort geteilt; ein ruhiger Hinweis verlinkt dorthin. Gebaut auf dem
 * geteilten Spine (UI-Primitive, §6-Motion + §7-Haptik, nur W14-Theme-Tokens).
 * Deutsche UI.
 */
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import {
  FileText,
  Hash,
  Link2,
  Lock,
  type LucideIcon,
  Receipt,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { describeError, listDocuments } from "@/warehouse14/api"
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
// Register-Kopf — die echten Beleg-Summen
// ────────────────────────────────────────────────────────────────────────────

function RegisterHeader({ summary }: { summary: RegisterSummary }) {
  const t = useW14Theme()
  // The "Belege" tile is the server's exact total (precise at any register size).
  // "Fiskalisch"/"Archiviert" are derived from the loaded rows; if the server
  // holds more than we loaded (`truncated`) they are lower bounds, so we mark
  // them with a „≥" prefix rather than printing a precise number that undercounts.
  const tiles: {
    label: string
    value: number
    active: boolean
    color: string
    /** Whether this tile is a derived lower bound (not the exact server count). */
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
    <View className="flex-row gap-2.5">
      {tiles.map((tile) => (
        <Card key={tile.label} className="flex-1 gap-1.5 px-3 py-3">
          <Text
            className="text-muted-foreground text-2xs font-medium uppercase"
            style={{ letterSpacing: 0.4 }}
            numberOfLines={1}
          >
            {tile.label}
          </Text>
          <Text
            className="font-mono-medium text-2xl"
            style={{ color: tile.active ? tile.color : t.colors.mutedForeground }}
            accessibilityLabel={
              tile.approx ? `${tile.label}, mindestens ${tile.value}` : undefined
            }
          >
            {tile.approx ? `≥${tile.value}` : tile.value}
          </Text>
        </Card>
      ))}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Kategorie-Filter — eine ruhige Chip-Reihe (Alle + je Kategorie)
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
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        count != null
          ? `${label}, ${approx ? "mindestens " : ""}${count}`
          : label
      }
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
        {countText != null ? (
          <Text
            className="font-mono text-2xs"
            style={{
              color: active ? t.colors.primaryForeground : t.colors.mutedForeground,
            }}
          >
            {countText}
          </Text>
        ) : null}
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
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
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
// Eine Beleg-Zeile — echte Metadaten + GoBD-Integrität, Öffnen ehrlich gesperrt
// ────────────────────────────────────────────────────────────────────────────

function DocumentMetaRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon size={t.icon.xs} color={t.colors.mutedForeground} />
      {children}
    </View>
  )
}

function DocumentCard({ doc, meta }: { doc: DocumentRow; meta: CategoryMeta }) {
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
      <Card
        className="gap-3 rounded-xl border px-3.5 py-3"
        style={{ opacity: archived ? 0.6 : 1 }}
      >
        <View className="flex-row items-start gap-3">
          <View
            className="h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: t.colors.primary + "14" }}
          >
            <Icon size={t.icon.md} color={t.colors.primary} />
          </View>
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-base font-semibold" numberOfLines={1}>
                {doc.fileName}
              </Text>
              <Badge variant={meta.variant}>
                <Text>{meta.label}</Text>
              </Badge>
            </View>
            <View className="flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
              <Text className="text-muted-foreground text-2xs font-medium uppercase" style={{ letterSpacing: 0.3 }}>
                {kind}
              </Text>
              {size != null ? (
                <>
                  <Text className="text-muted-foreground text-2xs">·</Text>
                  <Text className="text-muted-foreground font-mono text-2xs">{size}</Text>
                </>
              ) : null}
              {created != null ? (
                <>
                  <Text className="text-muted-foreground text-2xs">·</Text>
                  <Text className="text-muted-foreground text-2xs">{created}</Text>
                </>
              ) : null}
            </View>
          </View>
        </View>

        {/* Verknüpfung + Integrität die ruhige Vertrauens-Zeile. */}
        <View className="gap-1.5 border-t pt-2.5" style={{ borderColor: t.colors.border }}>
          <DocumentMetaRow icon={Link2}>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {link}
            </Text>
          </DocumentMetaRow>
          {hash != null ? (
            <DocumentMetaRow icon={Hash}>
              <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
                {hash}
              </Text>
              <Text className="text-muted-foreground text-2xs">· GoBD-geprüft</Text>
            </DocumentMetaRow>
          ) : null}
        </View>

        {/* Öffnen ehrlich gesperrt: kein Byte-Endpunkt → kein vorgetäuschter Link. */}
        <View className="bg-muted flex-row items-center gap-1.5 rounded-md px-2.5 py-1.5">
          <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
          <Text className="text-muted-foreground flex-1 text-2xs leading-4">
            {archived
              ? "Archiviert Beleg bleibt revisionssicher im Kassensystem."
              : "Öffnen/Teilen erfolgt im Kassensystem (kein App-Download)."}
          </Text>
        </View>
      </Card>
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
  // Die Kopf-Kacheln und die „Alle"-/Kategorie-Chip-Zahlen müssen filter-
  // unabhängig sein und die ganze Register-Wahrheit zeigen. Würden sie aus der
  // unten gefilterten Listen-Abfrage kommen, läse die „Alle"-Chip unter dem
  // Filter „Rechnung" die Rechnungs-Zahl, und die Kacheln würden jenseits einer
  // Seite unterzählen. Diese Abfrage trägt deshalb NIE einen `category`-Filter:
  // ihr Server-`total` ist die exakte Gesamtzahl bei jeder Registergröße; die
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
  // The register summary (header tiles + true "Alle" total + per-category chip
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
  // The header tiles + chips track the filter-free summary query independently of
  // the (filter-keyed) rows query, so switching categories never re-skeletons the
  // header — it only ever loads once on first paint.
  const summaryFirstLoading = summaryQuery.status === "loading" && summary == null

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

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1, §5). */}
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
          <View className="flex-row items-center gap-2">
            <Receipt size={t.icon.lg} color={t.colors.primary} />
            {/* Screen title in the Bricolage Grotesque display voice (DESIGN-SYSTEM.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              Belege & Dokumente
            </Text>
          </View>

          {summaryFirstLoading ? (
            <View className="flex-row gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="flex-1 gap-2 px-3 py-3">
                  <Skeleton width="60%" height={10} />
                  <Skeleton width="40%" height={24} />
                </Card>
              ))}
            </View>
          ) : summaryQuery.error != null && summary == null ? (
            <InlineError
              message={summaryQuery.error}
              onRetry={() => void summaryQuery.refetch()}
            />
          ) : summary != null ? (
            <RegisterHeader summary={summary} />
          ) : null}

          {/* Kategorie-Filter Zahlen stets aus der filter-freien Übersicht. */}
          <FilterRow
            filter={filter}
            onChange={setFilter}
            byCategory={summary?.byCategory ?? emptyByCategory}
            total={total}
            approxCategory={summary?.truncated ?? false}
          />
        </View>

        {/* ── Beleg-Zeilen ───────────────────────────────────────────────────── */}
        <View className="gap-3">
          {firstLoading ? (
            <View className="gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="gap-3 rounded-xl border px-3.5 py-3">
                  <View className="flex-row items-center gap-3">
                    <Skeleton width={40} height={40} radius="card" />
                    <View className="flex-1 gap-2">
                      <Skeleton width="70%" height={14} />
                      <Skeleton width="45%" height={11} />
                    </View>
                  </View>
                  <Skeleton width="100%" height={28} radius="button" />
                </Card>
              ))}
            </View>
          ) : docs.error != null && docs.data == null ? (
            <InlineError message={docs.error} onRetry={() => void docs.refetch()} />
          ) : !hasDocs && docs.data != null ? (
            <EmptyState
              icon={emptyForFilter ? FileText : Receipt}
              title={emptyForFilter ? "Keine Belege in dieser Kategorie" : "Noch keine Belege"}
              description={
                emptyForFilter
                  ? "In dieser Kategorie liegt noch kein Beleg. Wähle Alle oder eine andere Kategorie."
                  : "Sobald am POS ein Verkauf oder Ankauf einen Beleg erzeugt, erscheint er hier revisionssicher und nach Kategorie geordnet."
              }
            />
          ) : (
            <View className="gap-2.5">
              {sorted.map((doc, index) => (
                <StaggerItem key={doc.id} index={Math.min(index, 8)} exit={false}>
                  <DocumentCard doc={doc} meta={categoryMeta(doc.category)} />
                </StaggerItem>
              ))}
              {/* Ehrliche Seiten-Notiz: der Server hält mehr als wir geladen haben. */}
              {docs.data != null && docs.data.hasMore ? (
                <Text className="text-muted-foreground px-1 pt-1 text-center text-2xs">
                  {`Es werden die ${sorted.length} neuesten Belege gezeigt. Weitere liegen im Kassensystem.`}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {/* ── Ehrlicher Scope-Hinweis + Verweis auf die steuerlichen Exporte ─── */}
        <SectionCard
          title="So funktioniert das Belegregister"
          subtitle="Belege liegen revisionssicher im Kassensystem; hier siehst du sie geordnet."
          icon={FileText}
        >
          <Text className="text-muted-foreground text-xs leading-5">
            Jeder Beleg verweist auf eine unveränderliche Datei mit Prüfsumme (sha256) für die
            GoBD-Konformität. Das Öffnen und Teilen der Datei selbst erfolgt im Kassensystem —
            diese App zeigt das Register ehrlich an, ohne einen Download vorzutäuschen.
          </Text>
          <Pressable
            onPress={() => {
              haptics.selection()
              router.push("/kasse" as Href)
            }}
            accessibilityRole="button"
            accessibilityLabel="Zur Kasse steuerliche Exporte (DATEV, Kassenbericht)"
            className="bg-muted mt-1 flex-row items-center gap-1.5 self-start rounded-md px-2.5 py-2"
            style={{ minHeight: t.touch.min }}
          >
            <Receipt size={t.icon.sm} color={t.colors.primary} />
            <Text className="text-sm font-medium" style={{ color: t.colors.primary }}>
              Steuerliche Exporte (DATEV, Kassenbericht) in der Kasse
            </Text>
          </Pressable>
        </SectionCard>
      </ScrollView>
    </View>
  )
}
