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
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { FlatList, Pressable, RefreshControl, View } from "react-native"
import { useNavigation, useRouter } from "expo-router"
import type { CustomerListRow } from "@warehouse14/api-client"
import {
  BadgeCheck,
  UserPlus,
  UserSearch,
  X,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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

/** One customer row — avatar · name · Kundennummer · the flags an operator scans. */
function KundenRow({
  row,
  onPress,
}: {
  row: CustomerListRow
  onPress: () => void
}) {
  const t = useW14Theme()
  const showTrust = TRUST_FLAGGED.has(row.trustLevel)
  const spend = hasTurnover(row.cumulativeSpendEur) ? row.cumulativeSpendEur : null

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.fullName}, Kundennummer ${row.customerNumber}`}
    >
      <Card className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
        {/* Avatar monogram in a soft brass disc — the calm leading anchor. */}
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: t.colors.primary + "1f" }}
        >
          <Text className="text-sm font-semibold" style={{ color: t.colors.primary }}>
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
            {spend != null ? (
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                · {formatEur(spend)}
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
                <Badge variant="destructive" dot>
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
      </Card>
    </PressableScale>
  )
}

/** The first-load placeholder — the list's own shape, never a mid-screen spinner. */
function KundenSkeleton() {
  return (
    <View className="gap-2.5">
      {Array.from({ length: 7 }).map((_, i) => (
        <Card key={i} className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
          <Skeleton width={44} height={44} radius="full" />
          <View className="flex-1 gap-2">
            <Skeleton width="58%" height={14} />
            <Skeleton width="34%" height={11} />
          </View>
          <Skeleton width={64} height={22} radius="button" />
        </Card>
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
    { key: `customers:${debouncedQ}:${kycOnly ? "kyc" : "all"}` },
  )
  const rc = useRefreshControl(customers)

  const rows = customers.data?.items ?? null
  const isSearching = debouncedQ.length > 0 || kycOnly

  const openCustomer = useCallback(
    (id: string) => {
      haptics.selection()
      router.push({ pathname: "/customer/[id]", params: { id } })
    },
    [router],
  )

  const clearSearch = useCallback(() => {
    haptics.selection()
    setQ("")
  }, [])

  const toggleKyc = useCallback((next: boolean) => {
    haptics.selection()
    setKycOnly(next)
  }, [])

  // Header (search + filter chips) is sticky above the list so it never scrolls
  // away — the directory's controls stay reachable.
  const header = useMemo(
    () => (
      <View className="gap-3 bg-background px-4 pb-3 pt-3">
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
        <View className="flex-row flex-wrap gap-2">
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
      </View>
    ),
    [q, kycOnly, clearSearch, toggleKyc, t.colors, t.icon.sm, t.icon.xs],
  )

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas — depth comes from the layered cream + this
          faint tooth, behind the list, never from a flat fill (DESIGN.md §5). */}
      <PaperGrain />
      <FlatList
        data={rows ?? []}
        keyExtractor={(c) => c.id}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.contentBottom,
          gap: 10,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
        renderItem={({ item, index }) => (
          <StaggerItem index={index} exit={false}>
            <KundenRow row={item} onPress={() => openCustomer(item.id)} />
          </StaggerItem>
        )}
        ListEmptyComponent={
          // The spine owns the four states — loading (the list's shaped
          // skeleton), error (the shared ErrorState + Retry), and the real
          // empty result (the Kunden-specific EmptyState copy). Routed through
          // QueryBoundary so Kunden matches the Lager screen; the populated
          // case never reaches here (FlatList drives those via data/renderItem).
          <QueryBoundary
            query={customers}
            loading={
              <View className="pt-1">
                <KundenSkeleton />
              </View>
            }
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
