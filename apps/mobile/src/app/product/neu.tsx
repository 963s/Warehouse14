/**
 * Neuer Artikel — the phone intake flow (POST /api/products via productsApi.create).
 *
 * Step 1 (Stammdaten): name, Artikelart, Metall + Gewicht, Feinheit, Zustand,
 *   Steuerbehandlung, Einkaufs-/Listenpreis, Kategorie, Lagerort. The backend
 *   intake-locks sku, Einkaufspreis and the classification — settable HERE only.
 *   Money fields are decimal EUR strings (NOT cents), matching the products
 *   surface. Step-up fires automatically when the Einkaufspreis crosses the
 *   threshold (StepUpDialogHost handles the 403 STEP_UP_REQUIRED transparently).
 *
 * Step 2 (Fotos): once the product exists, route into the existing capture
 *   pipeline (/capture?productId=…). The first photo becomes the primary.
 */
import { useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useNavigation } from "expo-router"
import type {
  CreateProductBody,
  Metal,
  ProductConditionCode,
  ProductItemType,
  TaxTreatmentCode,
} from "@warehouse14/api-client"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { categoryTree, createProduct, describeError } from "@/warehouse14/api"
import { ChipSelect, Field } from "@/warehouse14/product-form"
import {
  CONDITION_OPTIONS,
  ITEM_TYPE_OPTIONS,
  METAL_OPTIONS,
  TAX_TREATMENT_OPTIONS,
  generateSku,
} from "@/warehouse14/product-ui"

/** Flatten the 2-level taxonomy into a single selectable list (roots + leaves). */
interface CategoryChoice {
  value: string
  label: string
}

/** Decimal money/weight validation: up to 16 integer + 2 fractional digits. */
const DECIMAL_RE = /^\d{1,16}(\.\d{1,2})?$/
/** Feinheit 0..1 with up to 4 fractional digits (mirrors FinenessString). */
const FINENESS_RE = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/

export default function NeuerArtikelScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  // Stammdaten
  const [name, setName] = useState("")
  const [itemType, setItemType] = useState<ProductItemType | null>(null)
  const [metal, setMetal] = useState<Metal | null>(null)
  const [weightGrams, setWeightGrams] = useState("")
  const [fineness, setFineness] = useState("")
  const [condition, setCondition] = useState<ProductConditionCode | null>("USED_GOOD")
  const [taxCode, setTaxCode] = useState<TaxTreatmentCode | null>("MARGIN_25A")
  const [acquisition, setAcquisition] = useState("")
  const [listPrice, setListPrice] = useState("")
  const [sku, setSku] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)

  // Lagerort
  const [unit, setUnit] = useState("")
  const [drawer, setDrawer] = useState("")
  const [position, setPosition] = useState("")

  // Kategorien (loaded once)
  const [categories, setCategories] = useState<CategoryChoice[]>([])

  // Submit / result state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdSku, setCreatedSku] = useState<string | null>(null)

  useEffect(() => {
    navigation.setOptions({ title: "Neuer Artikel" })
  }, [navigation])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const tree = await categoryTree()
        if (!alive) return
        const flat: CategoryChoice[] = []
        for (const root of tree.roots) {
          flat.push({ value: root.id, label: root.nameDe })
          for (const child of root.children) {
            flat.push({ value: child.id, label: `${root.nameDe} › ${child.nameDe}` })
          }
        }
        setCategories(flat)
      } catch {
        // Categories are optional — the intake works without a category.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  function validate(): string | null {
    if (!name.trim()) return "Name ist erforderlich."
    if (!itemType) return "Artikelart auswählen."
    if (!condition) return "Zustand auswählen."
    if (!taxCode) return "Steuerbehandlung auswählen."
    if (!DECIMAL_RE.test(acquisition.trim()))
      return "Einkaufspreis als Betrag angeben (z. B. 199.90)."
    if (!DECIMAL_RE.test(listPrice.trim())) return "Listenpreis als Betrag angeben (z. B. 349.00)."
    if (weightGrams.trim() && !DECIMAL_RE.test(weightGrams.trim()))
      return "Gewicht als Zahl in Gramm angeben."
    if (fineness.trim() && !FINENESS_RE.test(fineness.trim()))
      return "Feinheit als Dezimalzahl 0–1 angeben (z. B. 0.585)."
    return null
  }

  async function submit() {
    setError(null)
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      const finalSku = sku.trim() || generateSku()
      const body: CreateProductBody = {
        sku: finalSku,
        itemType: itemType as ProductItemType,
        condition: condition as ProductConditionCode,
        taxTreatmentCode: taxCode as TaxTreatmentCode,
        acquisitionCostEur: acquisition.trim(),
        listPriceEur: listPrice.trim(),
        name: name.trim(),
        ...(metal ? { metal } : {}),
        ...(weightGrams.trim() ? { weightGrams: weightGrams.trim() } : {}),
        ...(fineness.trim() ? { finenessDecimal: fineness.trim() } : {}),
        ...(categoryId ? { primaryCategoryId: categoryId } : {}),
        ...(unit.trim() ? { locationStorageUnit: unit.trim() } : {}),
        ...(drawer.trim() ? { locationDrawer: drawer.trim() } : {}),
        ...(position.trim() ? { locationPosition: position.trim() } : {}),
      }
      // Step-up (403 STEP_UP_REQUIRED) on a high Einkaufspreis is handled
      // transparently by stepUpMiddleware and retried.
      const res = await createProduct(body)
      setCreatedId(res.id)
      setCreatedSku(res.sku)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  // ── Erfolg: Fotos anhängen oder zum Artikel ─────────────────────────────────
  if (createdId) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
      >
        <Card className="gap-2 px-4 py-4" style={{ borderColor: "#157a4b" }}>
          <Text className="text-accent text-base font-semibold">Artikel angelegt</Text>
          <Text className="text-muted-foreground text-sm">
            {name.trim()} · {createdSku}
          </Text>
          <Text className="text-muted-foreground text-xs">
            Als Entwurf gespeichert. Fotos hinzufügen oder direkt zum Artikel.
          </Text>
        </Card>

        <Button
          size="lg"
          className="h-12"
          onPress={() => router.replace({ pathname: "/capture", params: { productId: createdId } })}
        >
          <Text>Foto aufnehmen</Text>
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-12"
          onPress={() => router.replace({ pathname: "/product/[id]", params: { id: createdId } })}
        >
          <Text>Zum Artikel</Text>
        </Button>
      </ScrollView>
    )
  }

  // ── Stammdaten-Formular ─────────────────────────────────────────────────────
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      <Card className="gap-4 px-4 py-4">
        <Field label="Name">
          <Input
            value={name}
            onChangeText={setName}
            placeholder="z. B. Goldring 585 mit Brillant"
          />
        </Field>

        <Field label="Artikelart">
          <ChipSelect options={ITEM_TYPE_OPTIONS} value={itemType} onChange={setItemType} />
        </Field>

        <Field label="Edelmetall" hint="Optional — nur bei Edelmetallware.">
          <ChipSelect options={METAL_OPTIONS} value={metal} onChange={setMetal} allowClear />
        </Field>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Gewicht (g)">
              <Input
                value={weightGrams}
                onChangeText={setWeightGrams}
                placeholder="z. B. 4.20"
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Feinheit" hint="z. B. 0.585">
              <Input
                value={fineness}
                onChangeText={setFineness}
                placeholder="0.585"
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
        </View>

        <Field label="Zustand">
          <ChipSelect options={CONDITION_OPTIONS} value={condition} onChange={setCondition} />
        </Field>
      </Card>

      <Card className="gap-4 px-4 py-4">
        <Field label="Steuerbehandlung">
          <ChipSelect options={TAX_TREATMENT_OPTIONS} value={taxCode} onChange={setTaxCode} />
        </Field>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Einkaufspreis (EUR)">
              <Input
                value={acquisition}
                onChangeText={setAcquisition}
                placeholder="199.90"
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Listenpreis (EUR)">
              <Input
                value={listPrice}
                onChangeText={setListPrice}
                placeholder="349.00"
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
        </View>
      </Card>

      {categories.length > 0 ? (
        <Card className="gap-4 px-4 py-4">
          <Field label="Kategorie" hint="Optional — bestimmt die Storefront-Einordnung.">
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

      <Card className="gap-4 px-4 py-4">
        <Field label="Lagerort" hint="Optional — Tresor, Fach und Position.">
          <View className="gap-2">
            <Input value={unit} onChangeText={setUnit} placeholder="Tresor / Lagereinheit" />
            <Input value={drawer} onChangeText={setDrawer} placeholder="Fach / Schublade" />
            <Input value={position} onChangeText={setPosition} placeholder="Position" />
          </View>
        </Field>
      </Card>

      <Card className="gap-4 px-4 py-4">
        <Field label="SKU" hint="Leer lassen für automatische Vergabe.">
          <Input
            value={sku}
            onChangeText={setSku}
            placeholder="Automatisch"
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </Field>
      </Card>

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
          <Text>{busy ? "Speichern…" : "Anlegen"}</Text>
        </Button>
      </View>
    </ScrollView>
  )
}
