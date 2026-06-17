/**
 * Kunden — staff customer search (authenticated customersApi.list). Debounced
 * free-text search + a "KYC bestätigt" filter chip; rows as RNR Card with the
 * decrypted full name, customer number, a KYC-status Badge, and a sanctions
 * flag. Tapping a row opens the customer detail. Mirrors the Lager list.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { FlatList, Pressable, RefreshControl, View } from "react-native"
import { useRouter } from "expo-router"
import type { CustomerListRow } from "@warehouse14/api-client"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { describeError, listCustomers } from "@/warehouse14/api"
import { KYC_STATUS_LABEL, KYC_STATUS_VARIANT } from "@/warehouse14/customer-ui"
import { useW14Theme } from "@/warehouse14/theme"

export default function KundenScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState("")
  const [kycOnly, setKycOnly] = useState(false)
  const [rows, setRows] = useState<CustomerListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (query: string, onlyKyc: boolean) => {
    setError(null)
    try {
      const res = await listCustomers({
        q: query.trim() || undefined,
        kycVerifiedOnly: onlyKyc || undefined,
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
    debounceRef.current = setTimeout(() => void load(q, kycOnly), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q, kycOnly, load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load(q, kycOnly)
    setRefreshing(false)
  }, [q, kycOnly, load])

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-4 pt-3">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder="Suche: Name, Kundennummer…"
          autoCorrect={false}
        />
        <View className="flex-row flex-wrap gap-2">
          <Pressable onPress={() => setKycOnly(false)}>
            <Badge variant={!kycOnly ? "default" : "outline"}>
              <Text>Alle</Text>
            </Badge>
          </Pressable>
          <Pressable onPress={() => setKycOnly(true)}>
            <Badge variant={kycOnly ? "default" : "outline"}>
              <Text>KYC bestätigt</Text>
            </Badge>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.primary}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/customer/[id]", params: { id: item.id } })}
          >
            <Card className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold" numberOfLines={1}>
                  {item.fullName}
                </Text>
                <Text className="font-mono text-xs text-muted-foreground">
                  {item.customerNumber}
                </Text>
              </View>
              <View className="items-end gap-1.5">
                <Badge variant={KYC_STATUS_VARIANT[item.kycStatus]}>
                  <Text>{KYC_STATUS_LABEL[item.kycStatus]}</Text>
                </Badge>
                {item.sanctionsMatch ? (
                  <Badge variant="destructive">
                    <Text>Sanktion</Text>
                  </Badge>
                ) : null}
              </View>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? (
            <Text className="text-muted-foreground">Lade Kunden…</Text>
          ) : error ? (
            <Card className="gap-2 border-destructive px-4 py-4">
              <Text className="text-destructive text-base font-semibold">Fehler</Text>
              <Text className="text-muted-foreground text-sm">{error}</Text>
            </Card>
          ) : (
            <Text className="text-muted-foreground">Keine Kunden gefunden.</Text>
          )
        }
      />
    </View>
  )
}
