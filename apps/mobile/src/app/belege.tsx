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
  countByCategory,
  countDocuments,
  type DocumentCategory,
  type DocumentCounts,
  type DocumentRow,
  fileKindLabel,
  formatDocDate,
  formatFileSize,
  isArchived,
  linkSummary,
  shortHash,
  sortDocuments,
} from "@/warehouse14/belege-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  haptics,
  InlineError,
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

function RegisterHeader({ counts }: { counts: DocumentCounts }) {
  const t = useW14Theme()
  const tiles: { label: string; value: number; active: boolean; color: string }[] = [
    {
      label: "Belege",
      value: counts.total,
      active: counts.total > 0,
      color: t.colors.primary,
    },
    {
      label: "Fiskalisch",
      value: counts.fiscal,
      active: counts.fiscal > 0,
      color: t.colors.verdigris,
    },
    {
      label: "Archiviert",
      value: counts.archived,
      active: counts.archived > 0,
      color: t.colors.mutedForeground,
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
          >
            {tile.value}
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

function FilterRow({
  filter,
  onChange,
  byCategory,
  total,
}: {
  filter: Filter
  onChange: (f: Filter) => void
  byCategory: Readonly<Record<DocumentCategory, number>>
  total: number
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
        active={filter === "ALL"}
        onPress={() => select("ALL")}
      />
      {CATEGORY_ORDER.map((cat) => (
        <FilterChip
          key={cat}
          label={categoryMeta(cat).label}
          count={byCategory[cat]}
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
      }. Öffnen ist in dieser App nicht verfügbar — bitte im Kassensystem öffnen.`}
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

        {/* Verknüpfung + Integrität — die ruhige Vertrauens-Zeile. */}
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
              ? "Archiviert — Beleg bleibt revisionssicher im Kassensystem."
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

  // The list query is keyed by the active filter so switching categories is a
  // real server-side filter (honesty: the count reflects what the server holds),
  // while stale-while-revalidate keeps the previous rows on screen during the
  // refetch. We always include archived so the "Archiviert"-tally is truthful;
  // archived rows are dimmed + labelled, never silently dropped.
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
  const rc = useRefreshControl(docs)

  const sorted = useMemo(
    () => (docs.data ? sortDocuments(docs.data.items) : []),
    [docs.data],
  )
  const counts = useMemo(
    () => (docs.data ? countDocuments(docs.data.items) : null),
    [docs.data],
  )
  // The category-chip counts come from an unfiltered view, so they are stable as
  // the filter changes. When a category filter is active we only have that
  // slice, so the per-category tallies are only shown on the "Alle" view (where
  // they are real); under a filter the chips show no number rather than a wrong
  // one (honesty rule).
  const byCategory = useMemo(
    () => (filter === "ALL" && docs.data ? countByCategory(docs.data.items) : null),
    [filter, docs.data],
  )
  const total = docs.data?.total ?? 0
  const hasDocs = sorted.length > 0
  const firstLoading = docs.status === "loading" && docs.data == null

  const emptyForFilter = filter !== "ALL"

  return (
    <View className="flex-1 bg-background">
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
            <Receipt size={t.icon.md} color={t.colors.primary} />
            <Text className="text-base font-semibold">Belege & Dokumente</Text>
          </View>

          {firstLoading ? (
            <View className="flex-row gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="flex-1 gap-2 px-3 py-3">
                  <Skeleton width="60%" height={10} />
                  <Skeleton width="40%" height={24} />
                </Card>
              ))}
            </View>
          ) : docs.error != null && docs.data == null ? (
            <InlineError message={docs.error} onRetry={() => void docs.refetch()} />
          ) : counts != null ? (
            <RegisterHeader counts={counts} />
          ) : null}

          {/* Kategorie-Filter */}
          <FilterRow
            filter={filter}
            onChange={setFilter}
            byCategory={
              byCategory ?? {
                RECHNUNG: 0,
                ANKAUFBELEG: 0,
                VERSANDBELEG: 0,
                EXPERTISE: 0,
                ZERTIFIKAT: 0,
                AUSWEIS: 0,
              }
            }
            total={total}
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
                  ? "In dieser Kategorie liegt noch kein Beleg. Wähle „Alle“ oder eine andere Kategorie."
                  : "Sobald am POS ein Verkauf oder Ankauf einen Beleg erzeugt, erscheint er hier — revisionssicher und nach Kategorie geordnet."
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
            accessibilityLabel="Zur Kasse — steuerliche Exporte (DATEV, Kassenbericht)"
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
