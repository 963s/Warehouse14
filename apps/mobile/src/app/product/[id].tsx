/**
 * Artikel — Detail + Fotos + Umlagern. The product's identity, status, the
 * Lagerort triplet, the prices, and the live Schmelzwert (Feingewicht × aktueller
 * Kurs), all from `productsApi.get` (live via the shared `useQuery`: refetch-on-
 * focus so a freshly captured photo / relocation shows the moment you return,
 * pull-to-refresh, in-flight de-dupe). The metal price is a second live read so
 * the Schmelzwert is a real number or a muted „—", never fabricated (honesty rule).
 *
 * Two step-up-gated actions, each surfaced through the shared spine:
 *   • „Umlagern" (LOCATION_CHANGE) → writes audit_log AND requires step-up; the
 *     global StepUpDialogHost fires the PIN transparently and the call retries.
 *     A success lands with the Success haptic + the verdigris banner.
 *   • „Entwurf löschen" → only unsold DRAFTs; an irreversible-feeling action, so
 *     it is confirmed in a themed Dialog first and lands with the Error/Success
 *     haptic. The DELETE also 403s with STEP_UP_REQUIRED and auto-retries.
 *
 * Photos: the grid lists the product's photos (primary first); tapping a non-
 * primary thumb promotes it. „Foto hinzufügen" routes into the capture pipeline.
 *
 * Built entirely on the shared spine — the state system (Skeleton in the detail's
 * shape · ErrorState+Retry · InlineError), SectionCard/ListRow/CountUp,
 * StaggerItem + PressableScale motion, the haptic vocabulary, and theme tokens.
 */
import { useCallback, useState } from "react"
import { Image, RefreshControl, ScrollView, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import type { CurrentMetalPrice, PhotoRow } from "@warehouse14/api-client"
import {
  Banknote,
  Camera,
  Coins,
  Globe,
  MapPin,
  Pencil,
  Printer,
  RefreshCw,
  ShieldAlert,
  Store,
  Warehouse,
  Weight,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import {
  conditionLabel,
  formatGrams,
  formatLocation,
  METAL_LABEL,
  statusLabel,
  statusVariant,
} from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  ErrorState,
  haptics,
  InlineError,
  isNotFoundError,
  ListRow,
  PaperGrain,
  PressableScale,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

const RELOCATE_NOTE_MIN = 8

/**
 * The melt value in integer CENTS = Feingewicht (g) × aktueller Kurs (€/g), or
 * `null` when either input is missing (honesty rule — no fabricated figure). The
 * formatted string version (`schmelzwertEur`) is the source of truth for display
 * text; this gives the count-up an honest magnitude without re-parsing it.
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

  // One live read drives loading/error/refetch; refetch-on-focus keeps a freshly
  // captured photo / relocation visible the moment you return.
  const productQ = useQuery(() => getProduct(id), { key: `product:${id}`, enabled: !!id })
  const pricesQ = useQuery(() => currentMetalPrices(), { key: "metal-prices", staleTimeMs: 60_000 })
  const photosQ = useQuery(() => listProductPhotos(id), {
    key: `product-photos:${id}`,
    enabled: !!id,
  })
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

  // ── Action feedback ─────────────────────────────────────────────────────────
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // ── Relocate sheet ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useState("")
  const [drawer, setDrawer] = useState("")
  const [position, setPosition] = useState("")
  const [notes, setNotes] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  // ── Delete confirm ──────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false)

  const prices: readonly CurrentMetalPrice[] = pricesQ.data?.prices ?? []
  const photos: PhotoRow[] = sortPhotos(photosQ.data?.items ?? [])
  // Honesty: an empty `photos` array is only a real „keine Fotos" once the read
  // has SUCCEEDED. While it is still loading, or if it failed, the section must
  // not assert a confirmed-empty count — it shows a skeleton / a retry instead.
  const photosErrored = photosQ.status === "error" && photosQ.data == null
  const photosFirstLoad = photosQ.isLoading && photosQ.data == null
  const photosConfirmed = !photosErrored && !photosFirstLoad
  const photoCountLabel = photosConfirmed ? ` (${photos.length})` : ""

  // ── Mutations (step-up is transparent in the api layer) ─────────────────────
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
        setOkMsg(res ? `Umgelagert · Protokoll ${res.auditLogId.slice(0, 8)}…` : "Umgelagert")
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

  // ── States ──────────────────────────────────────────────────────────────────
  if (productQ.isLoading && product == null) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom }}
      >
        <DetailSkeleton />
      </ScrollView>
    )
  }

  if (product == null) {
    // A 404 here is normal (a deleted/merged article reached via a deep-link or a
    // stale list) — let ErrorState render its calm muted „nicht gefunden" frame
    // with a domain title, never the red „konnte nicht geladen werden" card.
    const productMissing = isNotFoundError(productQ.errorCause)
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <ErrorState
          title={productMissing ? "Artikel nicht gefunden" : undefined}
          message={
            productMissing
              ? "Dieser Artikel ist nicht mehr vorhanden er wurde vermutlich gelöscht."
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

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 12 }}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* Identity header name · SKU · status, with a leading article disc. */}
        <StaggerItem index={0}>
          <View className="flex-row items-center gap-3">
            <View
              className="h-14 w-14 items-center justify-center rounded-xl"
              style={{ backgroundColor: t.colors.primary + "1f" }}
            >
              <Coins size={t.icon.xl} color={t.colors.primary} />
            </View>
            <View className="flex-1 gap-1">
              <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={2}>
                {product.name}
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
                  {product.sku}
                </Text>
                <Badge variant={statusVariant(product.status)} dot>
                  <Text>{statusLabel(product.status)}</Text>
                </Badge>
              </View>
            </View>
          </View>
        </StaggerItem>

        {/* Bearbeiten the one calm primary nav off this screen. */}
        <StaggerItem index={1}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Artikel bearbeiten"
            onPress={() => {
              haptics.selection()
              router.push({ pathname: "/product/edit", params: { id } })
            }}
          >
            <Card className="min-h-[48px] flex-row items-center gap-3 px-4 py-3">
              <View
                className="h-8 w-8 items-center justify-center rounded-md"
                style={{ backgroundColor: t.colors.primary + "1f" }}
              >
                <Pencil size={t.icon.md} color={t.colors.primary} />
              </View>
              <Text className="flex-1 text-base font-medium">Bearbeiten</Text>
            </Card>
          </PressableScale>
        </StaggerItem>

        {/* Action feedback the verdigris success / the unified error card. */}
        {okMsg ? (
          <StaggerItem index={2} exit>
            <Card
              className="flex-row items-center gap-2.5 px-4 py-3.5"
              style={{
                borderColor: t.colors.verdigris + "66",
                backgroundColor: t.colors.verdigris + "12",
              }}
              accessibilityRole="alert"
            >
              <Warehouse size={t.icon.sm} color={t.colors.verdigris} />
              <Text className="flex-1 text-sm font-semibold" style={{ color: t.colors.verdigris }}>
                {okMsg}
              </Text>
            </Card>
          </StaggerItem>
        ) : null}
        {actionError ? (
          <StaggerItem index={2} exit>
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

        {/* Werte Schmelzwert (live count-up) + the prices + Lagerort. */}
        <StaggerItem index={3}>
          <SectionCard title="Werte" icon={Banknote}>
            <View className="flex-row items-center justify-between py-1">
              <View className="flex-row items-center gap-2.5">
                <View
                  className="h-8 w-8 items-center justify-center rounded-md"
                  style={{ backgroundColor: t.colors.primary + "1f" }}
                >
                  <Weight size={t.icon.md} color={t.colors.primary} />
                </View>
                <View>
                  <Text className="text-base font-medium">Schmelzwert</Text>
                  <Text className="text-muted-foreground text-2xs">
                    {pricesQ.isLoading ? "Kurs wird geladen …" : "Feingewicht × aktueller Kurs"}
                  </Text>
                </View>
              </View>
              <SchmelzValue cents={schmelz} />
            </View>
            <ListRow
              icon={Banknote}
              title="Listenpreis"
              value={formatEur(product.listPriceEur)}
              mono
            />
            <ListRow
              icon={Coins}
              title="Einkaufspreis"
              value={formatEur(product.acquisitionCostEur)}
              mono
            />
            {product.feingewichtGrams && product.metal ? (
              <ListRow
                icon={Weight}
                title="Feingewicht"
                value={`${formatGrams(product.feingewichtGrams)} g · ${METAL_LABEL[product.metal]}`}
              />
            ) : null}
            <ListRow
              icon={MapPin}
              title="Lagerort"
              value={formatLocation(
                product.locationStorageUnit,
                product.locationDrawer,
                product.locationPosition,
              )}
            />
            <ListRow title="Zustand" value={conditionLabel(product.condition)} />
          </SectionCard>
        </StaggerItem>

        {/* Fotos primary first; tap a non-primary thumb to promote it. */}
        <StaggerItem index={4}>
          <SectionCard
            title={`Fotos${photoCountLabel}`}
            icon={Camera}
            action={
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  haptics.selection()
                  router.push({ pathname: "/capture", params: { productId: id } })
                }}
                accessibilityLabel="Foto hinzufügen"
              >
                <Text className="text-primary">Hinzufügen</Text>
              </Button>
            }
          >
            {photosErrored ? (
              // A load FAILURE — never claim „keine Fotos" when the truth is
              // „konnte nicht geladen werden". Offer an honest retry instead.
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
                    <RefreshCw size={t.icon.xs} color={t.colors.primary} />
                    <Text className="text-primary text-sm font-medium">
                      {photosQ.isFetching ? "Wird geladen…" : "Erneut laden"}
                    </Text>
                  </View>
                </PressableScale>
              </View>
            ) : photosFirstLoad ? (
              // First read still in flight — a shape-faithful placeholder, not a
              // premature „keine Fotos".
              <View className="flex-row gap-2" accessibilityElementsHidden>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} width={84} height={84} radius="button" />
                ))}
              </View>
            ) : photos.length === 0 ? (
              <Text className="text-muted-foreground text-sm">
                Noch keine Fotos. Hinzufügen", um das erste aufzunehmen es wird zum Hauptbild.
              </Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {photos.map((ph) => (
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
                    <View className="items-center gap-1">
                      <View
                        className="rounded-xl p-0.5"
                        style={{
                          borderWidth: ph.isPrimary ? 2 : 1,
                          borderColor: ph.isPrimary ? t.colors.primary : t.colors.border,
                        }}
                      >
                        <Image
                          source={{ uri: absoluteUrl(ph.thumbUrl ?? `/api/photos/${ph.id}/thumb`) }}
                          style={{
                            width: 84,
                            height: 84,
                            borderRadius: t.radii.button,
                            backgroundColor: t.colors.border,
                          }}
                        />
                      </View>
                      <Text
                        className="text-2xs"
                        style={{
                          color: ph.isPrimary ? t.colors.primary : t.colors.mutedForeground,
                        }}
                      >
                        {ph.isPrimary ? "Hauptbild" : "Als Hauptbild"}
                      </Text>
                    </View>
                  </PressableScale>
                ))}
              </View>
            )}
          </SectionCard>
        </StaggerItem>

        {/* Umlagern the relocate sheet (a real audit_log write + step-up). */}
        <StaggerItem index={5}>
          {editing ? (
            <SectionCard title="Umlagern" icon={Warehouse}>
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
                <Text className="text-muted-foreground text-2xs">
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
                  <Text>{relocateM.isPending ? "Speichern…" : "Bestätigen"}</Text>
                </Button>
              </View>
            </SectionCard>
          ) : (
            <Button size="xl" className="h-12" onPress={openRelocate} accessibilityLabel="Umlagern">
              <Text>Umlagern</Text>
            </Button>
          )}
        </StaggerItem>

        {/* ── Veröffentlichung — channel control from the phone ── */}
        <StaggerItem index={6}>
          <PublishPanel
            productId={product.id}
            status={product.status}
            listedOnStorefront={product.listedOnStorefront}
            listedOnEbay={product.listedOnEbay}
          />
        </StaggerItem>

        {/* ── Etikett drucken — barcode label via the OS print dialog ── */}
        <StaggerItem index={7}>
          <LabelPrintButton
            name={product.name}
            sku={product.sku ?? ""}
            barcode={product.barcode}
            priceEur={formatEur(product.listPriceEur)}
            location={product.locationStorageUnit ?? ""}
          />
        </StaggerItem>

        {/* Entwurf löschen only unsold DRAFTs, confirmed in a dialog first. */}
        {isDeletableDraft ? (
          <StaggerItem index={8}>
            <Button
              variant="destructive"
              size="xl"
              className="h-12"
              onPress={askDelete}
              disabled={deleteM.isPending}
              accessibilityLabel="Entwurf löschen"
            >
              <Text>{deleteM.isPending ? "Löschen…" : "Entwurf löschen"}</Text>
            </Button>
          </StaggerItem>
        ) : null}
      </ScrollView>

      {/* Delete confirm irreversible, so make the operator mean it. */}
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
              {product.name}" wird unwiderruflich gelöscht. Nur unverkaufte Entwürfe können
              gelöscht werden die Aktion kann nicht rückgängig gemacht werden.
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

/** The Schmelzwert read-out: a brass count-up to the live melt value (in cents),
 *  but only when it is a real number — otherwise a muted „—" (honesty rule). */
function SchmelzValue({ cents }: { cents: number | null }) {
  const t = useW14Theme()
  if (cents == null) {
    return (
      <Text className="font-mono-medium text-lg" style={{ color: t.colors.mutedForeground }}>
        —
      </Text>
    )
  }
  return (
    <CountUp
      value={cents}
      format={(c) => formatEur((c / 100).toFixed(2))}
      motion="timing"
      className="font-mono-medium text-lg"
      style={{ color: t.colors.primary }}
    />
  )
}

/** The first-load placeholder — the detail's own shape, never a mid-screen spinner. */
function DetailSkeleton() {
  const t = useW14Theme()
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <Skeleton width={56} height={56} radius="card" />
        <View className="flex-1 gap-2">
          <Skeleton width="66%" height={20} />
          <Skeleton width="44%" height={12} />
        </View>
      </View>
      <Skeleton width="100%" height={48} radius="card" />
      {[0, 1].map((i) => (
        <Card key={i} className="gap-3 px-4 py-4" style={{ borderColor: t.colors.border }}>
          <Skeleton width="40%" height={16} />
          <Skeleton width="86%" height={12} />
          <Skeleton width="74%" height={12} />
          <Skeleton width="60%" height={12} />
        </Card>
      ))}
    </View>
  )
}

// ── PublishPanel — channel + status control from the phone ───────────────────
/**
 * The owner's core mobile workflow: control where a product is listed (Im Laden
 * = storefront, Online = eBay) and its status (Draft = not sellable, Available =
 * sellable). All toggles hit the REAL updateProduct endpoint.
 */
function PublishPanel({
  productId,
  status,
  listedOnStorefront,
  listedOnEbay,
}: {
  productId: string
  status: string
  listedOnStorefront: boolean
  listedOnEbay: boolean
}): React.ReactNode {
  const t = useW14Theme()

  const toggle = useMutation(
    async (patch: { listedOnStorefront?: boolean; listedOnEbay?: boolean; status?: "DRAFT" | "AVAILABLE" }) =>
      updateProduct(productId, patch),
    {
      onSuccess: () => haptics.success(),
      onError: () => haptics.error(),
    },
  )

  const isAvailable = status === "AVAILABLE"

  const Switch = ({ on, label, icon, onPress }: { on: boolean; label: string; icon: React.ReactNode; onPress: () => void }) => (
    <View className="flex-row items-center justify-between py-2">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-sm font-medium">{label}</Text>
      </View>
      <PressableScale
        onPress={onPress}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: on }}
        style={{
          width: 48, height: 28, borderRadius: 14,
          backgroundColor: on ? t.colors.verdigris : t.colors.raised,
          borderWidth: 1,
          borderColor: on ? t.colors.verdigris : t.colors.border,
          justifyContent: "center", paddingHorizontal: 2,
        }}
      >
        <View style={{
          width: 22, height: 22, borderRadius: 11,
          backgroundColor: t.colors.card,
          transform: [{ translateX: on ? 20 : 0 }],
        }} />
      </PressableScale>
    </View>
  )

  return (
    <SectionCard title="Veröffentlichung" subtitle="Wo und ob der Artikel verkaufbar ist.">
      <Switch
        on={isAvailable}
        label="Verkaufstatus"
        icon={<Text className="text-sm">{isAvailable ? "✓" : "○"}</Text>}
        onPress={() => { haptics.selection(); void toggle.mutate({ status: isAvailable ? "DRAFT" : "AVAILABLE" }) }}
      />
      <View className="h-px w-full" style={{ backgroundColor: t.colors.border }} />
      <Switch
        on={listedOnStorefront}
        label="Im Laden"
        icon={<Store size={t.icon.sm} color={t.colors.foreground} />}
        onPress={() => { haptics.selection(); void toggle.mutate({ listedOnStorefront: !listedOnStorefront }) }}
      />
      <View className="h-px w-full" style={{ backgroundColor: t.colors.border }} />
      <Switch
        on={listedOnEbay}
        label="Online"
        icon={<Globe size={t.icon.sm} color={t.colors.foreground} />}
        onPress={() => { haptics.selection(); void toggle.mutate({ listedOnEbay: !listedOnEbay }) }}
      />
      {toggle.error != null ? (
        <InlineError message="Änderung konnte nicht gespeichert werden." onRetry={() => toggle.reset()} />
      ) : null}
    </SectionCard>
  )
}

// ── LabelPrintButton — print a barcode label via the OS print dialog ──────────
/**
 * The owner taps this on the product detail → the OS print dialog opens with a
 * 58mm label (barcode + price + name + location) → prints to any label printer
 * the OS knows (AirPrint, Mopria). Uses expo-print (available in this build).
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
}): React.ReactNode {
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
      variant="ghost"
      size="xl"
      className="h-12"
      onPress={onPrint}
      disabled={busy}
      accessibilityLabel="Etikett drucken"
    >
      <Printer size={18} color={undefined} />
      <Text>{busy ? "Drucke…" : "Etikett drucken"}</Text>
    </Button>
  )
}
