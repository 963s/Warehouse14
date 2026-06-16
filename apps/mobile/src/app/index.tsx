/**
 * Goal 1 — the api-client screen.
 *
 * Pulls REAL catalog data from the dev api-cloud THROUGH the existing
 * @warehouse14/api-client package (storefrontApi.listProducts) and renders the
 * product name + price (formatted with the shared @warehouse14/domain Money
 * type). The reuse IS the proof: no fetch/parse logic lives here.
 */
import { useCallback, useEffect, useState } from "react"
import { FlatList, RefreshControl, View } from "react-native"
import { Link } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { StorefrontProduct } from "@warehouse14/api-client"

import { API_BASE_URL, formatPrice, listProducts } from "@/warehouse14/api"
import { Badge, Button, Card, W14Text } from "@/warehouse14/components"
import { useW14Theme } from "@/warehouse14/theme"

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: StorefrontProduct[]; total: number }

export default function ProductsScreen() {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await listProducts(20)
      setState({ status: "ready", items: res.items, total: res.total })
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <FlatList
        data={state.status === "ready" ? state.items : []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{
          padding: t.space.x4,
          paddingBottom: insets.bottom + t.space.x6,
          gap: t.space.x3,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />
        }
        ListHeaderComponent={
          <View style={{ gap: t.space.x2, marginBottom: t.space.x2 }}>
            <W14Text variant="display">Katalog</W14Text>
            <W14Text variant="caption">
              Live über @warehouse14/api-client · {API_BASE_URL}
            </W14Text>
            <View style={{ height: t.space.x2 }} />
            <Link href="/scan" asChild>
              <Button title="Barcode scannen" money />
            </Link>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: t.space.x3 }}>
            <View style={{ flex: 1, gap: t.space.x1 }}>
              <W14Text variant="title" numberOfLines={2}>
                {item.name}
              </W14Text>
              <W14Text variant="mono">{item.sku}</W14Text>
              {item.primaryCategory ? <Badge label={item.primaryCategory.nameDe} /> : null}
            </View>
            <W14Text variant="title" color={t.colors.primary}>
              {formatPrice(item)}
            </W14Text>
          </Card>
        )}
        ListEmptyComponent={<EmptyOrStatus state={state} onRetry={load} />}
      />
    </View>
  )
}

function EmptyOrStatus({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
  const t = useW14Theme()
  if (state.status === "loading") {
    return <W14Text variant="caption">Lade Katalog…</W14Text>
  }
  if (state.status === "error") {
    return (
      <Card style={{ gap: t.space.x3, borderColor: t.colors.destructive }}>
        <W14Text variant="title" color={t.colors.destructive}>
          Verbindung fehlgeschlagen
        </W14Text>
        <W14Text variant="caption">{state.message}</W14Text>
        <W14Text variant="caption">
          Prüfe, dass api-cloud auf {API_BASE_URL} läuft und Telefon + Mac im selben WLAN sind.
        </W14Text>
        <Button title="Erneut versuchen" variant="outline" onPress={onRetry} />
      </Card>
    )
  }
  return (
    <Card style={{ gap: t.space.x2 }}>
      <W14Text variant="title">Verbunden — Katalog ist leer</W14Text>
      <W14Text variant="caption">
        Die api-client-Verbindung steht (0 Artikel). Seed-Daten in api-cloud laden, um Produkte zu sehen.
      </W14Text>
    </Card>
  )
}
