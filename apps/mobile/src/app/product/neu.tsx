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
 *   then a native success state routes into the existing capture pipeline
 *   (/capture?productId=…) where the first photo becomes the primary, or straight
 *   to the fresh Artikel.
 *
 * Form (DESIGN-SYSTEM.md §1/§9): KEINE Kästen in Kästen. Das Formular lebt direkt
 * auf dem warmen Papier — kein Stapel aus Karten. Jede Gruppe öffnet mit einer
 * ruhigen Kapitälchen-Überzeile (ein Gilt-Punkt als Faden), darunter nackte
 * Felder. Tiefe kommt aus dem geschichteten Papier und einer einzigen warmen
 * Haarlinie zwischen den Gruppen, nie aus gestapelten Karten. Gold bleibt Faden,
 * Kante, Siegel.
 *
 * Built on the shared spine: FormScreen scaffold (sticky save + transparent
 * step-up + error/success banner), the product-form controls (ChipSelect /
 * MoneyField / MetalWeightField / CategoryPicker), field-level validation that
 * paints the offending input red + fires the Error haptic, and the theme tokens
 * throughout.
 */
import { type ReactNode, useEffect, useRef, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useNavigation } from "expo-router"
import type { CreateProductBody } from "@warehouse14/api-client"
import Svg, { Path, Rect } from "react-native-svg"
import { Camera, CheckCircle2 } from "lucide-react-native"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { categoryTree, createProduct } from "@/warehouse14/api"
import {
  CategoryPicker,
  type CategoryChoice,
  ChipSelect,
  WheelPicker,
  Field,
  type InputRef,
  MetalWeightField,
  MoneyField,
} from "@/warehouse14/product-form"
import { MasseField } from "@/warehouse14/masse-field"
import {
  CONDITION_OPTIONS,
  EMPTY_PRODUCT_INTAKE,
  firstProductIntakeError,
  generateSku,
  ITEM_TYPE_OPTIONS,
  isProductIntakeValid,
  METAL_OPTIONS,
  normalizeDecimal,
  type ProductIntakeErrors,
  type ProductIntakeFieldKey,
  type ProductIntakeForm,
  TAX_TREATMENT_OPTIONS,
  validateProductIntake,
} from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  GoldFlood,
  Hairline,
  haptics,
  invalidateQueries,
  PaperGrain,
  StaggerItem,
  useScreenInsets,
} from "@/warehouse14/ui"
import { FormScreen, UserFacingError } from "@/warehouse14/ui/FormScreen"

// ── TagSeal — ein bespoke Etiketten-Siegel (react-native-svg) ────────────────
// Ein Anhänger/Schmuck-Etikett mit einer Loch-Öse: die ruhige Marke des Intake.
// Der Etiketten-Körper bleibt Tinte, die Öse + der Faden tönen in Gilt — Gold
// nur als Faden/Siegel (DESIGN-SYSTEM.md §1).
function TagSeal({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Etiketten-Körper — die Tinte. */}
      <Path
        d="M5 8.5 L13 8.5 L19 14.5 L13 20.5 L5 20.5 Z"
        stroke={ink}
        strokeWidth={1.4}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Preis-Linien auf dem Etikett. */}
      <Path d="M8 12.5 L13 12.5 M8 15 L11.5 15" stroke={ink} strokeWidth={1} strokeLinecap="round" strokeOpacity={0.5} />
      {/* Öse + Faden — der Gilt-Faden im Siegel. */}
      <Rect x={14.4} y={11.4} width={2.4} height={2.4} rx={1.2} stroke={gilt} strokeWidth={1.2} fill="none" />
      <Path d="M16.6 9.4 L20 6.4" stroke={gilt} strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  )
}

// ── GroupHead — eine boxlose Kapitälchen-Überzeile mit Gilt-Punkt ────────────
// Öffnet eine Feld-Gruppe direkt auf dem Papier (kein Karten-Kopf). Der Gilt-
// Punkt ist der Faden; ein optionaler Hinweis steht leise daneben.
function GroupHead({ overline, hint }: { overline: string; hint?: string }): ReactNode {
  const t = useW14Theme()
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
        <Text
          className="text-muted-foreground text-2xs font-semibold"
          style={{ letterSpacing: 1.2 }}
          numberOfLines={1}
        >
          {overline}
        </Text>
      </View>
      {hint != null ? <Text className="text-muted-foreground text-xs leading-5">{hint}</Text> : null}
    </View>
  )
}

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
      // Pair the red inputs with the Error haptic; the banner shows the first
      // problem verbatim (UserFacingError → FormScreen surfaces it as written).
      haptics.error()
      throw new UserFacingError(firstProductIntakeError(problems) ?? "Bitte Eingaben prüfen.")
    }

    // Money/weight/measure fields ride a `decimal-pad` (a comma on a German
    // keyboard) — normalise „199,90" → „199.90" for the wire, as every other
    // money path in this app does. Validation above already accepts the comma.
    const finalSku = form.sku.trim() || generateSku()
    const body: CreateProductBody = {
      sku: finalSku,
      itemType: form.itemType!,
      condition: form.condition!,
      taxTreatmentCode: form.taxCode!,
      acquisitionCostEur: normalizeDecimal(form.acquisition),
      listPriceEur: normalizeDecimal(form.listPrice),
      name: form.name.trim(),
      ...(form.description.trim() ? { descriptionDe: form.description.trim() } : {}),
      ...(form.metal ? { metal: form.metal } : {}),
      ...(form.weightGrams.trim() ? { weightGrams: normalizeDecimal(form.weightGrams) } : {}),
      ...(form.fineness.trim() ? { finenessDecimal: normalizeDecimal(form.fineness) } : {}),
      ...(form.lengthCm.trim() ? { lengthCm: normalizeDecimal(form.lengthCm) } : {}),
      ...(form.widthCm.trim() ? { widthCm: normalizeDecimal(form.widthCm) } : {}),
      ...(form.heightCm.trim() ? { heightCm: normalizeDecimal(form.heightCm) } : {}),
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
    // The Lager list shows the new article immediately — no manual refresh.
    invalidateQueries("lager:")
    setCreated({ id: res.id, sku: res.sku })
    setCelebrate(true)
  }

  // ── Erfolg: Fotos anhängen oder zum Artikel ─────────────────────────────────
  // Boxlos auf dem Papier — ein verdigris-getöntes Siegel, der Name + die SKU in
  // Mono, dann die zwei Wege. Kein Stapel aus Karten.
  if (created) {
    return (
      <View className="flex-1 bg-background">
        <PaperGrain />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: insets.contentBottom,
            gap: 22,
          }}
          showsVerticalScrollIndicator={false}
        >
          <StaggerItem index={0} exit={false}>
            <View className="items-center gap-3 pb-1 pt-8">
              <View
                className="h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: t.colors.verdigris + "1f" }}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <CheckCircle2 size={t.icon.xl} color={t.colors.verdigris} />
              </View>
              <View className="items-center gap-1.5">
                <Text
                  className="text-2xl font-display-semibold leading-tight"
                  accessibilityRole="header"
                >
                  Artikel angelegt
                </Text>
                <Text className="text-muted-foreground text-center text-sm" numberOfLines={2}>
                  {form.name.trim()}
                </Text>
                <View className="flex-row items-center gap-1.5">
                  <View
                    style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }}
                  />
                  <Text className="font-mono text-xs" style={{ color: t.colors.inkAged }}>
                    {created.sku}
                  </Text>
                </View>
              </View>
            </View>
          </StaggerItem>

          <Hairline />

          {/* Fotos — die Wahl steht boxlos auf dem Papier, kein Karten-Kopf. */}
          <StaggerItem index={1} exit={false}>
            <View className="gap-3">
              <GroupHead
                overline="FOTOS HINZUFÜGEN"
                hint="Das erste Foto wird automatisch zum Hauptbild. Als Entwurf gespeichert."
              />
              <View className="gap-2.5">
                <Button
                  size="xl"
                  className="h-12"
                  onPress={() => {
                    haptics.selection()
                    router.replace({ pathname: "/capture", params: { productId: created.id } })
                  }}
                  accessibilityLabel="Foto aufnehmen"
                >
                  <View className="flex-row items-center gap-2">
                    <Camera size={t.icon.sm} color={t.colors.primaryForeground} />
                    <Text>Foto aufnehmen</Text>
                  </View>
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
              </View>
            </View>
          </StaggerItem>
        </ScrollView>

        {/* The new-article milestone flood visual only (the Success haptic
            already fired); once per create, above content, never blocks a tap. */}
        <GoldFlood visible={celebrate} onDone={() => setCelebrate(false)} />
      </View>
    )
  }

  // ── Stammdaten-Formular ─────────────────────────────────────────────────────
  // Boxlos: jede Gruppe ist eine Kapitälchen-Überzeile + nackte Felder direkt auf
  // dem Papier, getrennt nur durch eine warme Haarlinie. Kein SectionCard-Stapel.
  return (
    <FormScreen
      title="Neuer Artikel"
      subtitle="Stammdaten erfassen. SKU und Einkaufspreis werden bei Anlage festgelegt."
      submitLabel="Anlegen"
      submitBusyLabel="Wird angelegt…"
      successMessage="Artikel angelegt."
      submitDisabled={!form.name.trim() || !form.acquisition.trim() || !form.listPrice.trim()}
      onSubmit={submit}
    >
      {/* Kicker — der Intake-Faden öffnet mit dem bespoke Etiketten-Siegel. */}
      <View className="flex-row items-center gap-2.5 pb-0.5">
        <TagSeal size={24} ink={t.colors.primary} gilt={t.colors.gilt} />
        <Text className="text-muted-foreground text-xs leading-5">
          Pflichtfelder sind mit einem Stern markiert.
        </Text>
      </View>

      {/* ── Stammdaten ──────────────────────────────────────────────────────── */}
      <View className="gap-3.5">
        <GroupHead overline="STAMMDATEN" />

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

        <Field label="Beschreibung" hint="Optional erscheint in der Storefront.">
          <Input
            value={form.description}
            onChangeText={(v) => patch("description", v)}
            placeholder="Details, Herkunft, Besonderheiten …"
            multiline
            textAlignVertical="top"
            className="h-auto"
            style={{ minHeight: 88, paddingTop: t.space.x2 }}
            autoCapitalize="sentences"
            accessibilityLabel="Beschreibung"
          />
        </Field>

        <Field label="Artikelart" required error={errors.itemType}>
          <WheelPicker
            options={ITEM_TYPE_OPTIONS}
            value={form.itemType}
            onChange={(v) => patch("itemType", v)}
            defaultToFirst={false}
            placeholder="Artikelart wählen"
          />
        </Field>

        <Field label="Zustand" required error={errors.condition}>
          <WheelPicker
            options={CONDITION_OPTIONS}
            value={form.condition}
            onChange={(v) => patch("condition", v)}
          />
        </Field>
      </View>

      <Hairline />

      {/* ── Edelmetall (optional) ───────────────────────────────────────────── */}
      <View className="gap-3.5">
        <GroupHead overline="EDELMETALL" hint="Nur bei Edelmetallware ausfüllen." />

        <Field label="Metall">
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
      </View>

      <Hairline />

      {/* ── Steuer + Preise ─────────────────────────────────────────────────── */}
      <View className="gap-3.5">
        <GroupHead
          overline="STEUER + PREISE"
          hint="Der Einkaufspreis wird bei Anlage festgelegt (§25a-Integrität)."
        />

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
              placeholder="199,90"
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
              placeholder="349,00"
              error={errors.listPrice}
              inputRef={listPriceRef}
              returnKeyType="done"
            />
          </View>
        </View>
      </View>

      {categories.length > 0 ? (
        <>
          <Hairline />
          {/* ── Kategorie (optional) ──────────────────────────────────────────── */}
          <View className="gap-3.5">
            <GroupHead
              overline="KATEGORIE"
              hint="Bestimmt die Einordnung in der Storefront."
            />
            <CategoryPicker
              options={categories}
              value={form.categoryId}
              onChange={(v) => patch("categoryId", v)}
            />
          </View>
        </>
      ) : null}

      <Hairline />

      {/* ── Lagerort (optional) ─────────────────────────────────────────────── */}
      <View className="gap-3.5">
        <GroupHead overline="LAGERORT" hint="Wo der Artikel physisch liegt, optional." />
        <Field label="Tresor / Lagereinheit">
          <Input
            value={form.unit}
            onChangeText={(v) => patch("unit", v)}
            placeholder="z. B. Tresor A"
            accessibilityLabel="Lagereinheit"
          />
        </Field>
        <Field label="Fach / Schublade">
          <Input
            value={form.drawer}
            onChangeText={(v) => patch("drawer", v)}
            placeholder="z. B. Schublade 3"
            accessibilityLabel="Fach"
          />
        </Field>
        <Field label="Position">
          <Input
            value={form.position}
            onChangeText={(v) => patch("position", v)}
            placeholder="z. B. Pos 12"
            accessibilityLabel="Position"
          />
        </Field>
      </View>

      <Hairline />

      {/* ── Maße & Verpackung (optional) — geteilt mit der Bearbeitung ──────── */}
      <MasseField
        lengthCm={form.lengthCm}
        widthCm={form.widthCm}
        heightCm={form.heightCm}
        weightGrams={form.weightGrams}
        onChange={(key, value) => patch(key, value)}
        errors={{ lengthCm: errors.lengthCm, widthCm: errors.widthCm, heightCm: errors.heightCm }}
      />

      <Hairline />

      {/* ── SKU ─────────────────────────────────────────────────────────────── */}
      <View className="gap-3.5">
        <GroupHead overline="SKU" />
        <Field
          label="Artikelnummer"
          hint="Leer lassen für eine automatische Vergabe bei Anlage."
        >
          <Input
            value={form.sku}
            onChangeText={(v) => patch("sku", v)}
            placeholder="Automatisch"
            autoCapitalize="characters"
            autoCorrect={false}
            className="font-mono"
            accessibilityLabel="Artikelnummer"
          />
        </Field>
      </View>
    </FormScreen>
  )
}
