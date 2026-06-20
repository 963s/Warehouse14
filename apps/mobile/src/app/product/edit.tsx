/**
 * Artikel bearbeiten — PUT /api/products/:id via productsApi.update.
 *
 * Only the PUT-allowed fields are editable: Name, Listenpreis, Zustand,
 * Beschreibung, primäre Kategorie und der Status DRAFT→AVAILABLE
 * („veröffentlichen"). Intake-locked fields (sku, Einkaufspreis, Metall,
 * Gewicht) are read-only here — the backend refuses them, so we surface them in
 * a quiet „Festgelegt bei Anlage" card instead. ADMIN + step-up; the 403
 * STEP_UP_REQUIRED is handled transparently by stepUpMiddleware.
 *
 * Built on the shared spine: a Skeleton in the form's shape then ErrorState +
 * Retry for the load, the FormScreen scaffold (sticky save + transparent
 * step-up), the product-form controls, field-level validation that paints the
 * offending input red + fires the Error haptic, and the theme tokens throughout.
 * The prefill is a deliberate one-shot — it never refetches on focus, so
 * returning mid-edit never clobbers the operator's draft.
 *
 * Reached as /product/edit?id=<id> from the product detail screen.
 */
import { useEffect, useRef, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import type {
  ProductConditionCode,
  ProductDetail,
  ProductUpdateBody,
} from "@warehouse14/api-client"
import { Lock, Tag } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  categoryTree,
  describeError,
  formatEur,
  getProduct,
  setProductCategories,
  updateProduct,
} from "@/warehouse14/api"
import {
  CategoryPicker,
  type CategoryChoice,
  ChipSelect,
  Field,
  type InputRef,
  MoneyField,
} from "@/warehouse14/product-form"
import {
  CONDITION_OPTIONS,
  firstProductEditError,
  isProductEditValid,
  type ProductEditErrors,
  type ProductEditFieldKey,
  STATUS_LABEL,
  validateProductEdit,
} from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import { ErrorState, haptics, SectionCard, Skeleton, useScreenInsets } from "@/warehouse14/ui"
import { FormScreen } from "@/warehouse14/ui/FormScreen"

export default function ArtikelBearbeitenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const t = useW14Theme()

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCause, setLoadCause] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Editable fields
  const [name, setName] = useState("")
  const [listPrice, setListPrice] = useState("")
  const [condition, setCondition] = useState<ProductConditionCode | null>(null)
  const [descriptionDe, setDescriptionDe] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [categories, setCategories] = useState<CategoryChoice[]>([])

  const [errors, setErrors] = useState<ProductEditErrors>({})
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const listPriceRef = useRef<InputRef>(null)

  useEffect(() => {
    if (!id) {
      setLoadError("Kein Artikel ausgewählt.")
      return
    }
    let alive = true
    setLoadError(null)
    setLoadCause(null)
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
        if (alive) {
          setLoadError(describeError(e))
          setLoadCause(e)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [id, reloadKey])

  const clearError = (key: ProductEditFieldKey) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  async function submit() {
    if (!id || !product) throw new Error("Artikel nicht geladen.")

    const problems = validateProductEdit(name, listPrice)
    setErrors(problems)
    if (!isProductEditValid(problems)) {
      haptics.error()
      throw new Error(firstProductEditError(problems) ?? "Bitte Eingaben prüfen.")
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
      haptics.warning()
      throw new Error("Keine Änderungen.")
    }

    // 403 STEP_UP_REQUIRED → PIN-Dialog + retry (auto via stepUpMiddleware).
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
    // The Success notification IS the confirm (pairs with the verdigris banner).
    haptics.success()
    router.back()
  }

  async function publish() {
    if (!id) return
    setPublishError(null)
    setPublishing(true)
    try {
      await updateProduct(id, { status: "AVAILABLE" })
      haptics.success()
      router.back()
    } catch (e) {
      haptics.error()
      setPublishError(describeError(e))
      setPublishing(false)
    }
  }

  if (loadError != null) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <ErrorState
          message={loadError}
          cause={loadCause}
          onRetry={id ? () => setReloadKey((k) => k + 1) : () => router.back()}
          retryLabel={id ? "Erneut versuchen" : "Zurück"}
        />
      </View>
    )
  }

  if (!product) {
    return <EditSkeleton />
  }

  return (
    <FormScreen
      title="Artikel bearbeiten"
      subtitle="Name, Preis, Zustand und Kategorie ändern. PIN-Bestätigung kann nötig sein."
      submitLabel="Speichern"
      successMessage="Gespeichert."
      submitDisabled={!name.trim() || !listPrice.trim()}
      onSubmit={submit}
    >
      <SectionCard title="Stammdaten" icon={Tag}>
        <Field label="Name" required error={errors.name}>
          <Input
            value={name}
            onChangeText={(v) => {
              setName(v)
              clearError("name")
            }}
            placeholder="Artikelname"
            autoCapitalize="sentences"
            aria-invalid={!!errors.name}
            style={errors.name ? { borderColor: t.colors.destructive } : undefined}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => listPriceRef.current?.focus()}
            accessibilityLabel="Name"
          />
        </Field>

        <MoneyField
          label="Listenpreis"
          required
          value={listPrice}
          onChangeText={(v) => {
            setListPrice(v)
            clearError("listPrice")
          }}
          placeholder="349.00"
          error={errors.listPrice}
          inputRef={listPriceRef}
          returnKeyType="done"
        />

        <Field label="Zustand">
          <ChipSelect options={CONDITION_OPTIONS} value={condition} onChange={setCondition} />
        </Field>

        <Field label="Beschreibung" hint="Optional — erscheint in der Storefront.">
          <Input
            value={descriptionDe}
            onChangeText={setDescriptionDe}
            placeholder="Beschreibung"
            multiline
            textAlignVertical="top"
            className="h-auto"
            style={{ minHeight: 88, paddingTop: t.space.x2 }}
            accessibilityLabel="Beschreibung"
          />
        </Field>
      </SectionCard>

      {categories.length > 0 ? (
        <SectionCard title="Kategorie" subtitle="Primäre Storefront-Einordnung.">
          <CategoryPicker options={categories} value={categoryId} onChange={setCategoryId} />
        </SectionCard>
      ) : null}

      {/* Read-only intake-locked facts (settable only at intake). */}
      <SectionCard
        title="Festgelegt bei Anlage"
        subtitle="Diese Werte sind nach der Anlage gesperrt (§25a-Integrität)."
        icon={Lock}
      >
        <LockedRow label="SKU" value={product.sku} mono />
        <LockedRow label="Einkaufspreis" value={formatEur(product.acquisitionCostEur)} />
        {product.metal ? (
          <LockedRow
            label="Gewicht"
            value={product.weightGrams ? `${product.weightGrams} g` : "—"}
          />
        ) : null}
      </SectionCard>

      {product.status === "DRAFT" ? (
        <SectionCard
          title="Veröffentlichen"
          subtitle="Status von Entwurf auf Verfügbar setzen — der Artikel wird verkäuflich."
        >
          <Button
            variant="outline"
            size="xl"
            className="h-12"
            onPress={() => void publish()}
            disabled={publishing}
            accessibilityLabel="Auf Verfügbar setzen"
          >
            <Text>{publishing ? "Wird veröffentlicht…" : "Auf „Verfügbar“ setzen"}</Text>
          </Button>
          {publishError ? (
            <Text className="text-xs" style={{ color: t.colors.destructive }}>
              {publishError}
            </Text>
          ) : (
            <Text className="text-muted-foreground text-2xs">
              Aktueller Status: {STATUS_LABEL[product.status]}.
            </Text>
          )}
        </SectionCard>
      ) : null}
    </FormScreen>
  )
}

/** A locked intake fact — label left, value right, with a quiet lock affordance
 *  baked into the section header so the operator knows it cannot change here. */
function LockedRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="min-h-[36px] flex-row items-center justify-between gap-3">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      <Text className={mono ? "font-mono text-xs" : "text-sm font-medium"} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

/** The first-load placeholder — the edit form's own shape (title + labelled
 *  fields), never a mid-screen spinner (DESIGN.md §6). */
function EditSkeleton() {
  const insets = useScreenInsets()
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 14 }}
    >
      <View className="gap-1.5">
        <Skeleton width="58%" height={20} />
        <Skeleton width="86%" height={13} />
      </View>
      <Card className="gap-3.5 px-4 py-4">
        {[0, 1, 2].map((i) => (
          <View key={i} className="gap-2">
            <Skeleton width="34%" height={13} />
            <Skeleton width="100%" height={44} radius="button" />
          </View>
        ))}
      </Card>
      <Card className="gap-2.5 px-4 py-4">
        <Skeleton width="48%" height={16} />
        <Skeleton width="70%" height={12} />
        <Skeleton width="60%" height={12} />
      </Card>
    </ScrollView>
  )
}
