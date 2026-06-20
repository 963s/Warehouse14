/**
 * Lager — the staff catalog (authenticated productsApi, NOT the public
 * storefront). Debounced free-text search + status filter chips, rows as RNR
 * Card; tapping a row opens the detail/relocate modal.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { FlatList, Pressable, RefreshControl, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { Plus } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ProductListRow, ProductStatus } from "@warehouse14/api-client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { describeError, formatEur, listProducts } from "@/warehouse14/api"
import {
  formatLocation,
  STATUS_FILTERS,
  STATUS_LABEL,
  STATUS_VARIANT,
} from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"

type Filter = ProductStatus | "ALL"

export default function LagerScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<Filter>("ALL")
  const [rows, setRows] = useState<ProductListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (query: string, f: Filter) => {
    setError(null)
    try {
      const res = await listProducts({
        q: query.trim() || undefined,
        status: f === "ALL" ? undefined : f,
        limit: 50,
      })
      setRows(res.items)
    } catch (e) {
      setError(describeError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search (300ms) — re-runs on query or filter change.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setLoading(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void load(q, filter), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q, filter, load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load(q, filter)
    setRefreshing(false)
  }, [q, filter, load])

  // Reload when the tab regains focus (e.g. after creating an article), so the
  // new Entwurf shows up without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      void load(q, filter)
    }, [q, filter, load]),
  )

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-4 pt-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold">Lager</Text>
          <Button
            size="sm"
            onPress={() => router.push("/product/neu")}
            accessibilityLabel="Neuen Artikel anlegen"
          >
            <Plus size={16} color={t.colors.primaryForeground} />
            <Text>Neu</Text>
          </Button>
        </View>
        <Input
          value={q}
          onChangeText={setQ}
          placeholder="Suche: SKU, Name…"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <View className="flex-row flex-wrap gap-2">
          {STATUS_FILTERS.map((opt) => (
            <Pressable key={opt.value} onPress={() => setFilter(opt.value)}>
              <Badge variant={filter === opt.value ? "default" : "outline"}>
                <Text>{opt.label}</Text>
              </Badge>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })}>
            <Card className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold" numberOfLines={2}>
                  {item.name}
                </Text>
                <Text className="font-mono text-xs text-muted-foreground">{item.sku}</Text>
                <Text className="text-xs text-accent">
                  {formatLocation(item.locationStorageUnit, item.locationDrawer, item.locationPosition)}
                </Text>
              </View>
              <View className="items-end gap-1.5">
                <Text className="text-primary text-base font-bold">{formatEur(item.listPriceEur)}</Text>
                <Badge variant={STATUS_VARIANT[item.status]}>
                  <Text>{STATUS_LABEL[item.status]}</Text>
                </Badge>
              </View>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? (
            <Text className="text-muted-foreground">Lade Lager…</Text>
          ) : error ? (
            <Card className="gap-2 border-destructive px-4 py-4">
              <Text className="text-destructive text-base font-semibold">Fehler</Text>
              <Text className="text-muted-foreground text-sm">{error}</Text>
            </Card>
          ) : (
            <Text className="text-muted-foreground">Keine Artikel gefunden.</Text>
          )
        }
      />
    </View>
  )
}
