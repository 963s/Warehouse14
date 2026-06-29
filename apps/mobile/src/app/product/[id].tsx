/**
 * Artikel — Detail. Ein Hero-Foto, dann nackte beschriftete Zeilen auf dem
 * warmen Papier (keine Kästen in Kästen), die Preise und Gewichte in den
 * Mono-Ziffern, ehrliche Zustände und echte Aktionen (bearbeiten, verkaufbar
 * schalten, umlagern, drucken, löschen). Alles aus `productsApi.get` (live über
 * den geteilten `useQuery`: refetch-on-focus, sodass ein frisch aufgenommenes
 * Foto oder eine Umlagerung sofort erscheint, Pull-to-refresh, in-flight-Dedupe).
 * Der Metallkurs ist ein zweiter Live-Read, damit der Schmelzwert eine echte Zahl
 * oder ein ruhiges „—" ist, nie eine erfundene Ziffer (Ehrlichkeitsregel).
 *
 * Form (DESIGN-SYSTEM.md): Tiefe kommt aus dem geschichteten Papier und einer
 * einzigen warmen Haarlinie, nie aus gestapelten Karten. Der Lagerort, die Werte,
 * der Kanal — alles lebt boxlos als Reihen, getrennt durch die Linie. Gold tritt
 * nur als Faden auf (der Kicker-Punkt, die aktive Kante). Münzziffern in Mono.
 *
 * Zwei step-up-geschützte Aktionen über den geteilten Spine:
 *   • „Umlagern" (LOCATION_CHANGE) → schreibt audit_log UND verlangt step-up; der
 *     globale StepUpDialogHost fragt die PIN transparent ab und wiederholt den
 *     Aufruf. Ein Erfolg landet mit der Success-Haptik + dem Verdigris-Hinweis.
 *   • „Entwurf löschen" → nur unverkaufte Entwürfe; eine unumkehrbare Aktion, also
 *     erst im Dialog bestätigt, dann mit der Error/Success-Haptik. Das DELETE
 *     antwortet ebenfalls mit STEP_UP_REQUIRED und wiederholt automatisch.
 *
 * Fotos: das Hauptbild führt; ein Tipp auf eine andere Miniatur befördert sie.
 * „Foto hinzufügen" führt in die Aufnahme. Gebaut auf dem geteilten Spine.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import type { CurrentMetalPrice, Metal, PhotoRow } from "@warehouse14/api-client"
import { deriveSizeClass, sizeClassLabel } from "@warehouse14/domain"
import Svg, { Path } from "react-native-svg"
import {
  Camera,
  ChevronRight,
  Globe,
  Pencil,
  Printer,
  RefreshCw,
  ShieldAlert,
  Store,
  Tag,
  Warehouse,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
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
  absoluteUrl,
  currentMetalPrices,
  formatEur,
  getProduct,
  listProductPhotos,
  relocateProduct,
  removeProduct,
  setPhotoPrimary,
  updateProduct,
} from "@/warehouse14/api"
import { buildLabelHtml } from "@/warehouse14/print/label-html"
import { clearProductUploadError, useProductUpload } from "@/warehouse14/photo-upload-store"
import {
  conditionLabel,
  formatGrams,
  formatLocation,
  ITEM_TYPE_OPTIONS,
  METAL_LABEL,
  statusLabel,
  statusVariant,
} from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CoinIcon,
  CountUp,
  ErrorState,
  Hairline,
  haptics,
  InlineError,
  isNotFoundError,
  MetalIcon,
  type MetalKind,
  PaperGrain,
  PressableScale,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

const RELOCATE_NOTE_MIN = 8

/** Der Edelmetall-Code vom Draht (klein) → die Mark-Variante (groß) der bespoke
 *  MetalIcon. Ohne Metall trägt der Platzhalter das ruhige Münz-Glyph. */
const METAL_KIND: Record<Metal, MetalKind> = {
  gold: "GOLD",
  silver: "SILBER",
  platinum: "PLATIN",
  palladium: "PALLADIUM",
}

/** Die Artikelart vom Draht (loser String) → ihr deutsches Label, oder `null`,
 *  wenn unbekannt — nie der rohe Token (Reinheitsregel). */
function itemTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return ITEM_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? null
}

/**
 * Der Schmelzwert in ganzen CENT = Feingewicht (g) × aktueller Kurs (€/g), oder
 * `null`, wenn eine der Eingaben fehlt (Ehrlichkeitsregel — keine erfundene
 * Zahl). Die formatierte Anzeige ist die Quelle der Wahrheit; dies gibt dem
 * Count-up eine ehrliche Größenordnung, ohne sie neu zu parsen.
 */
function schmelzCents(
  feingewichtGrams: string | null,
  metal: string | null,
  prices: readonly CurrentMetalPrice[],
): number | null {
  if (!feingewichtGrams || !metal) return null
  const row = prices.find((p) => String(p.metal) === String(metal))
  if (!row?.pricePerGramEur) return null
  const value = Number(feingewichtGrams) * Number(row.pricePerGramEur)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useW14Theme()
  const insets = useScreenInsets()

  // Ein Live-Read trägt Laden/Fehler/Refetch; refetch-on-focus hält ein frisch
  // aufgenommenes Foto / eine Umlagerung sichtbar, sobald man zurückkehrt.
  const productQ = useQuery(() => getProduct(id), { key: `product:${id}`, enabled: !!id })
  const pricesQ = useQuery(() => currentMetalPrices(), { key: "metal-prices", staleTimeMs: 60_000 })
  const photosQ = useQuery(() => listProductPhotos(id), {
    key: `product-photos:${id}`,
    enabled: !!id,
  })
  // Optimistic background photo upload (capture returns instantly) — slot the new
  // photo in the moment it lands, and surface any failure in the Fotos section.
  const upload = useProductUpload(id)
  useEffect(() => {
    if (upload.tick > 0) void photosQ.refetch()
    // refetch identity is stable for a fixed key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.tick])
  const rc = useRefreshControl(productQ)
  const product = productQ.data

  useFocusEffect(
    useCallback(() => {
      if (id) {
        void productQ.refetch()
        void photosQ.refetch()
      }
      // refetch identity is stable for a fixed key
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]),
  )

  // ── Aktions-Feedback ────────────────────────────────────────────────────────
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // ── Umlagern-Formular ───────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useState("")
  const [drawer, setDrawer] = useState("")
  const [position, setPosition] = useState("")
  const [notes, setNotes] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  // ── Löschen bestätigen ──────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false)

  const prices: readonly CurrentMetalPrice[] = pricesQ.data?.prices ?? []
  const photos: PhotoRow[] = sortPhotos(photosQ.data?.items ?? [])
  // Ehrlichkeit: ein leeres `photos`-Array ist erst dann ein echtes „keine Fotos",
  // wenn der Read GELUNGEN ist. Solange er lädt oder scheiterte, behauptet der
  // Abschnitt keine bestätigte Null — er zeigt einen Platzhalter / einen Retry.
  const photosErrored = photosQ.status === "error" && photosQ.data == null
  const photosFirstLoad = photosQ.isLoading && photosQ.data == null
  const photosConfirmed = !photosErrored && !photosFirstLoad
  const photoCount = photosConfirmed ? photos.length : null
  const heroPhoto = photos.find((p) => p.isPrimary) ?? photos[0] ?? null

  // ── Mutationen (step-up ist in der api-Schicht transparent) ──────────────────
  const setPrimaryM = useMutation((photoId: string) => setPhotoPrimary(photoId), {
    onSuccess: () => {
      haptics.selection()
      void photosQ.refetch()
    },
    onError: () => haptics.error(),
  })

  const relocateM = useMutation(
    (vars: { unit: string; drawer: string; position: string; notes: string }) =>
      relocateProduct(id, {
        reason: "LOCATION_CHANGE",
        notes: vars.notes,
        locationStorageUnit: vars.unit,
        locationDrawer: vars.drawer,
        locationPosition: vars.position,
      }),
    {
      onSuccess: (res) => {
        haptics.success()
        setOkMsg(res ? `Umgelagert · Protokoll ${res.auditLogId.slice(0, 8)}` : "Umgelagert")
        setEditing(false)
        setNotes("")
        void productQ.refetch()
      },
      onError: () => haptics.error(),
    },
  )

  const deleteM = useMutation((_vars: void) => removeProduct(id), {
    onSuccess: () => {
      haptics.success()
      router.back()
    },
    onError: () => haptics.error(),
  })

  function openRelocate() {
    if (!product) return
    haptics.selection()
    setOkMsg(null)
    relocateM.reset()
    setUnit(product.locationStorageUnit ?? "")
    setDrawer(product.locationDrawer ?? "")
    setPosition(product.locationPosition ?? "")
    setNotes("")
    setFormError(null)
    setEditing(true)
  }

  function submitRelocate() {
    setFormError(null)
    if (!unit.trim() || !drawer.trim() || !position.trim()) {
      setFormError("Tresor, Fach und Position sind erforderlich.")
      haptics.error()
      return
    }
    if (notes.trim().length < RELOCATE_NOTE_MIN) {
      setFormError(`Notiz mit mindestens ${RELOCATE_NOTE_MIN} Zeichen angeben.`)
      haptics.error()
      return
    }
    void relocateM.mutate({
      unit: unit.trim(),
      drawer: drawer.trim(),
      position: position.trim(),
      notes: notes.trim(),
    })
  }

  function askDelete() {
    haptics.selection()
    setOkMsg(null)
    deleteM.reset()
    setConfirmDelete(true)
  }

  function runDelete() {
    setConfirmDelete(false)
    void deleteM.mutate()
  }

  // ── Zustände ────────────────────────────────────────────────────────────────
  if (productQ.isLoading && product == null) {
    return (
      <View className="flex-1 bg-background">
        <PaperGrain />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom }}
        >
          <DetailSkeleton />
        </ScrollView>
      </View>
    )
  }

  if (product == null) {
    // Ein 404 ist hier normal (ein gelöschter/zusammengeführter Artikel über
    // einen Deep-Link oder eine veraltete Liste) — der ErrorState zeigt seinen
    // ruhigen „nicht gefunden"-Rahmen, nie die rote „konnte nicht geladen"-Karte.
    const productMissing = isNotFoundError(productQ.errorCause)
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <PaperGrain />
        <ErrorState
          title={productMissing ? "Artikel nicht gefunden" : undefined}
          message={
            productMissing
              ? "Dieser Artikel ist nicht mehr vorhanden, er wurde vermutlich gelöscht."
              : (productQ.error ?? "Der Artikel konnte nicht geladen werden.")
          }
          cause={productQ.errorCause}
          onRetry={() => void productQ.refetch()}
          retrying={productQ.isFetching}
        />
      </View>
    )
  }

  const schmelz = schmelzCents(product.feingewichtGrams, product.metal, prices)
  const isDeletableDraft = product.status === "DRAFT" && !product.archivedAt
  const actionError = relocateM.error ?? deleteM.error ?? setPrimaryM.error
  const artLabel = itemTypeLabel(product.itemType)

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 22,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* ── Hero ── Das Hauptbild führt den Artikel ein. Ein echtes Foto in
            einem warmen Haarlinien-Rahmen, oder ein ehrlicher Papier-Platzhalter
            mit dem bespoke Edelmetall-/Münz-Glyph. Darunter steht die Identität
            nackt: Kicker-Faden, Name in der Display-Stimme, SKU + Status. */}
        <StaggerItem index={0}>
          <View className="gap-3.5">
            <HeroPhoto
              photo={heroPhoto}
              metal={product.metal}
              loading={photosFirstLoad}
            />
            <View className="gap-2">
              {/* Kicker — der Gilt-Faden + die Artikelart in Kapitälchen. */}
              <View className="flex-row items-center gap-2">
                <View
                  style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }}
                />
                <Text
                  className="text-muted-foreground text-2xs font-semibold"
                  style={{ letterSpacing: 1.2 }}
                  numberOfLines={1}
                >
                  {(artLabel ?? "Artikel").toUpperCase()}
                </Text>
              </View>
              <Text className="text-3xl font-display-semibold leading-tight" numberOfLines={3}>
                {product.name}
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Badge variant={statusVariant(product.status)} dot>
                  <Text>{statusLabel(product.status)}</Text>
                </Badge>
                <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
                  {product.sku}
                </Text>
              </View>
            </View>
          </View>
        </StaggerItem>

        {/* Aktions-Feedback — der Verdigris-Erfolg / die eine Fehler-Karte. */}
        {okMsg ? (
          <StaggerItem index={1} exit>
            <View
              className="flex-row items-center gap-2.5 py-1"
              accessibilityRole="alert"
            >
              <Warehouse size={t.icon.sm} color={t.colors.verdigris} />
              <Text className="flex-1 text-sm font-semibold" style={{ color: t.colors.verdigris }}>
                {okMsg}
              </Text>
            </View>
          </StaggerItem>
        ) : null}
        {actionError ? (
          <StaggerItem index={1} exit>
            <InlineError
              message={actionError}
              onDismiss={() => {
                relocateM.reset()
                deleteM.reset()
                setPrimaryM.reset()
              }}
            />
          </StaggerItem>
        ) : null}

        {/* ── Werte ── Der Schmelzwert führt als großer Mono-Count-up, dann die
            Preise, das Gewicht, der Lagerort und der Zustand als nackte Zeilen,
            getrennt nur durch die warme Haarlinie (keine Karte). */}
        <StaggerItem index={2}>
          <View className="gap-3">
            <GroupLabel>Werte</GroupLabel>

            {/* Schmelzwert — die ruhige Bilanz-Zeile, mono + groß. */}
            <View className="flex-row items-end justify-between">
              <View className="gap-0.5">
                <Text className="text-base font-semibold">Schmelzwert</Text>
                <Text className="text-muted-foreground text-2xs">
                  {pricesQ.isLoading ? "Kurs wird geladen" : "Feingewicht × aktueller Kurs"}
                </Text>
              </View>
              <SchmelzValue cents={schmelz} />
            </View>

            <Hairline />

            <ValueRow label="Listenpreis" value={formatEur(product.listPriceEur)} mono />
            <Hairline inset={0} />
            <ValueRow label="Einkaufspreis" value={formatEur(product.acquisitionCostEur)} mono />
            {product.feingewichtGrams && product.metal ? (
              <>
                <Hairline />
                <ValueRow
                  label="Feingewicht"
                  value={`${formatGrams(product.feingewichtGrams) ?? "—"} g · ${METAL_LABEL[product.metal]}`}
                  mono
                />
              </>
            ) : null}
            <Hairline />
            <ValueRow
              label="Lagerort"
              value={formatLocation(
                product.locationStorageUnit,
                product.locationDrawer,
                product.locationPosition,
              )}
            />
            {/* Maße + abgeleitete Größenklasse — bleiben am Produkt fürs Packen. */}
            {(() => {
              const dims = [product.lengthCm, product.widthCm, product.heightCm]
              if (!dims.some((d) => d != null && d !== "")) return null
              const fmt = dims.map((d) => (d ? String(Number(d)) : "—")).join(" × ")
              const sc = deriveSizeClass({
                lengthCm: product.lengthCm ? Number(product.lengthCm) : null,
                widthCm: product.widthCm ? Number(product.widthCm) : null,
                heightCm: product.heightCm ? Number(product.heightCm) : null,
                weightGrams: product.weightGrams ? Number(product.weightGrams) : null,
              })
              return (
                <>
                  <Hairline />
                  <ValueRow label="Maße" value={`${fmt} cm`} />
                  {sc != null ? (
                    <>
                      <Hairline inset={0} />
                      <ValueRow label="Größe" value={sizeClassLabel(sc)} />
                    </>
                  ) : null}
                </>
              )
            })()}
            <Hairline />
            <ValueRow label="Zustand" value={conditionLabel(product.condition)} />
          </View>
        </StaggerItem>

        {/* ── Fotos ── Das Hauptbild führt; ein Tipp auf eine andere Miniatur
            befördert sie. Boxloser Abschnitts-Kopf mit echter Anzahl. */}
        <StaggerItem index={3}>
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <GroupLabel>Fotos</GroupLabel>
                {photoCount != null ? (
                  <Text className="text-muted-foreground font-mono text-2xs">{photoCount}</Text>
                ) : null}
                {upload.uploading > 0 ? (
                  <Text className="text-muted-foreground text-2xs">· wird hochgeladen…</Text>
                ) : null}
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Foto hinzufügen"
                onPress={() => {
                  haptics.selection()
                  router.push({ pathname: "/capture", params: { productId: id } })
                }}
              >
                <View className="flex-row items-center gap-1.5 py-1">
                  <Camera size={t.icon.sm} color={t.colors.foreground} />
                  <Text className="text-sm font-semibold">Hinzufügen</Text>
                </View>
              </PressableScale>
            </View>

            {upload.error ? (
              // Hintergrund-Upload gescheitert — ehrlich melden (kein stilles
              // Verschlucken). Die Bytes sind weg (no-persist), darum erneut
              // aufnehmen statt „erneut senden". Ein Tipp schließt den Hinweis.
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Upload-Hinweis schließen"
                onPress={() => {
                  haptics.selection()
                  clearProductUploadError(id)
                }}
              >
                <Text className="text-sm" style={{ color: t.colors.destructive }}>
                  Foto-Upload fehlgeschlagen: {upload.error}. Bitte erneut aufnehmen.
                </Text>
              </PressableScale>
            ) : null}

            {photosErrored ? (
              // Ein Lade-FEHLER — nie „keine Fotos" behaupten, wenn die Wahrheit
              // „konnte nicht geladen werden" ist. Ein ehrlicher Retry stattdessen.
              <View className="gap-2.5">
                <Text className="text-muted-foreground text-sm">
                  {photosQ.error ?? "Fotos konnten nicht geladen werden."}
                </Text>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Fotos erneut laden"
                  onPress={() => {
                    haptics.selection()
                    void photosQ.refetch()
                  }}
                >
                  <View
                    className="flex-row items-center gap-1.5 self-start rounded-full border px-3.5 py-2"
                    style={{ borderColor: t.colors.border }}
                  >
                    <RefreshCw size={t.icon.xs} color={t.colors.foreground} />
                    <Text className="text-sm font-semibold">
                      {photosQ.isFetching ? "Wird geladen" : "Erneut laden"}
                    </Text>
                  </View>
                </PressableScale>
              </View>
            ) : photosFirstLoad ? (
              // Erster Read noch unterwegs — ein formtreuer Platzhalter, kein
              // voreiliges „keine Fotos".
              <View className="flex-row gap-2" accessibilityElementsHidden>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} width={84} height={84} radius="card" />
                ))}
              </View>
            ) : photos.length === 0 ? (
              <Text className="text-muted-foreground text-sm leading-5">
                Noch keine Fotos. Tippe auf Hinzufügen, um das erste aufzunehmen, es wird zum
                Hauptbild.
              </Text>
            ) : (
              <View className="flex-row flex-wrap gap-2.5">
                {photos.map((ph) => {
                  const isHero = ph.id === heroPhoto?.id
                  return (
                    <PressableScale
                      key={ph.id}
                      accessibilityRole="button"
                      accessibilityLabel={ph.isPrimary ? "Hauptbild" : "Als Hauptbild setzen"}
                      accessibilityState={{ selected: ph.isPrimary }}
                      disabled={ph.isPrimary || setPrimaryM.isPending}
                      onPress={() => {
                        if (!ph.isPrimary) void setPrimaryM.mutate(ph.id)
                      }}
                    >
                      <View className="gap-1.5">
                        <View
                          className="overflow-hidden"
                          style={{
                            borderRadius: t.radii.card,
                            borderWidth: 1,
                            borderColor: ph.isPrimary ? t.colors.gilt : t.colors.border,
                          }}
                        >
                          <Image
                            source={{
                              uri: absoluteUrl(ph.thumbUrl ?? `/api/photos/${ph.id}/thumb`),
                            }}
                            style={{
                              width: 88,
                              height: 88,
                              backgroundColor: t.colors.raised,
                            }}
                            contentFit="cover"
                            transition={180}
                            recyclingKey={ph.id}
                            cachePolicy="memory-disk"
                          />
                        </View>
                        <Text
                          className="text-2xs font-medium"
                          style={{
                            color: isHero ? t.colors.foreground : t.colors.mutedForeground,
                          }}
                        >
                          {ph.isPrimary ? "Hauptbild" : "Als Hauptbild"}
                        </Text>
                      </View>
                    </PressableScale>
                  )
                })}
              </View>
            )}
          </View>
        </StaggerItem>

        {/* ── Veröffentlichung ── Wo und ob der Artikel verkaufbar ist, als nackte
            Schalter-Reihen mit der Haarlinie dazwischen (keine Karte). */}
        <StaggerItem index={4}>
          <PublishPanel
            productId={product.id}
            status={product.status}
            listedOnStorefront={product.listedOnStorefront}
            isPublishedToWeb={product.isPublishedToWeb}
            ebayState={product.ebayState}
          />
        </StaggerItem>

        {/* ── Umlagern ── Das Umlagern-Formular (ein echter audit_log-Eintrag +
            step-up). Eingeklappt eine ruhige Aktions-Zeile, ausgeklappt das
            Formular direkt auf dem Papier. */}
        <StaggerItem index={5}>
          {editing ? (
            <View className="gap-2.5">
              <GroupLabel>Umlagern</GroupLabel>
              <Input
                value={unit}
                onChangeText={setUnit}
                placeholder="Tresor / Lagereinheit"
                accessibilityLabel="Lagereinheit"
              />
              <Input
                value={drawer}
                onChangeText={setDrawer}
                placeholder="Fach / Schublade"
                accessibilityLabel="Fach"
              />
              <Input
                value={position}
                onChangeText={setPosition}
                placeholder="Position"
                accessibilityLabel="Position"
              />
              <Input
                value={notes}
                onChangeText={(v) => {
                  setNotes(v)
                  if (formError) setFormError(null)
                }}
                placeholder={`Grund / Notiz (min. ${RELOCATE_NOTE_MIN} Zeichen)`}
                multiline
                textAlignVertical="top"
                className="h-auto"
                style={{
                  minHeight: 64,
                  paddingTop: t.space.x2,
                  ...(formError ? { borderColor: t.colors.destructive } : {}),
                }}
                accessibilityLabel="Grund"
              />
              {formError ? (
                <Text className="text-xs" style={{ color: t.colors.destructive }}>
                  {formError}
                </Text>
              ) : (
                <Text className="text-muted-foreground text-2xs leading-4">
                  Jede Umlagerung wird im Prüfprotokoll vermerkt und ist PIN-bestätigt.
                </Text>
              )}
              <View className="flex-row gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => {
                    haptics.selection()
                    setEditing(false)
                  }}
                  disabled={relocateM.isPending}
                  accessibilityLabel="Abbrechen"
                >
                  <Text>Abbrechen</Text>
                </Button>
                <Button
                  className="flex-1"
                  onPress={submitRelocate}
                  disabled={relocateM.isPending}
                  accessibilityLabel="Umlagern bestätigen"
                >
                  <Text>{relocateM.isPending ? "Speichern" : "Bestätigen"}</Text>
                </Button>
              </View>
            </View>
          ) : null}
        </StaggerItem>

        {/* ── Aktionen ── Bearbeiten führt; Umlagern + Etikett drucken sind ruhige
            Sekundär-Aktionen; Entwurf löschen steht abgesetzt unten. */}
        {!editing ? (
          <StaggerItem index={6}>
            <View className="gap-3">
              <GroupLabel>Aktionen</GroupLabel>
              <Button
                size="xl"
                className="h-12"
                onPress={() => {
                  haptics.selection()
                  router.push({ pathname: "/product/edit", params: { id } })
                }}
                accessibilityLabel="Artikel bearbeiten"
              >
                <Pencil size={t.icon.sm} color={t.colors.primaryForeground} />
                <Text>Bearbeiten</Text>
              </Button>
              <View className="flex-row gap-2">
                <Button
                  variant="outline"
                  className="h-12 flex-1"
                  onPress={openRelocate}
                  accessibilityLabel="Umlagern"
                >
                  <Warehouse size={t.icon.sm} color={t.colors.foreground} />
                  <Text>Umlagern</Text>
                </Button>
                <LabelPrintButton
                  name={product.name}
                  sku={product.sku ?? ""}
                  barcode={product.barcode}
                  priceEur={formatEur(product.listPriceEur)}
                  location={product.locationStorageUnit ?? ""}
                />
              </View>
            </View>
          </StaggerItem>
        ) : null}

        {/* Entwurf löschen — nur unverkaufte Entwürfe, abgesetzt + dialog-bestätigt. */}
        {isDeletableDraft && !editing ? (
          <StaggerItem index={7}>
            <View className="gap-2 pt-1">
              <Hairline />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Entwurf löschen"
                disabled={deleteM.isPending}
                onPress={askDelete}
              >
                <View className="flex-row items-center justify-center gap-2 py-3">
                  <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
                    {deleteM.isPending ? "Wird gelöscht" : "Entwurf löschen"}
                  </Text>
                </View>
              </PressableScale>
            </View>
          </StaggerItem>
        ) : null}
      </ScrollView>

      {/* Löschen bestätigen — unumkehrbar, also soll der Betreiber es meinen. */}
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
              werden, die Aktion kann nicht rückgängig gemacht werden.
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
            <Button variant="destructive" onPress={runDelete} accessibilityLabel="Löschen">
              <Text>Löschen</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  )
}

/** Primary first, then by display order — the same order the Verkauf tile reads. */
function sortPhotos(items: readonly PhotoRow[]): PhotoRow[] {
  return [...items].sort((a, b) =>
    a.isPrimary === b.isPrimary ? a.displayOrder - b.displayOrder : a.isPrimary ? -1 : 1,
  )
}

/** Ein boxloser Gruppen-Kopf — Inter semibold in der Sektions-Stufe. */
function GroupLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <Text className="text-base font-semibold" numberOfLines={1}>
      {children}
    </Text>
  )
}

/** Eine nackte Wert-Zeile: Label links (gedämpft) · Wert rechts (Mono optional). */
function ValueRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}): ReactNode {
  return (
    <View className="min-h-[36px] flex-row items-center justify-between gap-4 py-1">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      <Text
        className={mono ? "font-mono-medium text-sm" : "text-sm font-medium"}
        numberOfLines={1}
        style={{ flexShrink: 1, textAlign: "right" }}
      >
        {value}
      </Text>
    </View>
  )
}

/**
 * HeroPhoto — das Hauptbild des Artikels in einem warmen Haarlinien-Rahmen, oder
 * ein ehrlicher Papier-Platzhalter mit dem bespoke Edelmetall-/Münz-Glyph, wenn
 * noch kein Foto da ist. Kein Foto erfinden — der Platzhalter sagt es ruhig.
 */
function HeroPhoto({
  photo,
  metal,
  loading,
}: {
  photo: PhotoRow | null
  metal: Metal | null
  loading: boolean
}): ReactNode {
  const t = useW14Theme()
  const radius = t.radii.xl2

  if (loading) {
    return <Skeleton width="100%" height={232} radius="card" />
  }

  if (photo) {
    return (
      <View
        className="overflow-hidden"
        style={{ borderRadius: radius, borderWidth: 1, borderColor: t.colors.border }}
      >
        <Image
          source={{ uri: absoluteUrl(photo.publicUrl ?? `/api/photos/${photo.id}`) }}
          style={{ width: "100%", height: 232, backgroundColor: t.colors.raised }}
          contentFit="cover"
          transition={220}
          recyclingKey={photo.id}
          cachePolicy="memory-disk"
        />
      </View>
    )
  }

  // Ehrlicher Platzhalter — warmes Papier, ein ruhiges bespoke Glyph, kein
  // erfundenes Bild. Das Glyph trägt das Metall, sonst die Münze.
  return (
    <View
      className="items-center justify-center gap-2"
      style={{
        height: 232,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: t.colors.border,
        backgroundColor: t.colors.card,
      }}
      accessibilityElementsHidden
    >
      <View style={{ opacity: 0.4 }}>
        {metal ? (
          <MetalIcon metal={METAL_KIND[metal]} size={56} color={t.colors.foreground} />
        ) : (
          <CoinIcon size={56} color={t.colors.foreground} />
        )}
      </View>
      <Text className="text-muted-foreground text-2xs font-medium" style={{ letterSpacing: 0.4 }}>
        Noch kein Foto
      </Text>
    </View>
  )
}

/** Der Schmelzwert-Ablesewert: ein Mono-Count-up zum Live-Schmelzwert (in Cent),
 *  aber nur, wenn es eine echte Zahl ist — sonst ein gedämpftes „—" (Ehrlichkeit). */
function SchmelzValue({ cents }: { cents: number | null }): ReactNode {
  const t = useW14Theme()
  if (cents == null) {
    return (
      <Text className="font-mono-medium text-2xl leading-none" style={{ color: t.colors.mutedForeground }}>
        —
      </Text>
    )
  }
  return (
    <CountUp
      value={cents}
      format={(c) => formatEur((c / 100).toFixed(2))}
      motion="timing"
      className="font-mono-medium text-2xl leading-none"
      style={{ color: t.colors.foreground }}
    />
  )
}

/** Der Erst-Lade-Platzhalter — die eigene Form des Details, nie ein Spinner. */
function DetailSkeleton(): ReactNode {
  return (
    <View className="gap-5">
      <Skeleton width="100%" height={232} radius="card" />
      <View className="gap-2">
        <Skeleton width="40%" height={12} />
        <Skeleton width="78%" height={28} />
        <Skeleton width="50%" height={14} />
      </View>
      <View className="gap-3 pt-2">
        <Skeleton width="30%" height={16} />
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="flex-row items-center justify-between">
            <Skeleton width="34%" height={12} />
            <Skeleton width="24%" height={12} />
          </View>
        ))}
      </View>
    </View>
  )
}

// ── PublishPanel — Kanal- + Status-Steuerung vom Telefon ─────────────────────
/**
 * Der Kern-Workflow des Betreibers: steuern, OB, WO und als WAS ein Artikel
 * gelistet ist — damit man auf einen Blick sieht, wo ein Stück liegt. Jeder
 * Schalter trifft genau das Feld, das er benennt:
 *   • „Verkaufsstatus" → status (Entwurf = nicht verkaufbar, Verfügbar = verkaufbar)
 *   • „Im Laden" → listed_on_storefront. Eine OWNER-Notiz „im Laden ausgestellt".
 *     Gatet KEINEN Verkauf — sie hilft dem Betreiber, die physische Lage zu
 *     verfolgen, und erscheint als Kanal-Marker („Laden") in der Lager-Liste.
 *   • „Im Online-Shop" → is_published_to_web; ein Artikel erscheint im Webshop NUR,
 *     wenn dieser Schalter AN ist UND der Status „Verfügbar" ist — exakt der Filter
 *     der Storefront-API (`is_published_to_web = TRUE AND status = 'AVAILABLE'`).
 *   • „eBay" → KEIN Schalter, sondern eine Lese-Zeile mit dem echten eBay-Status
 *     (`ebay_state`), die in den eBay-Bereich führt, wo das Listing wirklich passiert.
 *
 * Form: nackte Reihen direkt auf dem Papier, getrennt durch die Haarlinie.
 */
function PublishPanel({
  productId,
  status,
  listedOnStorefront,
  isPublishedToWeb,
  ebayState,
}: {
  productId: string
  status: string
  listedOnStorefront: boolean
  isPublishedToWeb: boolean
  ebayState: string | null
}): ReactNode {
  const t = useW14Theme()
  const router = useRouter()

  const toggle = useMutation(
    async (patch: {
      listedOnStorefront?: boolean
      isPublishedToWeb?: boolean
      status?: "DRAFT" | "AVAILABLE"
    }) => updateProduct(productId, patch),
    {
      onSuccess: () => haptics.success(),
      onError: () => haptics.error(),
    },
  )

  const isAvailable = status === "AVAILABLE"

  const Row = ({
    on,
    label,
    hint,
    icon,
    onPress,
  }: {
    on: boolean
    label: string
    hint: string
    icon: ReactNode
    onPress: () => void
  }) => (
    <View className="min-h-[44px] flex-row items-center gap-3 py-1">
      <View className="h-7 w-7 items-center justify-center">{icon}</View>
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-medium">{label}</Text>
        <Text className="text-muted-foreground text-2xs">{hint}</Text>
      </View>
      <PressableScale
        onPress={onPress}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: on }}
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: on ? t.colors.verdigris : t.colors.raised,
          borderWidth: 1,
          borderColor: on ? t.colors.verdigris : t.colors.border,
          justifyContent: "center",
          paddingHorizontal: 2,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: t.colors.card,
            transform: [{ translateX: on ? 20 : 0 }],
          }}
        />
      </PressableScale>
    </View>
  )

  // A read-only navigation row — used where the real action lives on another
  // screen (so a row never pretends to be a switch that does nothing).
  const NavRow = ({
    label,
    hint,
    icon,
    onPress,
  }: {
    label: string
    hint: string
    icon: ReactNode
    onPress: () => void
  }) => (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-[44px] flex-row items-center gap-3 py-1"
    >
      <View className="h-7 w-7 items-center justify-center">{icon}</View>
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-medium">{label}</Text>
        <Text className="text-muted-foreground text-2xs">{hint}</Text>
      </View>
      <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
    </PressableScale>
  )

  const ebayHint =
    ebayState == null
      ? "Nicht bei eBay — im eBay-Bereich verwalten"
      : ebayState === "ONLINE"
        ? "Online bei eBay gelistet"
        : ebayState === "ENTWURF" || ebayState === "GEPRUEFT"
          ? "eBay-Vorbereitung läuft"
          : ebayState === "REKLAMIERT" || ebayState === "RETOURNIERT"
            ? "eBay-Reklamation"
            : "Bei eBay verkauft"

  return (
    <View className="gap-3">
      <GroupLabel>Veröffentlichung</GroupLabel>
      <Row
        on={isAvailable}
        label="Verkaufsstatus"
        hint={isAvailable ? "Verfügbar, kann verkauft werden" : "Entwurf, noch nicht verkaufbar"}
        icon={<StatusGlyph on={isAvailable} ink={t.colors.foreground} gilt={t.colors.gilt} />}
        onPress={() => {
          haptics.selection()
          void toggle.mutate({ status: isAvailable ? "DRAFT" : "AVAILABLE" })
        }}
      />
      <Hairline inset={40} />
      <Row
        on={listedOnStorefront}
        label="Im Laden"
        hint={listedOnStorefront ? "Im Laden ausgestellt" : "Nicht im Laden ausgestellt"}
        icon={<Store size={t.icon.md} color={t.colors.foreground} />}
        onPress={() => {
          haptics.selection()
          void toggle.mutate({ listedOnStorefront: !listedOnStorefront })
        }}
      />
      <Hairline inset={40} />
      <Row
        on={isPublishedToWeb}
        label="Im Online-Shop"
        hint={
          isPublishedToWeb
            ? isAvailable
              ? "Für Kunden im Online-Shop sichtbar"
              : "Sichtbar, sobald der Artikel verfügbar ist"
            : "Nicht im Online-Shop sichtbar"
        }
        icon={<Globe size={t.icon.md} color={t.colors.foreground} />}
        onPress={() => {
          haptics.selection()
          void toggle.mutate({ isPublishedToWeb: !isPublishedToWeb })
        }}
      />
      <Hairline inset={40} />
      <NavRow
        label="eBay"
        hint={ebayHint}
        icon={<Tag size={t.icon.md} color={t.colors.foreground} />}
        onPress={() => {
          haptics.selection()
          router.push("/ebay")
        }}
      />
      {toggle.error != null ? (
        <InlineError
          message="Änderung konnte nicht gespeichert werden."
          onRetry={() => toggle.reset()}
        />
      ) : null}
    </View>
  )
}

/** Ein bespoke Status-Glyph (react-native-svg): ein Häkchen-Siegel, wenn
 *  verfügbar (der Faden tönt in Gilt), sonst ein offener Tinten-Ring (Entwurf). */
function StatusGlyph({ on, ink, gilt }: { on: boolean; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Path
        d="M12 3.5 a 8.5 8.5 0 1 0 0.001 0 Z"
        stroke={ink}
        strokeWidth={on ? 1.4 : 1.2}
        strokeOpacity={on ? 1 : 0.45}
        fill="none"
      />
      {on ? (
        <Path
          d="M8.4 12.2 L11 14.7 L15.8 9.4"
          stroke={gilt}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
    </Svg>
  )
}

// ── LabelPrintButton — ein Barcode-Etikett über den OS-Druckdialog drucken ────
/**
 * Der Betreiber tippt dies auf dem Artikel-Detail → der OS-Druckdialog öffnet
 * sich mit einem 58mm-Etikett (Barcode + Preis + Name + Lagerort) → druckt auf
 * jeden Etikettendrucker, den das OS kennt (AirPrint, Mopria). Nutzt expo-print.
 */
function LabelPrintButton({
  name,
  sku,
  barcode,
  priceEur,
  location,
}: {
  name: string
  sku: string
  barcode: string | null
  priceEur: string
  location: string
}): ReactNode {
  const t = useW14Theme()
  const [busy, setBusy] = useState(false)

  const onPrint = useCallback(async () => {
    haptics.selection()
    setBusy(true)
    try {
      const html = buildLabelHtml({ name, sku, barcode, priceEur, location: location || null })
      // expo-print is available via the print/capabilities module; use it directly.
      const { printAsync } = await import("expo-print")
      await printAsync({ html })
    } catch {
      haptics.error()
    } finally {
      setBusy(false)
    }
  }, [name, sku, barcode, priceEur, location])

  return (
    <Button
      variant="outline"
      className="h-12 flex-1"
      onPress={onPrint}
      disabled={busy}
      accessibilityLabel="Etikett drucken"
    >
      <Printer size={t.icon.sm} color={t.colors.foreground} />
      <Text>{busy ? "Drucke" : "Etikett"}</Text>
    </Button>
  )
}
