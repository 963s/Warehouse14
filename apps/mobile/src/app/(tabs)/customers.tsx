/**
 * Kunden — the staff customer directory (authenticated `listCustomers`). A
 * debounced free-text search the route matches on name (ILIKE) or, for an
 * e-mail / phone query, an exact blind-index lookup — Kundennummer is NOT a
 * server match strategy, so the placeholder must not promise it. A quick
 * „KYC bestätigt" filter chip, and rows that read at a glance: an initials avatar, the decrypted
 * full name, the customer number in mono, and the trust/KYC/sanctions flags that
 * matter to an operator. Tapping a row opens the customer detail.
 *
 * Built entirely on the shared spine (DESIGN.md): live data through `useQuery`
 * (refetch-on-focus + pull-to-refresh + in-flight de-dupe), the spine's state
 * components for loading / error / empty rendered IN the list body (a `Skeleton`
 * in the list's own shape, the shared `ErrorState` with Retry, an EmptyState-
 * shaped block) so the sticky search header never unmounts under a state change.
 * The one press-feedback via `PressableScale`, staggered entrance via
 * `StaggerItem`, and a single selection haptic on a navigating tap. Honesty rule
 * holds: every flag and number shown comes from the real list row.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import {
  FlatList,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from "react-native"
import { useNavigation, useRouter } from "expo-router"
import Svg, { Path } from "react-native-svg"
import type { CustomerListRow } from "@warehouse14/api-client"
import {
  BadgeCheck,
  ShieldAlert,
  UserPlus,
  UserSearch,
  X,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { formatEur, listCustomers } from "@/warehouse14/api"
import {
  KYC_STATUS_LABEL,
  KYC_STATUS_VARIANT,
  TRUST_LEVEL_LABEL,
  TRUST_LEVEL_VARIANT,
} from "@/warehouse14/customer-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  haptics,
  PaperGrain,
  PressableScale,
  QueryBoundary,
  Skeleton,
  StaggerItem,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

/** Trust levels worth surfacing on the row — NEW/VERIFIED are the quiet default. */
const TRUST_FLAGGED = new Set<CustomerListRow["trustLevel"]>(["VIP", "SUSPICIOUS", "BANNED"])

/**
 * The house seal — a small gilt diamond ◆, the design-system kicker mark
 * (DESIGN-SYSTEM.md §6: gilt as a seal only, never a fill). Drawn inline so the
 * directory opens with the same diamond that opens every section of the store.
 */
function SealDiamond({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path d="M6 1 L11 6 L6 11 L1 6 Z" fill={color} />
    </Svg>
  )
}

/** N Kunden / N Treffer with grammatical singular — never a bare number. */
function countLabel(n: number, searching: boolean): string {
  const noun = searching ? "Treffer" : n === 1 ? "Kunde" : "Kunden"
  return `${n} ${noun}`
}

/** Hold a value until it stops changing for `ms` — the search debounce, inline so
 *  this surface adds no shared module. Returns the settled value. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
}

/** First letters of the first two name parts → a calm avatar monogram. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A euro string from the wire ("0.00") is empty signal — only show real turnover. */
function hasTurnover(eur: string): boolean {
  const n = Number(eur)
  return Number.isFinite(n) && n > 0
}

/** One customer row — seal · name · Kundennummer · the flags an operator scans.
 *  Memoized (stable `onOpen` from the screen), so a search keystroke re-renders
 *  the list container only, never every visible directory row. */
const KundenRow = memo(function KundenRow({
  row,
  onOpen,
}: {
  row: CustomerListRow
  onOpen: (id: string) => void
}) {
  const t = useW14Theme()
  const showTrust = TRUST_FLAGGED.has(row.trustLevel)
  // A precious-metals shop reads Ankauf turnover first; fall back to spend so the
  // meta line always carries the real figure that exists, never a fabricated 0.
  const ankauf = hasTurnover(row.cumulativeAnkaufEur) ? row.cumulativeAnkaufEur : null
  const spend = hasTurnover(row.cumulativeSpendEur) ? row.cumulativeSpendEur : null
  // The gilt ring is a SEAL with meaning: it appears only on a verified customer
  // (DESIGN-SYSTEM.md §1 — gilt as an edge/seal, never decoration).
  const sealed = row.kycStatus === "VERIFIED"

  return (
    <PressableScale
      onPress={() => onOpen(row.id)}
      accessibilityRole="button"
      accessibilityLabel={`${row.fullName}, Kundennummer ${row.customerNumber}`}
    >
      {/* Box-free row on the parchment canvas — no Card border, separated from
          the next row by a single warm hairline below. */}
      <View className="hairline-b flex-row items-center gap-3 px-4 py-3.5">
        {/* Monogram seal — a parchment disc carrying a single hairline ring.
            The ring gilds for a geprüfter Kunde; otherwise it is the quiet
            rule, so the gold reads as an earned seal, not a fill. */}
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{
            backgroundColor: t.colors.card,
            borderWidth: sealed ? 1.5 : 1,
            borderColor: sealed ? t.colors.gilt : t.colors.border,
          }}
        >
          <Text
            className="text-sm font-semibold"
            style={{ color: sealed ? t.colors.giltDeep : t.colors.foreground }}
          >
            {initialsOf(row.fullName)}
          </Text>
        </View>

        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {row.fullName}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {row.customerNumber}
            </Text>
            {ankauf != null ? (
              <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
                · Ankauf {formatEur(ankauf)}
              </Text>
            ) : spend != null ? (
              <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
                · Umsatz {formatEur(spend)}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="items-end gap-1.5">
          <Badge variant={KYC_STATUS_VARIANT[row.kycStatus]} dot>
            <Text>{KYC_STATUS_LABEL[row.kycStatus]}</Text>
          </Badge>
          {row.sanctionsMatch || showTrust ? (
            <View className="flex-row items-center gap-1.5">
              {row.sanctionsMatch ? (
                <Badge variant="destructive">
                  <ShieldAlert size={t.icon.xs} color={t.colors.primaryForeground} />
                  <Text>Sanktion</Text>
                </Badge>
              ) : null}
              {showTrust ? (
                <Badge variant={TRUST_LEVEL_VARIANT[row.trustLevel]} dot>
                  <Text>{TRUST_LEVEL_LABEL[row.trustLevel]}</Text>
                </Badge>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  )
})

/** The first-load placeholder — the list's own shape, never a mid-screen spinner. */
function KundenSkeleton() {
  return (
    // No gap — the skeleton butts together exactly like the real ledger, so the
    // first paint and the loaded list share one rhythm (no layout jump).
    <View>
      {Array.from({ length: 7 }).map((_, i) => (
        // Box-free skeleton row — matches the real KundenRow (hairline-b, no Card).
        <View key={i} className="hairline-b flex-row items-center gap-3 px-4 py-3.5">
          <Skeleton width={44} height={44} radius="full" />
          <View className="flex-1 gap-2">
            <Skeleton width="58%" height={14} />
            <Skeleton width="34%" height={11} />
          </View>
          <Skeleton width={64} height={22} radius="button" />
        </View>
      ))}
    </View>
  )
}

export default function KundenScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [q, setQ] = useState("")
  const [kycOnly, setKycOnly] = useState(false)
  const debouncedQ = useDebouncedValue(q.trim(), 300)

  // Header add button → the „Neuer Kunde"-Formular.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            haptics.selection()
            router.push("/customer/neu")
          }}
          accessibilityRole="button"
          accessibilityLabel="Neuer Kunde"
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
        >
          <UserPlus color={t.colors.primary} size={t.icon.lg} />
        </Pressable>
      ),
    })
  }, [navigation, router, t.colors.primary, t.icon.lg])

  // One live read, re-keyed on the debounced query + filter so the spine drives
  // the loading state and de-dupes in-flight requests. Refetch-on-focus keeps
  // the directory fresh when you return to the tab.
  const customers = useQuery(
    () =>
      listCustomers({
        q: debouncedQ || undefined,
        kycVerifiedOnly: kycOnly || undefined,
        limit: 50,
      }),
    // Search-as-you-type: keep the previous result's rows on screen while the
    // re-keyed fetch runs, instead of tearing the directory to a skeleton on
    // every debounced keystroke; the fresh result replaces them when it lands.
    { key: `customers:${debouncedQ}:${kycOnly ? "kyc" : "all"}`, keepPreviousData: true },
  )
  const rc = useRefreshControl(customers)

  const rows = customers.data?.items ?? null
  const isSearching = debouncedQ.length > 0 || kycOnly
  // Honest count: the server `total` for the active query — shown only once real
  // rows have loaded, so it never reads a fabricated 0 while the list is empty
  // (the EmptyState owns the no-result case).
  const total = customers.data?.total ?? null
  const countText =
    rows != null && rows.length > 0 && total != null ? countLabel(total, isSearching) : null

  const openCustomer = useCallback(
    (id: string) => {
      haptics.selection()
      router.push({ pathname: "/customer/[id]", params: { id } })
    },
    [router],
  )

  // Stable renderItem (memoized KundenRow + the stable `openCustomer` above),
  // so a keystroke re-renders the list container, not every visible row.
  const renderRow = useCallback(
    ({ item, index }: ListRenderItemInfo<CustomerListRow>) => (
      <StaggerItem index={index} exit={false}>
        <KundenRow row={item} onOpen={openCustomer} />
      </StaggerItem>
    ),
    [openCustomer],
  )

  const clearSearch = useCallback(() => {
    haptics.selection()
    setQ("")
  }, [])

  const toggleKyc = useCallback((next: boolean) => {
    haptics.selection()
    setKycOnly(next)
  }, [])

  // Header (search + filter chips + the honest count) is sticky above the list
  // so it never scrolls away — the directory's controls stay reachable. The
  // hairline-b caps it as a bar so the first row reads as separated, not flush.
  const header = useMemo(
    () => (
      <View className="hairline-b gap-3 bg-background px-4 pb-3 pt-3">
        <View className="justify-center">
          <Input
            value={q}
            onChangeText={setQ}
            placeholder="Suche: Name, E-Mail, Telefon…"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            className="pl-10 pr-10"
            accessibilityLabel="Kunden durchsuchen"
          />
          <View
            className="absolute left-3"
            pointerEvents="none"
            style={{ opacity: 0.7 }}
          >
            <UserSearch size={t.icon.sm} color={t.colors.mutedForeground} />
          </View>
          {q.length > 0 ? (
            <Pressable
              onPress={clearSearch}
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
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row flex-wrap items-center gap-2">
            <Pressable
              onPress={() => toggleKyc(false)}
              accessibilityRole="button"
              accessibilityState={{ selected: !kycOnly }}
            >
              <Badge variant={!kycOnly ? "default" : "outline"}>
                <Text>Alle</Text>
              </Badge>
            </Pressable>
            <Pressable
              onPress={() => toggleKyc(true)}
              accessibilityRole="button"
              accessibilityState={{ selected: kycOnly }}
            >
              <Badge variant={kycOnly ? "success" : "outline"} dot={kycOnly}>
                {!kycOnly ? (
                  <BadgeCheck size={t.icon.xs} color={t.colors.mutedForeground} />
                ) : null}
                <Text>KYC bestätigt</Text>
              </Badge>
            </Pressable>
          </View>
          {/* The directory's header voice — a gilt seal ◆ + the honest count.
              The diamond is the design-system kicker; the number is mono. */}
          {countText != null ? (
            <View className="flex-row items-center gap-1.5">
              <SealDiamond size={8} color={t.colors.gilt} />
              <Text
                className="text-muted-foreground font-mono text-xs"
                numberOfLines={1}
                accessibilityLabel={countText}
              >
                {countText}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    ),
    [q, kycOnly, clearSearch, toggleKyc, countText, t.colors, t.icon.sm, t.icon.xs],
  )

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas depth comes from the layered cream + this
          faint tooth, behind the list, never from a flat fill (DESIGN.md §5). */}
      <PaperGrain />
      <FlatList
        data={rows ?? []}
        keyExtractor={(c) => c.id}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={header}
        // No inter-row gap and no container side padding: the rows butt directly
        // together so the single warm hairline is the ONLY divider — a continuous
        // parchment ledger, not detached strips. Each row owns its own px-4.
        contentContainerStyle={{
          paddingBottom: insets.contentBottom,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
        renderItem={renderRow}
        ListEmptyComponent={
          // The spine owns the four states — loading (the list's shaped
          // skeleton), error (the shared ErrorState + Retry), and the real
          // empty result (the Kunden-specific EmptyState copy). Routed through
          // QueryBoundary so Kunden matches the Lager screen; the populated
          // case never reaches here (FlatList drives those via data/renderItem).
          <QueryBoundary
            query={customers}
            loading={<KundenSkeleton />}
            isEmpty={(d) => d.items.length === 0}
            empty={
              isSearching
                ? {
                    icon: UserSearch,
                    title: "Keine Treffer",
                    description:
                      "Keine Kunden zu dieser Suche. Prüfe die Schreibweise oder lockere den Filter.",
                  }
                : {
                    icon: UserSearch,
                    title: "Noch keine Kunden",
                    description:
                      "Lege den ersten Kunden über das Plus oben rechts an.",
                  }
            }
          >
            {() => null}
          </QueryBoundary>
        }
      />
    </View>
  )
}
