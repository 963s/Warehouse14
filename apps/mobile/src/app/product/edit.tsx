/**
 * Artikel bearbeiten — PUT /api/products/:id via productsApi.update.
 *
 * Only the PUT-allowed fields are editable: Name, Listenpreis, Zustand,
 * Beschreibung, primäre Kategorie und der Status DRAFT→AVAILABLE
 * ("veröffentlichen"). Intake-locked fields (sku, Einkaufspreis, Metall,
 * Gewicht) are read-only here — the backend refuses them. ADMIN + step-up; the
 * 403 STEP_UP_REQUIRED is handled transparently by stepUpMiddleware.
 *
 * Reached as /product/edit?id=<id> from the product detail screen.
 */
import { useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useLocalSearchParams, useNavigation } from "expo-router"
import type {
  ProductConditionCode,
  ProductDetail,
  ProductUpdateBody,
} from "@warehouse14/api-client"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  categoryTree,
  describeError,
  getProduct,
  setProductCategories,
  updateProduct,
} from "@/warehouse14/api"
import { ChipSelect, Field } from "@/warehouse14/product-form"
import { CONDITION_OPTIONS } from "@/warehouse14/product-ui"

const DECIMAL_RE = /^\d{1,16}(\.\d{1,2})?$/

interface CategoryChoice {
  value: string
  label: string
}

export default function ArtikelBearbeitenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Editable fields
  const [name, setName] = useState("")
  const [listPrice, setListPrice] = useState("")
  const [condition, setCondition] = useState<ProductConditionCode | null>(null)
  const [descriptionDe, setDescriptionDe] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [categories, setCategories] = useState<CategoryChoice[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    navigation.setOptions({ title: "Bearbeiten" })
  }, [navigation])

  useEffect(() => {
    if (!id) return
    let alive = true
    void (async () => {
      try {
        const [p, tree] = await Promise.all([getProduct(id), categoryTree().catch(() => null)])
        if (!alive) return
        setProduct(p)
        setName(p.name)
        setListPrice(p.listPriceEur)
        // condition is a string on the wire; narrow to the known codes.
        setCondition((p.condition as ProductConditionCode) ?? null)
        setDescriptionDe(p.descriptionDe ?? "")
        setCategoryId(p.categories.find((c) => c.isPrimary)?.id ?? null)
        if (tree) {
          const flat: CategoryChoice[] = []
          for (const root of tree.roots) {
            flat.push({ value: root.id, label: root.nameDe })
            for (const child of root.children) {
              flat.push({ value: child.id, label: `${root.nameDe} › ${child.nameDe}` })
            }
          }
          setCategories(flat)
        }
      } catch (e) {
        if (alive) setLoadError(describeError(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  async function submit() {
    if (!id || !product) return
    setError(null)
    if (!name.trim()) {
      setError("Name ist erforderlich.")
      return
    }
    if (!DECIMAL_RE.test(listPrice.trim())) {
      setError("Listenpreis als Betrag angeben (z. B. 349.00).")
      return
    }
    // Only send what actually changed — the backend echoes changedFields. The
    // products PUT does NOT accept categories, so a changed primary Kategorie is
    // applied via the dedicated /categories REPLACE-ALL route below.
    const body: ProductUpdateBody = {}
    if (name.trim() !== product.name) body.name = name.trim()
    if (listPrice.trim() !== product.listPriceEur) body.listPriceEur = listPrice.trim()
    if (condition && condition !== product.condition) body.condition = condition
    const newDesc = descriptionDe.trim()
    if (newDesc !== (product.descriptionDe ?? "")) body.descriptionDe = newDesc
    const currentPrimary = product.categories.find((c) => c.isPrimary)?.id ?? null
    const categoryChanged = categoryId !== currentPrimary

    if (Object.keys(body).length === 0 && !categoryChanged) {
      router.back()
      return
    }

    setBusy(true)
    try {
      if (Object.keys(body).length > 0) {
        await updateProduct(id, body)
      }
      if (categoryChanged) {
        // REPLACE-ALL semantics: keep every existing membership, only swap which
        // node is primary (and add the new primary if it wasn't a member yet).
        const existingIds = product.categories.map((c) => c.id)
        const nextIds = categoryId ? Array.from(new Set([...existingIds, categoryId])) : existingIds
        await setProductCategories(id, {
          categoryIds: nextIds,
          primaryCategoryId: categoryId,
        })
      }
      router.back()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!id) return
    setError(null)
    setBusy(true)
    try {
      await updateProduct(id, { status: "AVAILABLE" })
      router.back()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Card className="gap-2 border-destructive px-4 py-4">
          <Text className="text-destructive text-base font-semibold">Fehler</Text>
          <Text className="text-muted-foreground text-sm">{loadError}</Text>
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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      <Card className="gap-4 px-4 py-4">
        <Field label="Name">
          <Input value={name} onChangeText={setName} placeholder="Artikelname" />
        </Field>

        <Field label="Listenpreis (EUR)">
          <Input
            value={listPrice}
            onChangeText={setListPrice}
            placeholder="349.00"
            keyboardType="decimal-pad"
          />
        </Field>

        <Field label="Zustand">
          <ChipSelect options={CONDITION_OPTIONS} value={condition} onChange={setCondition} />
        </Field>

        <Field label="Beschreibung" hint="Optional — erscheint in der Storefront.">
          <Input
            value={descriptionDe}
            onChangeText={setDescriptionDe}
            placeholder="Beschreibung"
            multiline
            numberOfLines={4}
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
        </Field>
      </Card>

      {categories.length > 0 ? (
        <Card className="gap-4 px-4 py-4">
          <Field label="Kategorie" hint="Primäre Storefront-Einordnung.">
            <ChipSelect
              options={categories}
              value={categoryId}
              onChange={setCategoryId}
              allowClear
              clearLabel="Ohne"
            />
          </Field>
        </Card>
      ) : null}

      {/* Read-only intake-locked facts (settable only at intake). */}
      <Card className="gap-1.5 px-4 py-4">
        <Text className="text-muted-foreground text-xs uppercase">Festgelegt bei Anlage</Text>
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm">SKU</Text>
          <Text className="font-mono text-xs">{product.sku}</Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm">Einkaufspreis</Text>
          <Text className="text-sm font-medium">{product.acquisitionCostEur} EUR</Text>
        </View>
      </Card>

      {product.status === "DRAFT" ? (
        <Card className="gap-2 px-4 py-4" style={{ borderColor: "#157a4b" }}>
          <Text className="text-base font-semibold">Veröffentlichen</Text>
          <Text className="text-muted-foreground text-xs">
            Status von Entwurf auf Verfügbar setzen.
          </Text>
          <Button variant="outline" onPress={() => void publish()} disabled={busy}>
            <Text>Auf „Verfügbar“ setzen</Text>
          </Button>
        </Card>
      ) : null}

      {error ? (
        <Card className="gap-1 border-destructive px-4 py-3">
          <Text className="text-destructive text-sm font-medium">{error}</Text>
        </Card>
      ) : null}

      <View className="flex-row gap-2">
        <Button variant="outline" className="flex-1" onPress={() => router.back()} disabled={busy}>
          <Text>Abbrechen</Text>
        </Button>
        <Button className="flex-1" onPress={() => void submit()} disabled={busy}>
          <Text>{busy ? "Speichern…" : "Speichern"}</Text>
        </Button>
      </View>
    </ScrollView>
  )
}
