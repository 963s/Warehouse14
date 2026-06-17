/**
 * Product detail + relocate (modal). Shows the Lagerort triplet, Schmelzwert
 * (Feingewicht × aktueller Kurs), status and prices via productsApi.get. The
 * Umlagern action calls productsApi.adjustInventory (LOCATION_CHANGE) which
 * writes audit_log AND requires step-up — the global StepUpDialogHost fires
 * transparently and the api-client middleware retries on success.
 */
import { useCallback, useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { CurrentMetalPrice, ProductDetail } from "@warehouse14/api-client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  currentMetalPrices,
  describeError,
  formatEur,
  getProduct,
  relocateProduct,
  schmelzwertEur,
} from "@/warehouse14/api"
import { formatLocation, STATUS_LABEL, STATUS_VARIANT } from "@/warehouse14/product-ui"

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      <Text className="text-sm font-medium">{value}</Text>
    </View>
  )
}

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [prices, setPrices] = useState<readonly CurrentMetalPrice[]>([])
  const [error, setError] = useState<string | null>(null)

  // Relocate form state
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useState("")
  const [drawer, setDrawer] = useState("")
  const [position, setPosition] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const [p, mp] = await Promise.all([getProduct(id), currentMetalPrices().catch(() => null)])
      setProduct(p)
      setPrices(mp?.prices ?? [])
      setUnit(p.locationStorageUnit ?? "")
      setDrawer(p.locationDrawer ?? "")
      setPosition(p.locationPosition ?? "")
    } catch (e) {
      setError(describeError(e))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function submitRelocate() {
    if (!id) return
    setFormError(null)
    setOkMsg(null)
    if (!unit.trim() || !drawer.trim() || !position.trim()) {
      setFormError("Tresor, Fach und Position sind erforderlich.")
      return
    }
    if (notes.trim().length < 8) {
      setFormError("Notiz mit mindestens 8 Zeichen angeben.")
      return
    }
    setBusy(true)
    try {
      // This 403s with STEP_UP_REQUIRED when the step-up window is stale; the
      // stepUpMiddleware opens the PIN Dialog and retries automatically.
      const res = await relocateProduct(id, {
        reason: "LOCATION_CHANGE",
        notes: notes.trim(),
        locationStorageUnit: unit.trim(),
        locationDrawer: drawer.trim(),
        locationPosition: position.trim(),
      })
      setOkMsg(`Umgelagert · audit_log ${res.auditLogId.slice(0, 8)}…`)
      setEditing(false)
      setNotes("")
      await load()
    } catch (e) {
      setFormError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Card className="gap-2 border-destructive px-4 py-4">
          <Text className="text-destructive text-base font-semibold">Fehler</Text>
          <Text className="text-muted-foreground text-sm">{error}</Text>
          <Button variant="outline" onPress={() => void load()}>
            <Text>Erneut laden</Text>
          </Button>
        </Card>
      </View>
    )
  }

  if (!product) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Text className="text-muted-foreground">Lade Artikel…</Text>
      </View>
    )
  }

  const schmelz = schmelzwertEur(product.feingewichtGrams, product.metal, prices)

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
    >
      <View className="gap-1">
        <Text className="text-2xl font-bold" numberOfLines={3}>
          {product.name}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className="font-mono text-xs text-muted-foreground">{product.sku}</Text>
          <Badge variant={STATUS_VARIANT[product.status]}>
            <Text>{STATUS_LABEL[product.status]}</Text>
          </Badge>
        </View>
      </View>

      <Card className="gap-2.5 px-4 py-4">
        <Row
          label="Lagerort"
          value={formatLocation(
            product.locationStorageUnit,
            product.locationDrawer,
            product.locationPosition,
          )}
        />
        <Row label="Schmelzwert" value={schmelz ?? "—"} />
        <Row label="Listenpreis" value={formatEur(product.listPriceEur)} />
        <Row label="Einkaufspreis" value={formatEur(product.acquisitionCostEur)} />
        {product.feingewichtGrams ? (
          <Row label="Feingewicht" value={`${product.feingewichtGrams} g ${product.metal ?? ""}`} />
        ) : null}
      </Card>

      {okMsg ? (
        <Card className="gap-1 px-4 py-3" style={{ borderColor: "#157a4b" }}>
          <Text className="text-accent text-sm font-medium">{okMsg}</Text>
        </Card>
      ) : null}

      {editing ? (
        <Card className="gap-3 px-4 py-4">
          <Text className="text-base font-semibold">Umlagern</Text>
          <Input value={unit} onChangeText={setUnit} placeholder="Tresor / Lagereinheit" />
          <Input value={drawer} onChangeText={setDrawer} placeholder="Fach / Schublade" />
          <Input value={position} onChangeText={setPosition} placeholder="Position" />
          <Input value={notes} onChangeText={setNotes} placeholder="Grund / Notiz (min. 8 Zeichen)" />
          {formError ? <Text className="text-destructive text-sm">{formError}</Text> : null}
          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => setEditing(false)} disabled={busy}>
              <Text>Abbrechen</Text>
            </Button>
            <Button className="flex-1" onPress={() => void submitRelocate()} disabled={busy}>
              <Text>{busy ? "Speichern…" : "Bestätigen"}</Text>
            </Button>
          </View>
        </Card>
      ) : (
        <Button size="lg" className="h-12" onPress={() => setEditing(true)}>
          <Text>Umlagern</Text>
        </Button>
      )}
    </ScrollView>
  )
}
