/**
 * Suche — the Owner OS global search. One debounced free-text box that fans out
 * over the three things an Owner reaches for from the phone — an Artikel, a
 * Kunde, a recent Beleg. An Artikel / Kunde hit routes straight to the surface
 * that owns it (the product detail, the customer detail); a recent Beleg is an
 * honest read-only confirmation (locator · total · time · storno state) — the
 * app has no transaction-detail / late-storno screen yet, so the row shows the
 * receipt for reference rather than dead-ending on a blank new-sale cart. It is
 * the fast path that keeps the Owner off the desktop cashier: type a name, an
 * SKU, a Kundennummer or a Beleg-Locator and find it.
 *
 * Architecture (the shared spine, no new primitives):
 *   • One `useMultiQuery` fans out over products / customers / recent-Belege with
 *     `Promise.allSettled` semantics, re-keyed on the debounced query — so a
 *     failed Kunden read never blanks the Artikel results, and each section is
 *     honest on its own (real rows, an empty line, or its own error). The
 *     product + customer reads use the server `q`; the Beleg feed has no server
 *     search, so the last-24h sales are filtered client-side in `search-ui`
 *     (honestly scoped + labelled "Letzte Belege").
 *   • A single flattened FlatList renders section headers + rows with a sticky
 *     search header that never unmounts under a state change, `PressableScale`
 *     rows + a `StaggerItem` cascade, and the §7 selection haptic on a navigate.
 *   • Honest states: below `MIN_QUERY_LENGTH` a calm prompt; while the first
 *     fan-out is in flight a shaped skeleton; if EVERY source failed one
 *     `ErrorState` with retry; zero hits an empty line; partial errors a quiet
 *     per-section note so a section that failed never reads as "no results".
 *
 * Honesty rule (DESIGN.md §4): every value shown is a real field off a real wire
 * row — the Listenpreis, the Beleg total, the Kundennummer — formatted through
 * the shared de-DE helpers, never fabricated. Tokens only; German throughout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlatList, Pressable, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import type {
  CustomerListRow,
  ProductListRow,
  RecentTransactionItem,
} from "@warehouse14/api-client"
import { ChevronRight, Receipt, RotateCcw, Search, X } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { formatEur, listCustomers, listProducts, recentTransactions } from "@/warehouse14/api"
import {
  customerHit,
  initialsOf,
  matchTransactions,
  MIN_QUERY_LENGTH,
  productHit,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  SEARCH_SECTIONS,
  type SearchHit,
  type SearchKind,
  type SearchSectionMeta,
  transactionHit,
} from "@/warehouse14/search-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  ErrorState,
  haptics,
  PaperGrain,
  PressableScale,
  Skeleton,
  StaggerItem,
  useMultiQuery,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── Beleg time + storno line ────────────────────────────────────────────────────

/** A recent-Beleg's finalize time as a de-DE clock string, or null when unparseable. */
function belegTime(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

/** The Beleg subtitle: its time, prefixed with the honest storno state. */
function belegSubtitle(row: RecentTransactionItem): string | null {
  const time = belegTime(row.finalizedAt)
  const tag = row.isStorno ? "Storno" : row.alreadyStornoed ? "storniert" : null
  if (tag && time) return `${tag} · ${time}`
  return tag ?? time
}

// ── The flattened list model (header rows + hit rows in one FlatList) ────────────

interface HeaderItem {
  type: "header"
  kind: SearchKind
  meta: SearchSectionMeta
  count: number
  /** A themed German error for this one source, or null. */
  error: string | null
}
interface HitItem {
  type: "hit"
  hit: SearchHit
}
type ListItem = HeaderItem | HitItem

// ── Rows ────────────────────────────────────────────────────────────────────────

/** A section header — the section icon, its German label, and a live count. */
function SectionHeaderRow({ item }: { item: HeaderItem }) {
  const t = useW14Theme()
  const Icon = item.meta.icon
  return (
    <View className="flex-row items-center gap-2 px-1 pb-1 pt-3">
      <Icon size={t.icon.sm} color={t.colors.mutedForeground} />
      <Text
        className="text-muted-foreground text-xs font-semibold uppercase"
        style={{ letterSpacing: 0.8 }}
      >
        {item.meta.label}
      </Text>
      {item.error == null && item.count > 0 ? (
        <Text className="text-muted-foreground text-xs">· {item.count}</Text>
      ) : null}
    </View>
  )
}

/** A leading visual per hit: a typed disc (Artikel/Beleg) or an initials avatar. */
function HitLeading({ hit }: { hit: SearchHit }) {
  const t = useW14Theme()
  if (hit.kind === "customer") {
    return (
      <View
        className="h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: t.colors.primary + "1f" }}
      >
        <Text className="text-sm font-semibold" style={{ color: t.colors.primary }}>
          {initialsOf(hit.title)}
        </Text>
      </View>
    )
  }
  const Icon = hit.kind === "transaction" ? Receipt : SEARCH_SECTIONS[0].icon
  return (
    <View
      className="h-11 w-11 items-center justify-center rounded-xl"
      style={{ backgroundColor: t.colors.primary + "14" }}
    >
      <Icon size={t.icon.lg} color={t.colors.primary} />
    </View>
  )
}

/** One result row — leading visual · title/subtitle · trailing value · chevron.
 *  A hit WITHOUT a route (a recent Beleg) renders as a calm, non-pressable read:
 *  no chevron, no press affordance — it shows the real receipt for reference and
 *  honestly does not pretend to navigate anywhere. */
function HitRow({ hit, onPress }: { hit: SearchHit; onPress: () => void }) {
  const t = useW14Theme()
  // A Beleg title is a machine locator — render it mono so it scans like a code.
  const titleMono = hit.kind === "transaction"
  const navigable = hit.route != null

  const body = (
    <Card className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
      <HitLeading hit={hit} />
      <View className="flex-1 gap-1">
        <Text
          className={titleMono ? "font-mono-medium text-sm" : "text-base font-semibold"}
          numberOfLines={1}
        >
          {hit.title}
        </Text>
        {hit.subtitle ? (
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {hit.subtitle}
          </Text>
        ) : null}
      </View>
      {hit.trailingEur != null ? (
        <Text className="text-sm font-semibold" numberOfLines={1}>
          {formatEur(hit.trailingEur)}
        </Text>
      ) : null}
      {navigable ? <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} /> : null}
    </Card>
  )

  // Informational, routeless hit → a plain read, not a button.
  if (!navigable) {
    return (
      <View accessibilityLabel={hit.subtitle ? `${hit.title}, ${hit.subtitle}` : hit.title}>
        {body}
      </View>
    )
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hit.subtitle ? `${hit.title}, ${hit.subtitle}` : hit.title}
    >
      {body}
    </PressableScale>
  )
}

/** A quiet per-section note when ONE source failed (so it never reads as empty). */
function SectionErrorNote({ message }: { message: string }) {
  const t = useW14Theme()
  return (
    <View className="px-1 pb-1">
      <Text className="text-xs" style={{ color: t.colors.destructive }} numberOfLines={2}>
        {message}
      </Text>
    </View>
  )
}

/** The first-load placeholder — three section-shaped blocks, never a spinner. */
function SearchSkeleton() {
  return (
    <View className="gap-4 pt-3">
      {Array.from({ length: 2 }).map((_, s) => (
        <View key={s} className="gap-2.5">
          <Skeleton width="32%" height={11} />
          {Array.from({ length: 3 }).map((__, i) => (
            <Card key={i} className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
              <Skeleton width={44} height={44} radius="card" />
              <View className="flex-1 gap-2">
                <Skeleton width="62%" height={14} />
                <Skeleton width="38%" height={11} />
              </View>
              <Skeleton width={56} height={14} />
            </Card>
          ))}
        </View>
      ))}
    </View>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────────

export default function SucheScreen() {
  const t = useW14Theme()
  const router = useRouter()
  const insets = useScreenInsets()

  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  // Only fan out once the query is long enough to be meaningful — below that we
  // show a calm prompt and never touch the network.
  const active = debouncedQ.length >= MIN_QUERY_LENGTH

  // One fan-out over the three domains, settled independently so one failing
  // source never blanks the others. Re-keyed on the debounced query so the spine
  // drives the loading state + de-dupes in-flight requests. Disabled (no key
  // change → no fetch) until the query is active.
  const search = useMultiQuery(
    {
      products: () => listProducts({ q: debouncedQ, limit: SEARCH_LIMIT }),
      customers: () => listCustomers({ q: debouncedQ, limit: SEARCH_LIMIT }),
      transactions: () => recentTransactions(),
    },
    { key: `suche:${debouncedQ}`, enabled: active, refetchOnFocus: false },
  )

  const openHit = useCallback(
    (hit: SearchHit) => {
      // A routeless hit (a recent Beleg) is informational — no destination to
      // honour, so it never navigates. The row below is rendered non-pressable.
      if (!hit.route) return
      haptics.selection()
      router.push({ pathname: hit.route.pathname, params: hit.route.params } as Href)
    },
    [router],
  )

  const clearQuery = useCallback(() => {
    haptics.selection()
    setQ("")
  }, [])

  // Shape the settled per-source results into the flattened header+row list.
  // `settledForQuery` is non-null ONLY once the fan-out for the CURRENT debounced
  // query has settled — so a refine in flight (data momentarily null under the
  // re-keyed spine) yields null here and we fall back to the last good list.
  const { items, totalHits, settledForQuery } = useMemo(() => {
    const out: ListItem[] = []
    let total = 0
    if (!active) return { items: out, totalHits: 0, settledForQuery: false }

    const productRows = (search.results.products.data?.items ?? []) as ProductListRow[]
    const customerRows = (search.results.customers.data?.items ?? []) as CustomerListRow[]
    const recentRows = (search.results.transactions.data?.items ?? []) as RecentTransactionItem[]
    const belegRows = matchTransactions(recentRows, debouncedQ)

    const bySection: Record<SearchKind, { hits: SearchHit[]; error: string | null }> = {
      product: {
        hits: productRows.map(productHit),
        error: search.results.products.error,
      },
      customer: {
        hits: customerRows.map(customerHit),
        error: search.results.customers.error,
      },
      transaction: {
        hits: belegRows.map((r) => transactionHit(r, belegSubtitle(r))),
        error: search.results.transactions.error,
      },
    }

    for (const meta of SEARCH_SECTIONS) {
      const section = bySection[meta.kind]
      // Skip a section that is empty AND healthy — only surface real hits or a
      // real error, never an "0 Treffer" stub for every section.
      if (section.hits.length === 0 && section.error == null) continue
      out.push({
        type: "header",
        kind: meta.kind,
        meta,
        count: section.hits.length,
        error: section.error,
      })
      total += section.hits.length
      for (const hit of section.hits) out.push({ type: "hit", hit })
    }
    return { items: out, totalHits: total, settledForQuery: search.isSettled }
  }, [active, debouncedQ, search.results, search.isSettled])

  // Stale-while-revalidate at the screen level. The spine re-keys per query, so
  // `useQuery` nulls `data` on each refine to never show query A's rows for B —
  // which alone would tear the whole list down to a skeleton on every keystroke.
  // We hold the LAST settled list in a ref and keep rendering it while the next
  // fan-out is in flight, so refining freshens in place instead of flashing.
  const lastShown = useRef<{ items: ListItem[]; totalHits: number }>({ items: [], totalHits: 0 })
  if (settledForQuery) lastShown.current = { items, totalHits }
  // Reset the retained list the moment the box is cleared / falls below the
  // threshold, so a fresh search never momentarily shows a prior query's hits.
  if (!active) lastShown.current = { items: [], totalHits: 0 }

  const shownItems = settledForQuery ? items : lastShown.current.items
  const shownTotal = settledForQuery ? totalHits : lastShown.current.totalHits
  const hasShownHits = shownItems.length > 0

  // First fan-out still settling AND nothing prior to keep on screen — the only
  // moment the full skeleton is honest. A refine with prior hits stays in place.
  const firstLoading = active && !settledForQuery && !hasShownHits
  // Every source failed — the surface may show one error state.
  const allFailed = active && search.allFailed
  // Settled (for THIS query), active, and not a single hit across all sections.
  const noHits = active && settledForQuery && !allFailed && shownTotal === 0

  const header = useMemo(
    () => (
      <View className="bg-background px-4 pb-3 pt-3">
        {/* Bildschirmtitel in der antiken Cormorant-Display-Stimme (DESIGN §3) —
            das Suchfeld ist der Held dieser Fläche, der Titel gibt ihr Ruhe. */}
        <View className="mb-3 flex-row items-center gap-2.5">
          <Search size={t.icon.lg} color={t.colors.primary} />
          <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
            Suche
          </Text>
        </View>
        <View className="justify-center">
          <Input
            value={q}
            onChangeText={setQ}
            placeholder="Artikel, Kunde oder Beleg suchen…"
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
            returnKeyType="search"
            className="pl-10 pr-10"
            accessibilityLabel="Global durchsuchen"
          />
          <View className="absolute left-3" pointerEvents="none" style={{ opacity: 0.7 }}>
            <Search size={t.icon.sm} color={t.colors.mutedForeground} />
          </View>
          {q.length > 0 ? (
            <Pressable
              onPress={clearQuery}
              accessibilityRole="button"
              accessibilityLabel="Suche löschen"
              hitSlop={10}
              className="absolute right-2 h-7 w-7 items-center justify-center rounded-full"
              style={{ backgroundColor: t.colors.border }}
            >
              <X size={t.icon.xs} color={t.colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>
    ),
    [
      q,
      clearQuery,
      t.colors.border,
      t.colors.mutedForeground,
      t.colors.primary,
      t.icon.lg,
      t.icon.sm,
      t.icon.xs,
    ],
  )

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand, hinter der Liste — die
          fixierte Suchkopfzeile bleibt blickdicht, Zeilen scrollen sauber
          darunter (DESIGN.md §1, §5). */}
      <PaperGrain />
      <FlatList
        data={shownItems}
        keyExtractor={(it, i) =>
          it.type === "header" ? `h:${it.kind}` : `r:${it.hit.kind}:${it.hit.id}:${i}`
        }
        stickyHeaderIndices={[0]}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.contentBottom,
          gap: 8,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item, index }) => {
          if (item.type === "header") {
            return (
              <View>
                <SectionHeaderRow item={item} />
                {item.error != null ? <SectionErrorNote message={item.error} /> : null}
              </View>
            )
          }
          return (
            <StaggerItem index={Math.min(index, 10)} exit={false}>
              <HitRow hit={item.hit} onPress={() => openHit(item.hit)} />
            </StaggerItem>
          )
        }}
        ListEmptyComponent={
          !active ? (
            <View className="pt-10">
              <EmptyState
                icon={Search}
                title="Wonach suchst du?"
                description="Finde einen Artikel über Name oder SKU, einen Kunden über Name oder Nummer, oder einen Beleg der letzten 24 Stunden."
              />
            </View>
          ) : firstLoading ? (
            <SearchSkeleton />
          ) : allFailed ? (
            <View className="pt-6">
              <ErrorState
                message={search.results.products.error}
                cause={search.results.products.errorCause}
                onRetry={() => void search.refetch()}
                retrying={search.isFetching}
              />
            </View>
          ) : noHits ? (
            <View className="pt-10">
              <EmptyState
                icon={RotateCcw}
                title="Keine Treffer"
                description={`Nichts zu „${debouncedQ}“. Prüfe die Schreibweise oder suche nach einem Teil des Namens, der SKU oder der Beleg-Nummer.`}
              />
            </View>
          ) : null
        }
      />
    </View>
  )
}
