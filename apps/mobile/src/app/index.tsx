/**
 * Goal 1 — the api-client screen, now rendered through React Native Reusables.
 *
 * The product rows and actions use RNR <Card>/<Button>/<Text> (NativeWind
 * className-driven, styled by the Warehouse14 tokens in global.css). The DATA
 * path is unchanged: storefrontApi.listProducts via @warehouse14/api-client,
 * price via @warehouse14/domain Money. The reuse IS the proof.
 */
import { useCallback, useEffect, useState } from "react"
import { FlatList, RefreshControl, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { StorefrontProduct } from "@warehouse14/api-client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { API_BASE_URL, formatPrice, listProducts } from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: StorefrontProduct[]; total: number }

export default function ProductsScreen() {
  const t = useW14Theme()
  const router = useRouter()
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
    <View className="flex-1 bg-background">
      <FlatList
        data={state.status === "ready" ? state.items : []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />
        }
        ListHeaderComponent={
          <View className="mb-2 gap-2">
            <Text variant="h2" className="border-b-0 pb-0">
              Katalog
            </Text>
            <Text variant="muted" className="font-mono text-xs">
              Live über @warehouse14/api-client · {API_BASE_URL}
            </Text>
            <Button size="lg" className="mt-2 h-12" onPress={() => router.push("/scan")}>
              <Text>Barcode scannen</Text>
            </Button>
          </View>
        }
        renderItem={({ item }) => (
          <Card className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
            <View className="flex-1 gap-1">
              <Text className="text-base font-semibold" numberOfLines={2}>
                {item.name}
              </Text>
              <Text className="font-mono text-xs text-muted-foreground">{item.sku}</Text>
              {item.primaryCategory ? (
                <Text className="text-xs font-medium text-accent">{item.primaryCategory.nameDe}</Text>
              ) : null}
            </View>
            <Text className="text-primary text-base font-bold">{formatPrice(item)}</Text>
          </Card>
        )}
        ListEmptyComponent={<EmptyOrStatus state={state} onRetry={load} />}
      />
    </View>
  )
}

function EmptyOrStatus({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
  if (state.status === "loading") {
    return <Text variant="muted">Lade Katalog…</Text>
  }
  if (state.status === "error") {
    return (
      <Card className="gap-3 border-destructive px-4 py-4">
        <Text className="text-destructive text-base font-semibold">Verbindung fehlgeschlagen</Text>
        <Text variant="muted">{state.message}</Text>
        <Text variant="muted" className="text-xs">
          Prüfe, dass api-cloud auf {API_BASE_URL} läuft und Telefon + Mac im selben WLAN sind.
        </Text>
        <Button variant="outline" onPress={onRetry}>
          <Text>Erneut versuchen</Text>
        </Button>
      </Card>
    )
  }
  return (
    <Card className="gap-2 px-4 py-4">
      <Text className="text-base font-semibold">Verbunden — Katalog ist leer</Text>
      <Text variant="muted">
        Die api-client-Verbindung steht (0 Artikel). Seed-Daten in api-cloud laden, um Produkte zu
        sehen.
      </Text>
    </Card>
  )
}
