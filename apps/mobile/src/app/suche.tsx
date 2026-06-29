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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlatList, Pressable, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import Svg, { Circle, Line, Path } from "react-native-svg"
import type {
  CustomerListRow,
  ProductListRow,
  RecentTransactionItem,
} from "@warehouse14/api-client"
import { ChevronRight, Receipt, RotateCcw, Search, X } from "lucide-react-native"

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
  Hairline,
  haptics,
  PaperGrain,
  PressableScale,
  Skeleton,
  StaggerItem,
  useMultiQuery,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── SearchSeal — ein bespoke Such-Siegel (react-native-svg) ──────────────────────
// Eine gestempelte Lupe: der Ring + der Griff sind Tinte, die Fadenkreuz-Linsen im
// Inneren tönen in Gilt — Gold nur als Faden im Siegel, nie als Fläche. Die ruhige
// Marke, mit der die Suche öffnet (DESIGN-SYSTEM.md §1, §6).

function SearchSeal({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Die Linse — der gestempelte Ring in Tinte. */}
      <Circle cx={10.5} cy={10.5} r={6.6} stroke={ink} strokeWidth={1.5} fill="none" />
      <Circle cx={10.5} cy={10.5} r={4.4} stroke={ink} strokeWidth={0.7} strokeOpacity={0.35} fill="none" />
      {/* Der Griff der Lupe — Tinte. */}
      <Line x1={15.4} y1={15.4} x2={20} y2={20} stroke={ink} strokeWidth={1.7} strokeLinecap="round" />
      {/* Das Fadenkreuz in der Linse — der Gilt-Faden (Gold nur als Faden). */}
      <Path
        d="M10.5 7.6 L10.5 13.4 M7.6 10.5 L13.4 10.5"
        stroke={gilt}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
    </Svg>
  )
}

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

/** A section header — a quiet gilt thread, the section icon, its German label,
 *  and a live count. Boxless: it sits bare on the paper, an overline that names
 *  the group, never a tinted bar (DESIGN-SYSTEM.md §1, §6). */
function SectionHeaderRow({ item }: { item: HeaderItem }) {
  const t = useW14Theme()
  const Icon = item.meta.icon
  return (
    <View className="flex-row items-center gap-2 px-1 pb-1.5 pt-4">
      {/* Der Gilt-Faden öffnet die Sektion — Gold nur als Punkt/Kante. */}
      <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
      <Icon size={t.icon.sm} color={t.colors.mutedForeground} />
      <Text
        className="text-muted-foreground text-2xs font-semibold"
        style={{ letterSpacing: 1.1 }}
      >
        {item.meta.label.toUpperCase()}
      </Text>
      {item.error == null && item.count > 0 ? (
        <Text className="text-muted-foreground font-mono text-2xs">· {item.count}</Text>
      ) : null}
    </View>
  )
}

/** The leading visual per hit — BARE on the paper, never a tinted chip box
 *  (DESIGN-SYSTEM.md §1). A Kunde reads as a monogram inside a thin gilt ring
 *  (gold as an edge/seal only); an Artikel / Beleg is a quiet engraved glyph
 *  standing free in ink, separated from the text by whitespace alone. */
function HitLeading({ hit }: { hit: SearchHit }) {
  const t = useW14Theme()
  if (hit.kind === "customer") {
    return (
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ borderWidth: 1, borderColor: t.colors.gilt }}
      >
        <Text className="text-sm font-semibold" style={{ color: t.colors.foreground }}>
          {initialsOf(hit.title)}
        </Text>
      </View>
    )
  }
  const Icon = hit.kind === "transaction" ? Receipt : SEARCH_SECTIONS[0].icon
  return (
    <View className="h-10 w-10 items-center justify-center">
      <Icon size={t.icon.lg} color={t.colors.foreground} strokeWidth={1.6} />
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
    <View className="flex-row items-center gap-3 px-1 py-3">
      <HitLeading hit={hit} />
      <View className="flex-1 gap-0.5">
        <Text
          className={titleMono ? "font-mono-medium text-sm" : "text-base font-semibold leading-tight"}
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
        <Text className="font-mono-medium text-sm" numberOfLines={1}>
          {formatEur(hit.trailingEur)}
        </Text>
      ) : null}
      {navigable ? <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} /> : null}
    </View>
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

/** The first-load placeholder — two section-shaped blocks of bare rows split by
 *  the inset hairline, never a spinner and never a stack of cards. */
function SearchSkeleton() {
  return (
    <View className="gap-5 pt-4" accessibilityElementsHidden>
      {Array.from({ length: 2 }).map((_, s) => (
        <View key={s} className="gap-1">
          <View className="px-1 pb-1.5">
            <Skeleton width="28%" height={10} />
          </View>
          {Array.from({ length: 3 }).map((__, i) => (
            <View key={i}>
              {i > 0 ? <Hairline inset={52} /> : null}
              <View className="flex-row items-center gap-3 px-1 py-3">
                <Skeleton width={40} height={40} radius="full" />
                <View className="flex-1 gap-2">
                  <Skeleton width="62%" height={14} />
                  <Skeleton width="38%" height={11} />
                </View>
                <Skeleton width={56} height={14} />
              </View>
            </View>
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
        {/* Museums-Tafel-Auftakt: Kicker (Gilt-Diamant + Kapitälchen), das bespoke
            Such-Siegel + der Bricolage-Titel (DESIGN-SYSTEM.md §3, §6). Das Suchfeld
            bleibt der Held der Fläche; der Kopf gibt ihr Ruhe, boxlos auf dem Papier. */}
        <View className="mb-3 gap-1.5">
          <View className="flex-row items-center gap-2">
            <View
              style={{
                height: 6,
                width: 6,
                backgroundColor: t.colors.gilt,
                transform: [{ rotate: "45deg" }],
              }}
            />
            <Text
              className="text-muted-foreground text-2xs font-semibold"
              style={{ letterSpacing: 1.2 }}
            >
              GLOBALE SUCHE
            </Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <SearchSeal size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              Suche
            </Text>
          </View>
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
              style={{ backgroundColor: t.colors.raised }}
            >
              <X size={t.icon.xs} color={t.colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        {/* Eine warme Haarlinie kappt den fixierten Kopf von der Liste darunter. */}
        <View className="pt-3">
          <Hairline />
        </View>
      </View>
    ),
    [q, clearQuery, t.colors.gilt, t.colors.primary, t.colors.raised, t.colors.mutedForeground, t.icon.sm, t.icon.xs],
  )

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand, hinter der Liste die
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
          // A row that follows another row in the SAME section carries a single
          // inset hairline above it (the line starts under the text, not under the
          // leading glyph) — the only divider weight. The first row after a header
          // never gets one, so a section opens clean (DESIGN-SYSTEM.md §1, §5).
          const prev = shownItems[index - 1]
          const withinSection = prev != null && prev.type === "hit"
          return (
            <StaggerItem index={Math.min(index, 10)} exit={false}>
              {withinSection ? <Hairline inset={52} /> : null}
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
                description={`Nichts zu ${debouncedQ}. Prüfe die Schreibweise oder suche nach einem Teil des Namens, der SKU oder der Beleg-Nummer.`}
              />
            </View>
          ) : null
        }
      />
    </View>
  )
}
