/**
 * Neuer Artikel — the phone intake flow (POST /api/products via productsApi.create).
 *
 * Step 1 (Stammdaten): Name, Artikelart, Metall + Gewicht/Feinheit, Zustand,
 *   Steuerbehandlung, Einkaufs-/Listenpreis, Kategorie, Lagerort, SKU. The
 *   backend intake-locks sku, Einkaufspreis and the classification — settable
 *   HERE only. Money fields are decimal EUR STRINGS (NOT cents), matching the
 *   products API. Step-up fires automatically when the Einkaufspreis crosses the
 *   threshold (StepUpDialogHost handles the 403 STEP_UP_REQUIRED transparently).
 *
 * Step 2 (Fotos): once the product exists it is a real milestone — the create
 *   lands with the Success haptic and a single gold flood (DESIGN.md §6/§7),
 *   then a native success card routes into the existing capture pipeline
 *   (/capture?productId=…) where the first photo becomes the primary, or straight
 *   to the fresh Artikel.
 *
 * Built on the shared spine: FormScreen scaffold (sticky save + transparent
 * step-up), SectionCard groups, the product-form controls (ChipSelect / MoneyField
 * / MetalWeightField / CategoryPicker), field-level validation that paints the
 * offending input red + fires the Error haptic, and the theme tokens throughout.
 */
import { useEffect, useRef, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useNavigation } from "expo-router"
import type { CreateProductBody } from "@warehouse14/api-client"
import { Camera, CheckCircle2, PackagePlus } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { categoryTree, createProduct } from "@/warehouse14/api"
import {
  CategoryPicker,
  type CategoryChoice,
  ChipSelect,
  Field,
  type InputRef,
  MetalWeightField,
  MoneyField,
} from "@/warehouse14/product-form"
import {
  CONDITION_OPTIONS,
  EMPTY_PRODUCT_INTAKE,
  firstProductIntakeError,
  generateSku,
  ITEM_TYPE_OPTIONS,
  isProductIntakeValid,
  METAL_OPTIONS,
  type ProductIntakeErrors,
  type ProductIntakeFieldKey,
  type ProductIntakeForm,
  TAX_TREATMENT_OPTIONS,
  validateProductIntake,
} from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import { GoldFlood, haptics, PaperGrain, SectionCard, useScreenInsets } from "@/warehouse14/ui"
import { FormScreen } from "@/warehouse14/ui/FormScreen"

export default function NeuerArtikelScreen() {
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [form, setForm] = useState<ProductIntakeForm>(EMPTY_PRODUCT_INTAKE)
  const [errors, setErrors] = useState<ProductIntakeErrors>({})
  const [categories, setCategories] = useState<CategoryChoice[]>([])

  // Post-create state — the success step (Fotos / zum Artikel) + the flood.
  const [created, setCreated] = useState<{ id: string; sku: string } | null>(null)
  const [celebrate, setCelebrate] = useState(false)

  // Keyboard focus chaining across the free-text inputs.
  const weightRef = useRef<InputRef>(null)
  const finenessRef = useRef<InputRef>(null)
  const acquisitionRef = useRef<InputRef>(null)
  const listPriceRef = useRef<InputRef>(null)

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

  const patch = <K extends keyof ProductIntakeForm>(key: K, value: ProductIntakeForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if ((key as ProductIntakeFieldKey) in errors) clearError(key as ProductIntakeFieldKey)
  }

  const clearError = (key: ProductIntakeFieldKey) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  async function submit() {
    const problems = validateProductIntake(form)
    setErrors(problems)
    if (!isProductIntakeValid(problems)) {
      // Pair the red inputs with the Error haptic; the banner shows the first.
      haptics.error()
      throw new Error(firstProductIntakeError(problems) ?? "Bitte Eingaben prüfen.")
    }

    const finalSku = form.sku.trim() || generateSku()
    const body: CreateProductBody = {
      sku: finalSku,
      itemType: form.itemType!,
      condition: form.condition!,
      taxTreatmentCode: form.taxCode!,
      acquisitionCostEur: form.acquisition.trim(),
      listPriceEur: form.listPrice.trim(),
      name: form.name.trim(),
      ...(form.metal ? { metal: form.metal } : {}),
      ...(form.weightGrams.trim() ? { weightGrams: form.weightGrams.trim() } : {}),
      ...(form.fineness.trim() ? { finenessDecimal: form.fineness.trim() } : {}),
      ...(form.categoryId ? { primaryCategoryId: form.categoryId } : {}),
      ...(form.unit.trim() ? { locationStorageUnit: form.unit.trim() } : {}),
      ...(form.drawer.trim() ? { locationDrawer: form.drawer.trim() } : {}),
      ...(form.position.trim() ? { locationPosition: form.position.trim() } : {}),
    }

    // Step-up (403 STEP_UP_REQUIRED) on a high Einkaufspreis is handled
    // transparently by stepUpMiddleware and retried.
    const res = await createProduct(body)
    // One haptic per action (DESIGN.md §7): the Success notification IS the
    // confirm; the gold flood that follows is visual-only, never a second buzz.
    haptics.success()
    setCreated({ id: res.id, sku: res.sku })
    setCelebrate(true)
  }

  // ── Erfolg: Fotos anhängen oder zum Artikel ─────────────────────────────────
  if (created) {
    return (
      <View className="flex-1 bg-background">
        <PaperGrain />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 14 }}
        >
          <View className="items-center gap-3 pb-1 pt-6">
            <View
              className="h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: t.colors.verdigris + "1f" }}
            >
              <CheckCircle2 size={t.icon.xl} color={t.colors.verdigris} />
            </View>
            <View className="items-center gap-1">
              <Text className="text-2xl font-display-semibold leading-tight">Artikel angelegt</Text>
              <Text className="text-muted-foreground text-center text-sm" numberOfLines={2}>
                {form.name.trim()}
              </Text>
              <Text className="text-muted-foreground font-mono text-xs">{created.sku}</Text>
            </View>
          </View>

          <SectionCard
            title="Fotos hinzufügen"
            subtitle="Das erste Foto wird automatisch zum Hauptbild. Als Entwurf gespeichert."
            icon={Camera}
          >
            <Button
              size="xl"
              className="h-12"
              onPress={() => {
                haptics.selection()
                router.replace({ pathname: "/capture", params: { productId: created.id } })
              }}
              accessibilityLabel="Foto aufnehmen"
            >
              <Text>Foto aufnehmen</Text>
            </Button>
            <Button
              variant="outline"
              size="xl"
              className="h-12"
              onPress={() => {
                haptics.selection()
                router.replace({ pathname: "/product/[id]", params: { id: created.id } })
              }}
              accessibilityLabel="Zum Artikel"
            >
              <Text>Zum Artikel</Text>
            </Button>
          </SectionCard>
        </ScrollView>

        {/* The new-article milestone flood visual only (the Success haptic
            already fired); once per create, above content, never blocks a tap. */}
        <GoldFlood visible={celebrate} onDone={() => setCelebrate(false)} />
      </View>
    )
  }

  // ── Stammdaten-Formular ─────────────────────────────────────────────────────
  return (
    <FormScreen
      title="Neuer Artikel"
      subtitle="Stammdaten erfassen. SKU und Einkaufspreis werden bei Anlage festgelegt."
      submitLabel="Anlegen"
      successMessage="Artikel angelegt."
      submitDisabled={!form.name.trim() || !form.acquisition.trim() || !form.listPrice.trim()}
      onSubmit={submit}
    >
      <SectionCard title="Stammdaten" icon={PackagePlus}>
        <Field label="Name" required error={errors.name}>
          <Input
            value={form.name}
            onChangeText={(v) => patch("name", v)}
            placeholder="z. B. Goldring 585 mit Brillant"
            autoCapitalize="sentences"
            aria-invalid={!!errors.name}
            style={errors.name ? { borderColor: t.colors.destructive } : undefined}
            accessibilityLabel="Name"
          />
        </Field>

        <Field label="Artikelart" required error={errors.itemType}>
          <ChipSelect
            options={ITEM_TYPE_OPTIONS}
            value={form.itemType}
            onChange={(v) => patch("itemType", v)}
          />
        </Field>

        <Field label="Edelmetall" hint="Optional nur bei Edelmetallware.">
          <ChipSelect
            options={METAL_OPTIONS}
            value={form.metal}
            onChange={(v) => patch("metal", v)}
            allowClear
          />
        </Field>

        <MetalWeightField
          weight={form.weightGrams}
          onWeightChange={(v) => patch("weightGrams", v)}
          fineness={form.fineness}
          onFinenessChange={(v) => patch("fineness", v)}
          weightError={errors.weightGrams}
          finenessError={errors.fineness}
          weightRef={weightRef}
          finenessRef={finenessRef}
          onWeightSubmit={() => finenessRef.current?.focus()}
          onFinenessSubmit={() => acquisitionRef.current?.focus()}
        />

        <Field label="Zustand" required error={errors.condition}>
          <ChipSelect
            options={CONDITION_OPTIONS}
            value={form.condition}
            onChange={(v) => patch("condition", v)}
          />
        </Field>
      </SectionCard>

      <SectionCard
        title="Steuer + Preise"
        subtitle="Einkaufspreis wird bei Anlage festgelegt (§25a-Integrität)."
      >
        <Field label="Steuerbehandlung" required error={errors.taxCode}>
          <ChipSelect
            options={TAX_TREATMENT_OPTIONS}
            value={form.taxCode}
            onChange={(v) => patch("taxCode", v)}
          />
        </Field>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <MoneyField
              label="Einkaufspreis"
              required
              value={form.acquisition}
              onChangeText={(v) => patch("acquisition", v)}
              placeholder="199.90"
              error={errors.acquisition}
              inputRef={acquisitionRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => listPriceRef.current?.focus()}
            />
          </View>
          <View className="flex-1">
            <MoneyField
              label="Listenpreis"
              required
              value={form.listPrice}
              onChangeText={(v) => patch("listPrice", v)}
              placeholder="349.00"
              error={errors.listPrice}
              inputRef={listPriceRef}
              returnKeyType="done"
            />
          </View>
        </View>
      </SectionCard>

      {categories.length > 0 ? (
        <SectionCard title="Kategorie" subtitle="Optional bestimmt die Storefront-Einordnung.">
          <CategoryPicker
            options={categories}
            value={form.categoryId}
            onChange={(v) => patch("categoryId", v)}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Lagerort" subtitle="Optional Tresor, Fach und Position.">
        <Input
          value={form.unit}
          onChangeText={(v) => patch("unit", v)}
          placeholder="Tresor / Lagereinheit"
          accessibilityLabel="Lagereinheit"
        />
        <Input
          value={form.drawer}
          onChangeText={(v) => patch("drawer", v)}
          placeholder="Fach / Schublade"
          accessibilityLabel="Fach"
        />
        <Input
          value={form.position}
          onChangeText={(v) => patch("position", v)}
          placeholder="Position"
          accessibilityLabel="Position"
        />
      </SectionCard>

      <SectionCard title="SKU" subtitle="Leer lassen für automatische Vergabe.">
        <Input
          value={form.sku}
          onChangeText={(v) => patch("sku", v)}
          placeholder="Automatisch"
          autoCapitalize="characters"
          autoCorrect={false}
          className="font-mono"
          accessibilityLabel="SKU"
        />
      </SectionCard>
    </FormScreen>
  )
}
