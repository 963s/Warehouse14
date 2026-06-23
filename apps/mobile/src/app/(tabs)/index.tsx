/**
 * Lager — the staff catalog (authenticated productsApi, NOT the public
 * storefront). Native-grade list: fluid debounced search with a clear button,
 * horizontally-scrolling status filter chips, a fast FlatList with a
 * shape-faithful skeleton + honest empty/error states, refined rows that show
 * the real primary photo (or a typed fallback disc), Lagerort, metal/weight, the
 * Listenpreis and a status Badge. Tapping a row opens the detail/relocate modal.
 *
 * Built on the shared spine — the live-data hook (useQuery: refetch-on-focus,
 * pull-to-refresh, in-flight de-dupe), QueryBoundary (loading/empty/error+retry),
 * PressableScale rows + StaggerItem entrance, selection haptics on every tap and
 * filter change, and W14 theme tokens throughout. Every shown value is real from
 * the endpoint; nothing is fabricated.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native"
import { useNavigation, useRouter } from "expo-router"
import { ApiOfflineQueuedError } from "@warehouse14/api-client"
import type { Metal, ProductListRow, ProductStatus } from "@warehouse14/api-client"
import { Boxes, Globe, MapPin, PackagePlus, Plus, RefreshCw, Search, Store, X } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
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
import { formatLocation, STATUS_FILTERS, statusLabel, statusVariant } from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  haptics,
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

/** "12,4 g Gold" / "Gold" / null — the compact material line under a row. */
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

  // Header add button → the „Neuer Artikel"-Formular (mirrors the Kunden tab),
  // freeing the body of a duplicate title since the tab already shows „Lager".
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
  // that label the filter chips („Verfügbar 11") and the summary line. Read
  // unfiltered (not keyed to the search) so the chip badges are a stable, honest
  // picture of the whole Lager regardless of what's typed in the search box.
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
    haptics.selection()
    setFilter(next)
  }, [])

  const total = products.data?.total ?? 0
  const hasQuery = debouncedQ.length > 0 || filter !== "ALL"

  // The live counts snapshot the chips + summary read. Null until the first real
  // response lands (honesty rule — no count shows until we have one).
  const countsData = counts.data
  const summaryLine = availabilitySummaryLine(countsData)

  const headerControls = useMemo(
    () => (
      <View className="gap-3 px-4 pb-1 pt-2">
        {/* Search field with a leading glyph + a clear button. */}
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

        {/* Status filter chips a single horizontal rail (never wraps/jumps). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingRight: 4 }}
        >
          {STATUS_FILTERS.map((opt) => {
            const active = filter === opt.value
            // The live count for this chip: an availability bucket (Verfügbar/
            // Reserviert/Verkauft) shows its real total, „Alle" shows the in-stock
            // sum. „Entwurf" is not an availability bucket → no count (we never
            // print a fabricated „0" for a number we didn't read).
            const count = chipCount(opt.value, countsData)
            const label = count != null ? `${opt.label} ${count.toLocaleString("de-DE")}` : opt.label
            return (
              <Pressable
                key={opt.value}
                onPress={() => onPickFilter(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  count != null ? `Filter ${opt.label}, ${count}` : `Filter ${opt.label}`
                }
                // The chip is visually compact, so lift the tappable area to the
                // ≥44px minimum (DESIGN.md §8) with vertical hit-slop — the rail
                // still reads as a slim row of chips.
                hitSlop={{ top: 11, bottom: 11 }}
                className="py-1"
              >
                <Badge variant={active ? "default" : "outline"} dot={active && opt.value !== "ALL"}>
                  <Text>{label}</Text>
                </Badge>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
    ),
    [q, filter, countsData, t.icon.sm, t.colors.mutedForeground, onPickFilter],
  )

  return (
    <View className="flex-1 bg-background">
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
              data={rows}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: insets.contentBottom,
                gap: 10,
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
                <View className="gap-0.5 pb-1">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-muted-foreground text-xs">
                      {total === 1 ? "1 Artikel" : `${total.toLocaleString("de-DE")} Artikel`}
                      {moreRemain ? ` · ${rows.length.toLocaleString("de-DE")} geladen` : ""}
                    </Text>
                    {/* When the list is the cached seed (live page not yet landed),
                        pin the honest Stand vor … "-Marker so the count never reads
                        as live. Hidden the instant the real page replaces it. */}
                    {products.fromCache ? (
                      <StaleBadge cachedAt={products.cachedAt} stale={products.isStale} />
                    ) : null}
                  </View>
                  {/* The live availability triad 11 verfügbar · 6 reserviert · 5
                      verkauft" the honest at-a-glance picture of what can be sold.
                      Hidden until the real counts land (no fabricated zeros). */}
                  {summaryLine ? (
                    <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
                      {summaryLine}
                    </Text>
                  ) : null}
                </View>
              }
              ListFooterComponent={
                <LagerListFooter
                  loading={paging.loading}
                  error={paging.error}
                  moreRemain={moreRemain}
                  onRetry={() => void loadMore()}
                />
              }
              renderItem={({ item, index }) => (
                <StaggerItem index={index} exit={false}>
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

/** A single Lager row — real photo (or typed fallback), name, SKU, Lagerort,
 *  material, Listenpreis + status. Presses with the spine's one feedback. */
function ProductRow({ item, onPress }: { item: ProductListRow; onPress: () => void }) {
  const t = useW14Theme()
  const material = materialLine(item.metal, item.weightGrams)
  const location = formatLocation(
    item.locationStorageUnit,
    item.locationDrawer,
    item.locationPosition,
  )
  const hasLocation = !!(item.locationStorageUnit || item.locationDrawer || item.locationPosition)

  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={item.name}>
      {/* Box-free row on the parchment canvas no Card border, separated from
          the next row by a single warm hairline below. Comfortable density. */}
      <View className="hairline-b flex-row items-center gap-3 px-3 py-3">
        {/* Thumbnail the real primary photo, or a typed ink fallback disc. */}
        {item.primaryPhotoThumbUrl ? (
          <Image
            source={{ uri: absoluteUrl(item.primaryPhotoThumbUrl) }}
            style={{
              width: 52,
              height: 52,
              borderRadius: t.radii.button,
              backgroundColor: t.colors.border,
            }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View
            className="items-center justify-center rounded-md"
            style={{ width: 52, height: 52, backgroundColor: t.colors.raised }}
          >
            <Boxes size={t.icon.lg} color={t.colors.foreground} />
          </View>
        )}

        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {item.name}
          </Text>
          <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
            {item.sku}
          </Text>
          <View className="flex-row items-center gap-1">
            <MapPin
              size={t.icon.xs}
              color={hasLocation ? t.colors.foreground : t.colors.mutedForeground}
            />
            <Text
              className={hasLocation ? "text-xs text-foreground" : "text-muted-foreground text-xs"}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
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

        <View className="items-end gap-1.5">
          <Text className="text-foreground font-mono-medium text-base" numberOfLines={1}>
            {formatEur(item.listPriceEur)}
          </Text>
          <Badge variant={statusVariant(item.status)} dot>
            <Text>{statusLabel(item.status)}</Text>
          </Badge>
          {/* Sale-channel indicators — real data from listedOnStorefront /
              listedOnEbay. Micro icons + labels, calm ink-faded, never pushing
              the price/name out of alignment. */}
          {(item.listedOnStorefront || item.listedOnEbay) ? (
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
 *  and nothing once everything is on screen. */
function LagerListFooter({
  loading,
  error,
  moreRemain,
  onRetry,
}: {
  loading: boolean
  error: string | null
  moreRemain: boolean
  onRetry: () => void
}) {
  const t = useW14Theme()

  if (error != null) {
    return (
      <View className="items-center px-4 pt-3">
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
      <View className="items-center py-4" accessibilityElementsHidden>
        <ActivityIndicator color={t.colors.mutedForeground} />
      </View>
    )
  }

  // A calm full-stop once the whole Lager is on screen (only worth showing for
  // a list long enough to have paged at all — `moreRemain` is already false).
  if (!moreRemain) return <View className="h-1" />
  return null
}

/** First-load skeleton — the list's shape (a column of row-shaped blocks), so
 *  loading cross-fades into data instead of popping a spinner. */
function LagerSkeleton() {
  return (
    <View className="gap-2.5 px-4 pt-2" accessibilityElementsHidden>
      <Skeleton width={64} height={11} />
      {Array.from({ length: 7 }).map((_, i) => (
        // Box-free skeleton row — matches the real ProductRow (hairline-b, no Card).
        <View key={i} className="hairline-b flex-row items-center gap-3 px-3 py-3">
          <Skeleton width={52} height={52} radius="button" />
          <View className="flex-1 gap-2">
            <Skeleton width="70%" height={14} />
            <Skeleton width="36%" height={11} />
            <Skeleton width="52%" height={11} />
          </View>
          <View className="items-end gap-2">
            <Skeleton width={62} height={14} />
            <Skeleton width={70} height={18} radius="full" />
          </View>
        </View>
      ))}
    </View>
  )
}
