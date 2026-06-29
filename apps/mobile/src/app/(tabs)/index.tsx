/**
 * Lager — der Personal-Katalog (authentifizierte productsApi, NICHT der
 * öffentliche Storefront) und die meistgenutzte Fläche der App. Native-Grad:
 * flüssige, entprellte Suche mit Lösch-Knopf, eine boxlose Gilt-gefädelte
 * Status-Filterreihe, eine schnelle FlatList mit formtreuem Skelett + ehrlichen
 * Leer-/Fehlerzuständen, und nackte Artikel-Zeilen, die das echte Primärfoto (oder
 * eine getypte Material-Scheibe), den Lagerort, Metall/Gewicht und den Listenpreis
 * in Mono-Ziffern tragen. Tippen öffnet die Detail-/Umlagern-Maske.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Der Katalog lebt direkt auf
 * dem warmen Papier — eine boxlose Verfügbarkeits-Bilanz im Kopf (Verfügbar ·
 * Reserviert · Verkauft, getrennt nur durch eine warme Senk-Haarlinie), eine
 * boxlose Filterreihe mit einem Gilt-Faden unter der aktiven Kategorie, und die
 * Artikel als nackte Zeilen, getrennt nur durch eine einzige warme Haarlinie.
 * Tiefe kommt aus dem geschichteten Papier und der Linie, nie aus gestapelten
 * Karten.
 *
 * Gebaut auf dem geteilten Spine — die Live-Daten-Schicht (useQuery: refetch-on-
 * focus, pull-to-refresh, in-flight de-dupe), QueryBoundary (laden/leer/fehler+
 * erneut), PressableScale-Zeilen + StaggerItem-Eintritt, Auswahl-Haptik bei jedem
 * Tippen und jedem Filterwechsel, und W14-Theme-Tokens durchgehend. Jeder gezeigte
 * Wert ist echt vom Endpunkt; nichts wird erfunden.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Image } from "expo-image"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native"
import { useNavigation, useRouter } from "expo-router"
import { ApiOfflineQueuedError } from "@warehouse14/api-client"
import type { Metal, ProductListRow, ProductStatus } from "@warehouse14/api-client"
import { Globe, MapPin, PackagePlus, Plus, RefreshCw, Search, Store, X } from "lucide-react-native"

import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { absoluteUrl, describeError, formatEur, listProducts } from "@/warehouse14/api"
import {
  availabilitySummaryLine,
  bucketCount,
  type AvailabilityBucket,
  type InventoryCounts,
} from "@/warehouse14/availability-ui"
import { useInventoryCounts } from "@/warehouse14/use-inventory-counts"
import { OfflineNotice, StaleBadge, useCachedQuery } from "@/warehouse14/offline"
import { formatLocation, STATUS_FILTERS, statusLabel } from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  Hairline,
  haptics,
  MetalIcon,
  type MetalKind,
  PaperGrain,
  PressableScale,
  QueryBoundary,
  Skeleton,
  StaggerItem,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

type Filter = ProductStatus | "ALL"

const DEBOUNCE_MS = 300
/** Rows per fetched page — the first page comes from `useQuery`, the rest are
 *  appended on scroll so the operator can reach every article, not just 50. */
const PAGE_SIZE = 50

/** German one-word metal label for a row's meta line (local; no shared edit). */
const METAL_SHORT: Record<Metal, string> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

/** Map a wire metal to the bespoke MetalIcon's kind (the typed material disc). */
const METAL_TO_KIND: Record<Metal, MetalKind> = {
  gold: "GOLD",
  silver: "SILBER",
  platinum: "PLATIN",
  palladium: "PALLADIUM",
}

/** "12,4 g · Gold" / "Gold" / null — the compact material line under a row. */
function materialLine(metal: Metal | null, weightGrams: string | null): string | null {
  const m = metal ? METAL_SHORT[metal] : null
  const w =
    weightGrams && Number.isFinite(Number(weightGrams))
      ? `${Number(weightGrams).toLocaleString("de-DE", { maximumFractionDigits: 1 })} g`
      : null
  if (w && m) return `${w} · ${m}`
  return w ?? m
}

/**
 * The live count to print on a filter chip, or null when there is none to show.
 * „Alle" → the in-stock sum; an availability bucket → its real total; „Entwurf"
 * → null (it is not an availability bucket and we don't fetch its count, so we
 * never print a fabricated number). Null while counts are still loading.
 */
function chipCount(value: Filter, counts: InventoryCounts | null): number | null {
  if (counts == null) return null
  if (value === "ALL") return counts.inStock
  if (value === "AVAILABLE" || value === "RESERVED" || value === "SOLD") {
    return bucketCount(counts, value as AvailabilityBucket)
  }
  return null
}

export default function LagerScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()

  // Header add button → das „Neuer Artikel"-Formular (spiegelt den Kunden-Tab),
  // sodass der Körper keinen doppelten Titel braucht — der Tab zeigt schon „Lager".
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            haptics.selection()
            router.push("/product/neu")
          }}
          accessibilityRole="button"
          accessibilityLabel="Neuen Artikel anlegen"
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
        >
          <Plus color={t.colors.primary} size={22} />
        </Pressable>
      ),
    })
  }, [navigation, router, t.colors.primary])

  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<Filter>("ALL")

  // Live availability counts for the whole catalog — the real per-status totals
  // that feed the boxless balance and label the filter rail („Verfügbar 11"). Read
  // unfiltered (not keyed to the search) so the balance + chip counts are a stable,
  // honest picture of the whole Lager regardless of what's typed in the search box.
  const counts = useInventoryCounts()

  // The debounced query inputs — the text input updates `q` instantly (so the
  // field stays fluid) but the fetch key only changes after the user pauses.
  const [debouncedQ, setDebouncedQ] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  // One live query keyed off the debounced search + the active filter, so the
  // data layer gives us refetch-on-focus (a fresh Entwurf shows up on return),
  // pull-to-refresh and in-flight de-dupe for free. `useCachedQuery` layers the
  // durable last-good read cache under it: switch tabs (or cold-start the app on
  // a dropped LAN) and the catalog paints its last real page instantly instead of
  // a skeleton — marked honestly as cached (StaleBadge) until the live page lands.
  // The cache is keyed by `key`, so each filter/search keeps its own snapshot and
  // we never show filter A's rows under filter B.
  const key = `lager:${filter}:${debouncedQ}`
  const products = useCachedQuery(
    () =>
      listProducts({
        q: debouncedQ || undefined,
        status: filter === "ALL" ? undefined : filter,
        limit: PAGE_SIZE,
      }),
    { key },
  )
  const rc = useRefreshControl(products)

  // ── Pagination ────────────────────────────────────────────────────────────
  // `useQuery` owns the FIRST page (refetch-on-focus, pull-to-refresh, de-dupe).
  // Pages beyond it are accumulated here so an operator can actually reach
  // article 51+ instead of hitting a silent cap. Everything resets the moment
  // the query key (search / filter) changes, so we never mix two result sets.
  const [extra, setExtra] = useState<ProductListRow[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [paging, setPaging] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  })
  // Read inside the async loader without re-creating it on every keystroke.
  const keyRef = useRef(key)
  keyRef.current = key
  const extraRef = useRef(extra)
  extraRef.current = extra
  const firstPageCountRef = useRef(0)
  firstPageCountRef.current = products.data?.items.length ?? 0
  // Set once the backend hands back a short/empty page — the wire-truth that
  // there is nothing left, so we stop paging even if `total` is momentarily
  // ahead of what's reachable (a concurrent delete) and never loop.
  const exhaustedRef = useRef(false)

  // A fresh first page (new key, or a refetch/pull-to-refresh that re-resolved
  // the head) invalidates any accumulated tail — drop it and clear paging state.
  const firstPageStamp = products.updatedAt
  useEffect(() => {
    setExtra([])
    setExhausted(false)
    setPaging({ loading: false, error: null })
    exhaustedRef.current = false
  }, [key, firstPageStamp])

  const loadMore = useCallback(async () => {
    const myKey = keyRef.current
    const offset = firstPageCountRef.current + extraRef.current.length
    if (offset === 0 || exhaustedRef.current) return
    setPaging({ loading: true, error: null })
    try {
      const page = await listProducts({
        q: debouncedQ || undefined,
        status: filter === "ALL" ? undefined : filter,
        limit: PAGE_SIZE,
        offset,
      })
      // Drop a late response whose result set no longer matches the screen.
      if (keyRef.current !== myKey) return
      // The wire said „no more" — stop, even if `total` hasn't caught up yet.
      if (!page.hasMore || page.items.length === 0) {
        exhaustedRef.current = true
        setExhausted(true)
      }
      setExtra((prev) => [...prev, ...page.items])
      setPaging({ loading: false, error: null })
    } catch (err) {
      if (keyRef.current !== myKey) return
      // An offline-queued read is not a failure — just stop the footer spinner.
      if (err instanceof ApiOfflineQueuedError) {
        setPaging({ loading: false, error: null })
        return
      }
      haptics.error()
      setPaging({ loading: false, error: describeError(err) })
    }
  }, [debouncedQ, filter])

  const onPickFilter = useCallback((next: Filter) => {
    if (next === filter) return
    haptics.selection()
    setFilter(next)
  }, [filter])

  const total = products.data?.total ?? 0
  const hasQuery = debouncedQ.length > 0 || filter !== "ALL"

  // The live counts snapshot the balance + chips read. Null until the first real
  // response lands (honesty rule — no count shows until we have one).
  const countsData = counts.data
  const summaryLine = availabilitySummaryLine(countsData)

  // ── Kopf: Suche + boxlose Verfügbarkeits-Bilanz + Gilt-gefädelte Filterreihe ──
  const headerControls = useMemo(
    () => (
      <View className="gap-4 px-4 pb-2 pt-2">
        {/* Suchfeld mit führendem Glyph + Lösch-Knopf. */}
        <View className="relative justify-center">
          <View className="absolute left-3 z-10">
            <Search size={t.icon.sm} color={t.colors.mutedForeground} />
          </View>
          <Input
            value={q}
            onChangeText={setQ}
            placeholder="Suche: SKU, Name, Barcode…"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            className="pl-9 pr-9"
            accessibilityLabel="Lager durchsuchen"
          />
          {q.length > 0 ? (
            <Pressable
              onPress={() => {
                haptics.selection()
                setQ("")
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Suche löschen"
              className="absolute right-2.5 z-10 h-6 w-6 items-center justify-center"
            >
              <X size={t.icon.sm} color={t.colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {/* Boxlose Verfügbarkeits-Bilanz — die echte „was ist verkäuflich"-Wahrheit
            als drei nackte Spalten auf dem Papier, getrennt nur durch eine warme
            Senk-Haarlinie. Keine Karte, keine Kacheln. Stille Skelette bis die
            echten Zahlen landen (keine erfundene Null). */}
        <AvailabilityBalance counts={countsData} />

        {/* Die warme Haarlinie kappt die Bilanz von der Filterreihe. */}
        <Hairline />

        {/* Status-Filter — eine boxlose Reihe; die aktive Kategorie trägt einen
            Gilt-Faden (DESIGN-SYSTEM.md §1: Gold als Faden/Kante). Keine Pillen. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 18, paddingRight: 8 }}
          accessibilityRole="tablist"
        >
          {STATUS_FILTERS.map((opt) => (
            <FilterTab
              key={opt.value}
              label={opt.label}
              // The live count for this chip: an availability bucket (Verfügbar/
              // Reserviert/Verkauft) shows its real total, „Alle" the in-stock sum.
              // „Entwurf" is not an availability bucket → no count (never a faked 0).
              count={chipCount(opt.value, countsData)}
              active={filter === opt.value}
              onPress={() => onPickFilter(opt.value)}
            />
          ))}
        </ScrollView>
      </View>
    ),
    [q, filter, countsData, t.icon.sm, t.colors.mutedForeground, onPickFilter],
  )

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung: Tiefe aus dem geschichteten Cream plus
          diese feine warme Zahnung, nie ein flacher Fill (DESIGN-SYSTEM.md §1). */}
      <PaperGrain />
      {headerControls}

      {/* The inline, in-context offline note self-subscribes to the connection
          store and shows ONLY while offline, right above the (last-good) list, so
          the operator knows these rows are the last known stand. */}
      {products.fromCache ? (
        <View className="px-4 pb-1">
          <OfflineNotice />
        </View>
      ) : null}

      <QueryBoundary
        query={products}
        loading={<LagerSkeleton />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          hasQuery
            ? {
                icon: Search,
                title: "Keine Treffer",
                description:
                  "Für diese Suche oder diesen Filter ist kein Artikel im Lager. Suchbegriff anpassen oder Filter zurücksetzen.",
                actionLabel: "Filter zurücksetzen",
                onAction: () => {
                  haptics.selection()
                  setQ("")
                  setFilter("ALL")
                },
              }
            : {
                icon: PackagePlus,
                title: "Noch keine Artikel",
                description: "Lege deinen ersten Artikel an, um den Bestand aufzubauen.",
                actionLabel: "Artikel anlegen",
                onAction: () => {
                  haptics.selection()
                  router.push("/product/neu")
                },
              }
        }
      >
        {(data) => {
          // First page (live) + the accumulated tail, de-duped by id so a row
          // that shifted between pages (a concurrent write) is never doubled.
          const rows = dedupeById(data.items, extra)
          const moreRemain = !exhausted && rows.length < total
          return (
            <FlatList
              style={{ flex: 1 }}
              data={rows}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 2,
                paddingBottom: insets.contentBottom,
              }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl {...rc} />}
              onEndReachedThreshold={0.4}
              onEndReached={() => {
                if (moreRemain && !paging.loading && paging.error == null) void loadMore()
              }}
              ListHeaderComponent={
                <View className="flex-row items-center justify-between pb-1.5 pt-1">
                  <Text
                    className="text-muted-foreground text-2xs font-medium"
                    style={{ letterSpacing: 0.4 }}
                  >
                    {total === 1 ? "1 Artikel" : `${total.toLocaleString("de-DE")} Artikel`}
                    {moreRemain ? ` · ${rows.length.toLocaleString("de-DE")} geladen` : ""}
                  </Text>
                  {/* When the list is the cached seed (live page not yet landed),
                      pin the honest „Stand vor …"-Marker so the count never reads
                      as live. Hidden the instant the real page replaces it. */}
                  {products.fromCache ? (
                    <StaleBadge cachedAt={products.cachedAt} stale={products.isStale} />
                  ) : null}
                </View>
              }
              ListFooterComponent={
                <LagerListFooter
                  loading={paging.loading}
                  error={paging.error}
                  moreRemain={moreRemain}
                  summaryLine={!moreRemain && rows.length > 0 ? summaryLine : null}
                  onRetry={() => void loadMore()}
                />
              }
              renderItem={({ item, index }) => (
                <StaggerItem index={Math.min(index, 8)} exit={false}>
                  {index > 0 ? <Hairline inset={68} /> : null}
                  <ProductRow
                    item={item}
                    onPress={() => {
                      haptics.selection()
                      router.push({ pathname: "/product/[id]", params: { id: item.id } })
                    }}
                  />
                </StaggerItem>
              )}
            />
          )
        }}
      </QueryBoundary>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Verfügbarkeits-Bilanz — die echten Live-Zahlen als boxlose Spalten-Bilanz
// (kein Kasten, keine Kacheln). Verfügbar trägt die Patina-Grün-Bedeutung, die
// anderen bleiben ruhige Tinte. Getrennt nur durch eine warme Senk-Haarlinie.
// ────────────────────────────────────────────────────────────────────────────

function AvailabilityBalance({ counts }: { counts: InventoryCounts | null }) {
  const t = useW14Theme()

  // Honesty: no number prints until the real fan-out lands — show calm skeletons
  // in the exact shape, never a fabricated „0 verfügbar".
  if (counts == null) {
    return (
      <View className="flex-row items-stretch" accessibilityElementsHidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} className="flex-1 flex-row">
            {i > 0 ? <Hairline vertical length={34} /> : null}
            <View className="flex-1 gap-2" style={{ paddingLeft: i > 0 ? 16 : 0 }}>
              <Skeleton width="58%" height={9} />
              <Skeleton width="42%" height={24} />
            </View>
          </View>
        ))}
      </View>
    )
  }

  const cells: { label: string; value: number; color: string }[] = [
    { label: "Verfügbar", value: counts.available, color: t.colors.verdigris },
    { label: "Reserviert", value: counts.reserved, color: t.colors.foreground },
    { label: "Verkauft", value: counts.sold, color: t.colors.mutedForeground },
  ]
  return (
    <View className="flex-row items-stretch">
      {cells.map((cell, i) => (
        <View key={cell.label} className="flex-1 flex-row">
          {i > 0 ? <Hairline vertical length={34} /> : null}
          <View className="flex-1 gap-1" style={{ paddingLeft: i > 0 ? 16 : 0 }}>
            <Text
              className="text-muted-foreground text-2xs font-medium"
              style={{ letterSpacing: 0.6 }}
              numberOfLines={1}
              accessibilityLabel={`${cell.label}, ${cell.value}`}
            >
              {cell.label}
            </Text>
            <Text
              className="font-mono-medium text-3xl leading-none"
              style={{ color: cell.value > 0 ? cell.color : t.colors.mutedForeground }}
            >
              {cell.value.toLocaleString("de-DE")}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Filter-Tab — eine boxlose Reihe; die aktive Kategorie trägt einen Gilt-Faden
// (DESIGN-SYSTEM.md §1: Gold als Faden/Kante). Keine Pillen, keine Kästen.
// ────────────────────────────────────────────────────────────────────────────

function FilterTab({
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
  const countText = count != null ? count.toLocaleString("de-DE") : null
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count != null ? `Filter ${label}, ${count}` : `Filter ${label}`}
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

// ────────────────────────────────────────────────────────────────────────────
// Eine Lager-Zeile — eine NACKTE Zeile auf dem Papier (kein Kasten). Echtes
// Primärfoto (oder eine getypte Material-Scheibe), Name, SKU, Lagerort, Material,
// Listenpreis in Mono + ein ruhiger Verfügbarkeits-Punkt. Getrennt von der
// nächsten Zeile nur durch eine einzige warme Haarlinie.
// ────────────────────────────────────────────────────────────────────────────

/** Status → der ruhige Punkt-Farbton (Bedeutung): Verfügbar grün, Verkauft rot,
 *  Reserviert/Entwurf neutrale Tinte. Nie Dekoration. */
function statusDotColor(status: ProductStatus | string, t: ReturnType<typeof useW14Theme>): string {
  switch (status) {
    case "AVAILABLE":
      return t.colors.verdigris
    case "SOLD":
      return t.colors.destructive
    case "RESERVED":
      return t.colors.inkAged
    default:
      return t.colors.mutedForeground
  }
}

function ProductRow({ item, onPress }: { item: ProductListRow; onPress: () => void }) {
  const t = useW14Theme()
  const material = materialLine(item.metal, item.weightGrams)
  const location = formatLocation(
    item.locationStorageUnit,
    item.locationDrawer,
    item.locationPosition,
  )
  const hasLocation = !!(item.locationStorageUnit || item.locationDrawer || item.locationPosition)
  const metalKind = item.metal ? METAL_TO_KIND[item.metal] : null
  const dotColor = statusDotColor(item.status, t)
  const status = statusLabel(item.status)
  // The status reads as a quiet dot + word, not a filled pill — except SOLD,
  // which earns the wax-red badge tone so a gone article stands out at a glance.
  const soldOff = item.status === "SOLD"

  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={item.name}>
      {/* Box-free row directly on the parchment — no Card border. The single warm
          hairline lives between rows (rendered by the list, inset under the photo). */}
      <View
        className="flex-row items-center gap-3 py-3"
        style={{ opacity: soldOff ? 0.7 : 1 }}
      >
        {/* Thumbnail — das echte Primärfoto, sonst eine getypte Material-Scheibe
            mit dem bespoke MetalIcon (Gold/Silber/Platin/Palladium), sonst der
            ruhige Karton-Glyph. Die Scheibe sitzt auf der erhabenen Papierstufe. */}
        {item.primaryPhotoThumbUrl ? (
          <Image
            source={{ uri: absoluteUrl(item.primaryPhotoThumbUrl) }}
            style={{
              width: 56,
              height: 56,
              borderRadius: t.radii.card,
              backgroundColor: t.colors.raised,
            }}
            contentFit="cover"
            transition={180}
            recyclingKey={item.id}
            cachePolicy="memory-disk"
          />
        ) : (
          <View
            className="items-center justify-center"
            style={{
              width: 56,
              height: 56,
              borderRadius: t.radii.card,
              backgroundColor: t.colors.raised,
            }}
          >
            {metalKind ? (
              <MetalIcon metal={metalKind} size={30} color={t.colors.inkAged} />
            ) : (
              <FallbackGlyph color={t.colors.inkAged} />
            )}
          </View>
        )}

        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold leading-tight" numberOfLines={1}>
            {item.name}
          </Text>
          {/* SKU in Mono — die ruhige Identitäts-Zeile. */}
          <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
            {item.sku}
          </Text>
          {/* Lagerort · Material — eine leise Meta-Reihe in einer Zeile. */}
          <View className="flex-row items-center gap-1">
            <MapPin
              size={t.icon.xs}
              color={hasLocation ? t.colors.inkAged : t.colors.mutedForeground}
            />
            <Text
              className="text-xs"
              style={{ color: hasLocation ? t.colors.inkAged : t.colors.mutedForeground, flexShrink: 1 }}
              numberOfLines={1}
            >
              {location}
            </Text>
            {material ? (
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                {" · "}
                {material}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Preis in Mono-Ziffern (rechtsbündig) + ruhiger Verfügbarkeits-Punkt
            mit Wort + die echten Verkaufskanäle. Keine Karte, keine Pille — bis
            auf den einen wax-roten Verkauft-Marker (Bedeutung, kein Schmuck). */}
        <View className="items-end gap-1.5">
          <Text
            className="font-mono-medium text-base"
            style={{ color: soldOff ? t.colors.mutedForeground : t.colors.foreground }}
            numberOfLines={1}
          >
            {formatEur(item.listPriceEur)}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <View
              style={{ height: 6, width: 6, borderRadius: 3, backgroundColor: dotColor }}
            />
            <Text
              className="text-2xs font-medium"
              style={{ color: soldOff ? t.colors.destructive : t.colors.inkAged, letterSpacing: 0.2 }}
              numberOfLines={1}
            >
              {status}
            </Text>
          </View>
          {/* Sale-channel indicators — real data from listedOnStorefront /
              listedOnEbay. Micro icons + labels, calm ink-faded, never pushing
              the price/name out of alignment. */}
          {item.listedOnStorefront || item.listedOnEbay ? (
            <View className="flex-row items-center gap-2 pt-0.5">
              {item.listedOnStorefront ? (
                <View className="flex-row items-center gap-0.5">
                  <Store size={10} color={t.colors.mutedForeground} />
                  <Text className="text-muted-foreground text-2xs">Im Laden</Text>
                </View>
              ) : null}
              {item.listedOnEbay ? (
                <View className="flex-row items-center gap-0.5">
                  <Globe size={10} color={t.colors.mutedForeground} />
                  <Text className="text-muted-foreground text-2xs">Online</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  )
}

/** The typed fallback disc glyph — a calm carton mark drawn inline so a photo-
 *  less article still reads as a real object, not an empty box. */
function FallbackGlyph({ color }: { color: string }) {
  // A small parcel/box silhouette — the neutral „Artikel ohne Foto" mark.
  return (
    <View
      style={{
        width: 26,
        height: 22,
        borderRadius: 3,
        borderWidth: 1.4,
        borderColor: color,
        opacity: 0.85,
      }}
    >
      {/* Der Deckel-Falz — eine waagerechte Linie oben drittel. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 6,
          height: 1,
          backgroundColor: color,
          opacity: 0.6,
        }}
      />
      {/* Die senkrechte Mittellinie — die zweite Falz. */}
      <View
        style={{
          position: "absolute",
          top: 6,
          bottom: 0,
          left: "50%",
          width: 1,
          backgroundColor: color,
          opacity: 0.6,
        }}
      />
    </View>
  )
}

/** Merge the live first page with the accumulated tail, keeping first-seen
 *  order and dropping any id that appears twice (a row that moved between
 *  pages due to a concurrent write) so a key is never duplicated in the list. */
function dedupeById(
  first: readonly ProductListRow[],
  rest: readonly ProductListRow[],
): ProductListRow[] {
  const seen = new Set<string>()
  const out: ProductListRow[] = []
  for (const row of first) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  for (const row of rest) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

/** The paging footer: a quiet spinner while the next page loads, an honest
 *  retry chip if it failed (a load FAILURE is never shown as „end of list"),
 *  and — once the whole Lager is on screen — the calm availability triad as a
 *  full-stop, so the operator sees the at-a-glance picture at the list's foot. */
function LagerListFooter({
  loading,
  error,
  moreRemain,
  summaryLine,
  onRetry,
}: {
  loading: boolean
  error: string | null
  moreRemain: boolean
  summaryLine: string | null
  onRetry: () => void
}) {
  const t = useW14Theme()

  if (error != null) {
    return (
      <View className="items-center px-4 pt-4">
        <Text className="text-muted-foreground pb-2 text-center text-xs">{error}</Text>
        <Pressable
          onPress={() => {
            haptics.selection()
            onRetry()
          }}
          accessibilityRole="button"
          accessibilityLabel="Weitere Artikel erneut laden"
          className="flex-row items-center gap-1.5 rounded-full border px-3.5 py-2"
          style={{ borderColor: t.colors.border }}
        >
          <RefreshCw size={t.icon.xs} color={t.colors.primary} />
          <Text className="text-primary text-sm font-medium">Erneut laden</Text>
        </Pressable>
      </View>
    )
  }

  if (loading) {
    return (
      <View className="items-center py-5" accessibilityElementsHidden>
        <ActivityIndicator color={t.colors.mutedForeground} />
      </View>
    )
  }

  // A calm full-stop once the whole Lager is on screen — the live availability
  // triad as the closing line (only when the counts are real, never a faked 0).
  if (!moreRemain && summaryLine) {
    return (
      <View className="items-center pb-1 pt-5">
        <View className="flex-row items-center gap-2">
          <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
          <Text
            className="text-muted-foreground text-2xs"
            style={{ letterSpacing: 0.2 }}
            numberOfLines={1}
          >
            {summaryLine}
          </Text>
        </View>
      </View>
    )
  }
  if (!moreRemain) return <View className="h-2" />
  return null
}

/** First-load skeleton — the list's shape (a column of row-shaped blocks), so
 *  loading cross-fades into data instead of popping a spinner. */
function LagerSkeleton() {
  return (
    <View className="px-4 pt-1" accessibilityElementsHidden>
      <View className="pb-2">
        <Skeleton width={64} height={10} />
      </View>
      {Array.from({ length: 8 }).map((_, i) => (
        // Box-free skeleton row — matches the real ProductRow (hairline between,
        // inset under the photo; no Card).
        <View key={i}>
          {i > 0 ? <Hairline inset={68} /> : null}
          <View className="flex-row items-center gap-3 py-3">
            <Skeleton width={56} height={56} radius="card" />
            <View className="flex-1 gap-2">
              <Skeleton width="68%" height={14} />
              <Skeleton width="34%" height={10} />
              <Skeleton width="52%" height={11} />
            </View>
            <View className="items-end gap-2">
              <Skeleton width={62} height={14} />
              <Skeleton width={56} height={10} />
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}
