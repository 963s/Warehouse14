/**
 * Artikel bearbeiten — PUT /api/products/:id via productsApi.update.
 *
 * Only the PUT-allowed fields are editable: Name, Listenpreis, Zustand,
 * Beschreibung, primäre Kategorie und der Status DRAFT→AVAILABLE
 * („veröffentlichen"). Intake-locked fields (sku, Einkaufspreis, Metall,
 * Gewicht) are read-only here — the backend refuses them, so we surface them in
 * a quiet „Festgelegt bei Anlage" run instead. ADMIN + step-up; the 403
 * STEP_UP_REQUIRED is handled transparently by stepUpMiddleware.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Das Formular lebt direkt auf
 * dem warmen Papier — un-carded Gruppen-Köpfe (ein Gilt-Faden + Kicker), nackte
 * Feld-Reihen und eine einzige warme Haarlinie zwischen den Gruppen. Tiefe kommt
 * aus dem geschichteten Papier und der Linie, nie aus gestapelten Karten.
 *
 * Built on the shared spine: a Skeleton in the form's shape then ErrorState +
 * Retry for the load, the FormScreen scaffold (sticky save + transparent
 * step-up + honest error/success banner), the product-form controls, field-level
 * validation that paints the offending input red + fires the Error haptic, and
 * the theme tokens throughout. The prefill is a deliberate one-shot — it never
 * refetches on focus, so returning mid-edit never clobbers the operator's draft.
 *
 * Zwei ehrliche Schreib-Pfade, getrennt: „Speichern" trägt die Stammdaten-PUT
 * (über den sticky Save-Spine), „Veröffentlichen" und „Entwurf löschen" sind
 * eigene Aktionen mit eigenen, ehrlichen Zuständen (kein zweiter Fehler-Kasten).
 * Gelöscht werden können NUR unverkaufte Entwürfe — sonst bleibt die Aktion
 * ehrlich abwesend, kein toter Knopf.
 *
 * Reached as /product/edit?id=<id> from the product detail screen.
 */
import { type ReactNode, useEffect, useRef, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import type {
  ProductConditionCode,
  ProductDetail,
  ProductUpdateBody,
} from "@warehouse14/api-client"
import Svg, { Circle, Path } from "react-native-svg"
import { ShieldAlert } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  categoryTree,
  describeError,
  formatEur,
  getProduct,
  removeProduct,
  setProductCategories,
  updateProduct,
} from "@/warehouse14/api"
import {
  CategoryPicker,
  type CategoryChoice,
  Field,
  type InputRef,
  MoneyField,
  WheelPicker,
} from "@/warehouse14/product-form"
import { MasseField } from "@/warehouse14/masse-field"
import {
  CONDITION_OPTIONS,
  firstProductEditError,
  formatGrams,
  isProductEditValid,
  type ProductEditErrors,
  type ProductEditFieldKey,
  statusLabel,
  validateProductEdit,
} from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  ErrorState,
  Hairline,
  haptics,
  invalidateQueries,
  Skeleton,
  useScreenInsets,
} from "@/warehouse14/ui"
import { FormScreen } from "@/warehouse14/ui/FormScreen"

// Maße kommen aus numeric(7,1) als „12.0" zurück, auch wenn „12" eingegeben
// wurde. Auf eine kanonische Dezimalform bringen, damit die Vorbelegung sauber
// „12" zeigt UND ein unverändertes Maß nicht als Änderung gilt (kein leerer
// Schreibvorgang, kein überflüssiger Step-up-PIN).
function canonDim(v: string | null | undefined): string {
  const s = (v ?? "").trim()
  if (s === "") return ""
  const n = Number(s)
  return Number.isFinite(n) ? String(n) : s
}

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

  // Maße sind re-messbar (nicht bei Anlage gesperrt) — hier editierbar.
  const [lengthCm, setLengthCm] = useState("")
  const [widthCm, setWidthCm] = useState("")
  const [heightCm, setHeightCm] = useState("")

  const [errors, setErrors] = useState<ProductEditErrors>({})

  // „Veröffentlichen" — eigener, ehrlicher Zustand (kein Save-Banner-Pfad).
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // „Entwurf löschen" — eigener, ehrlicher Zustand mit Bestätigungs-Dialog.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
        setLengthCm(canonDim(p.lengthCm))
        setWidthCm(canonDim(p.widthCm))
        setHeightCm(canonDim(p.heightCm))
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

  const patchDim = (key: "lengthCm" | "widthCm" | "heightCm", value: string) => {
    if (key === "lengthCm") setLengthCm(value)
    else if (key === "widthCm") setWidthCm(value)
    else setHeightCm(value)
    clearError(key)
  }

  async function submit() {
    if (!id || !product) throw new Error("Artikel nicht geladen.")

    const problems = validateProductEdit(name, listPrice, { lengthCm, widthCm, heightCm })
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
    // Maße — kanonisch vergleichen (12 == 12.0), damit ein unverändertes Maß
    // nicht schreibt. Leeren sendet null (entfernt), sonst der kanonische Wert.
    const lenNext = canonDim(lengthCm)
    if (lenNext !== canonDim(product.lengthCm)) body.lengthCm = lenNext === "" ? null : lenNext
    const widNext = canonDim(widthCm)
    if (widNext !== canonDim(product.widthCm)) body.widthCm = widNext === "" ? null : widNext
    const heiNext = canonDim(heightCm)
    if (heiNext !== canonDim(product.heightCm)) body.heightCm = heiNext === "" ? null : heiNext
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
    // The Lager list reflects the edit immediately — no manual refresh, ever.
    invalidateQueries("lager:")
    router.back()
  }

  async function publish() {
    if (!id) return
    setPublishError(null)
    setPublishing(true)
    try {
      await updateProduct(id, { status: "AVAILABLE" })
      haptics.success()
      invalidateQueries("lager:")
      router.back()
    } catch (e) {
      haptics.error()
      setPublishError(describeError(e))
      setPublishing(false)
    }
  }

  async function runDelete() {
    if (!id) return
    setConfirmDelete(false)
    setDeleteError(null)
    setDeleting(true)
    try {
      await removeProduct(id)
      haptics.success()
      invalidateQueries("lager:")
      router.back()
    } catch (e) {
      haptics.error()
      setDeleteError(describeError(e))
      setDeleting(false)
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

  // Nur unverkaufte Entwürfe sind löschbar — sonst bleibt die Aktion ehrlich weg.
  const isDeletableDraft = product.status === "DRAFT" && !product.archivedAt

  return (
    <>
      <FormScreen
        title="Artikel bearbeiten"
        subtitle="Name, Preis, Zustand und Kategorie ändern. Eine PIN-Bestätigung kann nötig sein."
        submitLabel="Speichern"
        successMessage="Gespeichert."
        submitDisabled={!name.trim() || !listPrice.trim()}
        onSubmit={submit}
      >
        {/* ── Stammdaten — nackte Feld-Reihen direkt auf dem Papier ──────────── */}
        <GroupHead
          kicker="Bearbeiten"
          title="Stammdaten"
          subtitle="Die offen änderbaren Felder dieses Artikels."
        />
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
          {/* The same wheel as „Neuer Artikel" — one control per field across
              create and edit. No defaultToFirst: the loaded value arrives
              async and must never be pre-empted by options[0]. */}
          <WheelPicker
            options={CONDITION_OPTIONS}
            value={condition}
            onChange={setCondition}
            defaultToFirst={false}
            placeholder="Zustand wählen"
          />
        </Field>

        <Field label="Beschreibung" hint="Optional erscheint in der Storefront.">
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

        {/* ── Kategorie ──────────────────────────────────────────────────────── */}
        {categories.length > 0 ? (
          <>
            <Hairline />
            <GroupHead
              kicker="Storefront"
              title="Kategorie"
              subtitle="Die primäre Einordnung im Shop."
            />
            <CategoryPicker options={categories} value={categoryId} onChange={setCategoryId} />
          </>
        ) : null}

        {/* ── Maße & Verpackung — re-messbar, geteilt mit der Anlage ────────── */}
        <Hairline />
        <MasseField
          lengthCm={lengthCm}
          widthCm={widthCm}
          heightCm={heightCm}
          weightGrams={product.weightGrams}
          onChange={patchDim}
          errors={{ lengthCm: errors.lengthCm, widthCm: errors.widthCm, heightCm: errors.heightCm }}
        />

        {/* ── Festgelegt bei Anlage — gesperrte, nackte Werte-Reihen ─────────── */}
        <Hairline />
        <GroupHead
          kicker="Gesperrt"
          locked
          title="Festgelegt bei Anlage"
          subtitle="Diese Werte sind nach der Anlage gesperrt (§25a-Integrität)."
        />
        <View>
          <LockedRow label="SKU" value={product.sku} mono />
          <Hairline inset={0} />
          <LockedRow label="Einkaufspreis" value={formatEur(product.acquisitionCostEur)} />
          {product.metal ? (
            <>
              <Hairline inset={0} />
              <LockedRow
                label="Gewicht"
                value={product.weightGrams ? `${formatGrams(product.weightGrams)} g` : "—"}
              />
            </>
          ) : null}
        </View>

        {/* ── Veröffentlichen — eigener, ehrlicher Schreib-Pfad ──────────────── */}
        {product.status === "DRAFT" ? (
          <>
            <Hairline />
            <GroupHead
              kicker="Status"
              title="Veröffentlichen"
              subtitle="Status von Entwurf auf Verfügbar setzen der Artikel wird verkäuflich."
            />
            <Button
              variant="outline"
              size="xl"
              className="h-12"
              onPress={() => void publish()}
              disabled={publishing}
              accessibilityLabel="Auf Verfügbar setzen"
            >
              <Text>{publishing ? "Wird veröffentlicht…" : "Auf Verfügbar setzen"}</Text>
            </Button>
            {publishError ? (
              <Text className="text-xs" style={{ color: t.colors.destructive }}>
                {publishError}
              </Text>
            ) : (
              <Text className="text-muted-foreground text-2xs">
                Aktueller Status: {statusLabel(product.status)}.
              </Text>
            )}
          </>
        ) : null}

        {/* ── Entwurf löschen — nur unverkaufte Entwürfe, ehrlicher Zustand ──── */}
        {isDeletableDraft ? (
          <>
            <Hairline />
            <GroupHead
              kicker="Unwiderruflich"
              danger
              title="Entwurf löschen"
              subtitle="Nur unverkaufte Entwürfe können entfernt werden die Aktion ist endgültig."
            />
            <Button
              variant="outline"
              size="xl"
              className="h-12"
              onPress={() => {
                haptics.selection()
                setDeleteError(null)
                setConfirmDelete(true)
              }}
              disabled={deleting}
              style={{ borderColor: t.colors.destructive }}
              accessibilityLabel="Entwurf löschen"
            >
              <Text style={{ color: t.colors.destructive }}>
                {deleting ? "Löschen…" : "Entwurf löschen"}
              </Text>
            </Button>
            {deleteError ? (
              <Text className="text-xs" style={{ color: t.colors.destructive }}>
                {deleteError}
              </Text>
            ) : null}
          </>
        ) : null}
      </FormScreen>

      {/* Löschen ist unwiderruflich — eine bewusste Bestätigung davor. */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <View className="flex-row items-center gap-2.5">
              <View
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: t.colors.destructive + "1f" }}
              >
                <ShieldAlert size={t.icon.md} color={t.colors.destructive} />
              </View>
              <DialogTitle>Artikel löschen?</DialogTitle>
            </View>
            <DialogDescription>
              {product.name} wird unwiderruflich gelöscht. Nur unverkaufte Entwürfe können gelöscht
              werden die Aktion kann nicht rückgängig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onPress={() => setConfirmDelete(false)}
              accessibilityLabel="Abbrechen"
            >
              <Text>Abbrechen</Text>
            </Button>
            <Button
              variant="destructive"
              onPress={() => void runDelete()}
              accessibilityLabel="Löschen"
            >
              <Text>Löschen</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupHead — der un-carded Gruppen-Kopf: ein Kicker (Gilt-Faden ◆ + small-caps)
// über dem Titel, optional ein gesperrt-/Gefahr-Siegel. Kein Karten-Kasten — die
// Gruppe lebt direkt auf dem Papier, getrennt nur durch die warme Haarlinie
// darüber (DESIGN-SYSTEM.md §1, §6: Gold als Faden, Kicker = ◆ + small-caps).
// ─────────────────────────────────────────────────────────────────────────────

function GroupHead({
  kicker,
  title,
  subtitle,
  locked = false,
  danger = false,
}: {
  kicker: string
  title: string
  subtitle?: string
  locked?: boolean
  danger?: boolean
}): ReactNode {
  const t = useW14Theme()
  const kickerColor = danger ? t.colors.destructive : t.colors.mutedForeground
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        {/* Der Gilt-Faden ◆ öffnet die Gruppe — Gold nur als Kante/Siegel. */}
        <View
          style={{
            height: 4,
            width: 4,
            borderRadius: 2,
            backgroundColor: danger ? t.colors.destructive : t.colors.gilt,
          }}
        />
        <Text
          className="text-2xs font-semibold"
          style={{ color: kickerColor, letterSpacing: 1.2 }}
          numberOfLines={1}
        >
          {kicker.toUpperCase()}
        </Text>
      </View>
      <View className="flex-row items-center gap-2.5">
        {locked ? <LockSeal size={20} ink={t.colors.foreground} gilt={t.colors.gilt} /> : null}
        {/* Die un-carded Headline spricht die Display-Stimme (Bricolage). */}
        <Text className="flex-1 text-lg font-display-semibold leading-tight" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {subtitle != null ? (
        <Text className="text-muted-foreground text-xs leading-5">{subtitle}</Text>
      ) : null}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LockSeal — ein bespoke Siegel (react-native-svg) für die gesperrten Werte: ein
// gestempelter Tinte-Ring mit einem Schloss-Bügel, dessen Faden in Gilt tönt
// (Gold nur als Faden/Siegel). Es signalisiert ruhig „nach Anlage gesperrt".
// ─────────────────────────────────────────────────────────────────────────────

function LockSeal({ size = 20, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Gestempelter Ring — die Siegel-Tinte. */}
      <Circle cx={12} cy={12} r={8.4} stroke={ink} strokeWidth={1.3} fill="none" />
      <Circle cx={12} cy={12} r={6.4} stroke={ink} strokeWidth={0.6} strokeOpacity={0.4} fill="none" />
      {/* Schloss-Bügel — der Gilt-Faden im Siegel. */}
      <Path
        d="M9.6 11 L9.6 9.6 A2.4 2.4 0 0 1 14.4 9.6 L14.4 11"
        stroke={gilt}
        strokeWidth={1.2}
        strokeLinecap="round"
        fill="none"
      />
      {/* Schloss-Körper. */}
      <Path
        d="M9 11 L15 11 L15 15 L9 15 Z"
        stroke={gilt}
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

/** A locked intake fact — label left, value right, as a bare row (no box). The
 *  group's LockSeal in the header already signals it cannot change here. */
function LockedRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="min-h-[44px] flex-row items-center justify-between gap-3 py-1.5">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      <Text className={mono ? "font-mono text-xs" : "text-sm font-medium"} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

/** The first-load placeholder — the edit form's own shape (kicker + title +
 *  labelled fields), bare on the paper, never a mid-screen spinner (DESIGN.md §6). */
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
      <View className="gap-1.5 pt-2">
        <Skeleton width="22%" height={10} />
        <Skeleton width="44%" height={18} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} className="gap-2">
          <Skeleton width="34%" height={13} />
          <Skeleton width="100%" height={44} radius="button" />
        </View>
      ))}
      <Hairline />
      <View className="gap-1.5">
        <Skeleton width="22%" height={10} />
        <Skeleton width="50%" height={18} />
        <Skeleton width="70%" height={12} />
      </View>
    </ScrollView>
  )
}
