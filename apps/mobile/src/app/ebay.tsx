/**
 * eBay-Kanal — die Owner-Fläche über die 9-stufige Listungs-Zustandsmaschine.
 * Sie ist CLIENT-ONLY über die Server-Endpunkte: die erlaubten Übergänge kommen
 * aus `ALLOWED_EBAY_TRANSITIONS` (api-client), der Server-Trigger besitzt den
 * Bestands-Nebeneffekt (Auto-Reservierung / Konflikt), und der publish-Endpunkt
 * besitzt den echten Marktplatz-Push. Diese Fläche zeigt nur, was wirklich da
 * ist, und löst nur Aktionen aus, die der Server akzeptieren wird.
 *
 * Aufbau:
 *   • Pipeline-Übersicht — Phasen-Kacheln mit ECHTEN Zählungen (aus den
 *     Detail-Zuständen der eingebuchten Artikel). Nichts eingebucht → ehrlicher
 *     leerer Zustand, kein erfundener Bestand.
 *   • Listungen — die eingebuchten Artikel als Zeilen; Tippen öffnet das Detail-
 *     Sheet mit Zustands-Badge, Verlauf, den erlaubten Übergangs-Aktionen
 *     (Schritt-Bestätigung mit transparentem Step-up), der Veröffentlichungs-
 *     Aktion mit ehrlichem „Token ausstehend", und der Konflikt-Anzeige.
 *   • Einbuchen — Suche nach verfügbaren, noch nicht eingebuchten Artikeln, um
 *     sie als Entwurf in die eBay-Pipeline aufzunehmen (NULL → ENTWURF).
 *
 * Ehrlichkeitsregel: jede Zahl ist eine echte Summe aus einer echten Antwort,
 * jeder Zustand ein echtes Feld vom Server. Ein Übergang, der den Bestand
 * berührt (Verkauft-Cluster), zeigt seinen serverseitigen Nebeneffekt sichtbar
 * an. Eine Veröffentlichung ohne Token sagt „Token ausstehend" — nie „gelistet".
 * Gebaut auf dem geteilten Spine (Suche wie im Lager, die UI-Primitive, das §6-
 * Motion- + §7-Haptik-Vokabular, nur W14-Theme-Tokens). Deutsche UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, RefreshControl, ScrollView, View } from "react-native"
import type { EbayState, ProductDetail, ProductListRow } from "@warehouse14/api-client"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  History,
  PackagePlus,
  Search,
  ShoppingBag,
  Store,
  Tag,
  Upload,
  X,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  describeError,
  ebayHistory,
  formatEur,
  getProduct,
  listProducts,
  publishToEbay,
  transitionEbayState,
} from "@/warehouse14/api"
import {
  countPipeline,
  describePublish,
  describeSideEffect,
  EBAY_PHASES,
  entersSoldCluster,
  type EbayPhase,
  type EbayTransitionOption,
  nextTransitions,
  phaseOf,
  type PipelineCounts,
  type PublishMeta,
  type SideEffectMeta,
  sourceLabel,
  stateLabel,
  stateVariant,
} from "@/warehouse14/ebay-ui"
import { relativeTime } from "@/warehouse14/notifications"
import { STATUS_LABEL, STATUS_VARIANT } from "@/warehouse14/product-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  haptics,
  InlineError,
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

const DEBOUNCE_MS = 300
const SEARCH_LIMIT = 20
const PIPELINE_DETAIL_CAP = 60 // safety bound on the per-listing detail fan-out

/** One enrolled listing = a list row enriched with its real eBay state/time. */
interface EnrolledListing {
  row: ProductListRow
  state: EbayState | null
  stateChangedAt: string | null
}

/** What the pipeline fetcher returns: the enriched listings + derived counts. */
interface PipelineData {
  listings: EnrolledListing[]
  counts: PipelineCounts
  /** True if a detail read failed for at least one listing (partial honesty). */
  partial: boolean
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline fetcher — enrolled list rows, enriched with their real ebayState
// ────────────────────────────────────────────────────────────────────────────

/**
 * The list row does NOT carry `ebayState` (only the detail does), so we read the
 * detail for each enrolled product to know its phase. The set of eBay-enrolled
 * items is small in practice; we cap the fan-out and de-dupe via the query key.
 * A single failed detail read does not blank the board — that listing is shown
 * with an unknown state and the board is flagged `partial` (honesty rule).
 *
 * We filter by `enrolledOnEbay: true` (ebay_state IS NOT NULL) — the real
 * pipeline membership — NOT by the legacy `listedOnEbay` flag, which only flips
 * on a marketplace publish and so leaves every Owner-enrolled item invisible
 * until a real eBay token is wired up.
 */
async function fetchPipeline(): Promise<PipelineData> {
  const list = await listProducts({ enrolledOnEbay: true, limit: PIPELINE_DETAIL_CAP })
  const rows = list.items
  const details = await Promise.allSettled(rows.map((r) => getProduct(r.id)))

  let partial = false
  const listings: EnrolledListing[] = rows.map((row, i) => {
    const d = details[i]
    if (d.status === "fulfilled") {
      const detail: ProductDetail = d.value
      return { row, state: detail.ebayState, stateChangedAt: detail.ebayStateChangedAt }
    }
    partial = true
    return { row, state: null, stateChangedAt: null }
  })

  const counts = countPipeline(listings.map((l) => l.state))
  return { listings, counts, partial }
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline overview — the four phase tiles, real counts only
// ────────────────────────────────────────────────────────────────────────────

function PhaseTiles({ counts }: { counts: PipelineCounts }) {
  const t = useW14Theme()
  const phaseColor: Record<EbayPhase, string> = {
    vorbereitung: t.colors.mutedForeground,
    online: t.colors.verdigris,
    verkauft: t.colors.primary,
    reklamation: t.colors.destructive,
  }
  return (
    <View className="flex-row flex-wrap gap-2.5">
      {EBAY_PHASES.map((p) => {
        const n = counts.byPhase[p.phase]
        const color = phaseColor[p.phase]
        const active = n > 0
        return (
          <Card key={p.phase} className="gap-1.5 px-3 py-3" style={{ width: "47.5%" }}>
            <Text
              className="text-muted-foreground text-xs font-medium uppercase"
              style={{ letterSpacing: 0.4 }}
              numberOfLines={1}
            >
              {p.label}
            </Text>
            <Text
              className="font-mono-medium text-2xl"
              style={{ color: active ? color : t.colors.mutedForeground }}
            >
              {n}
            </Text>
            <Text className="text-muted-foreground text-2xs leading-4" numberOfLines={2}>
              {p.description}
            </Text>
          </Card>
        )
      })}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// One enrolled listing row
// ────────────────────────────────────────────────────────────────────────────

function ListingRow({
  listing,
  onPress,
}: {
  listing: EnrolledListing
  onPress: () => void
}) {
  const t = useW14Theme()
  const { row, state, stateChangedAt } = listing
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, eBay-Zustand ${stateLabel(state)}`}
    >
 <View className="flex-row items-center gap-3 hairline-b px-3 py-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {row.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {row.sku}
            </Text>
            {stateChangedAt != null ? (
              <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
                {relativeTime(stateChangedAt)}
              </Text>
            ) : null}
          </View>
        </View>
        <Badge variant={stateVariant(state)} dot>
          <Text>{stateLabel(state)}</Text>
        </Badge>
        <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
      </View>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// The conflict / side-effect banner (shown after a sold-cluster transition)
// ────────────────────────────────────────────────────────────────────────────

function SideEffectBanner({ meta }: { meta: SideEffectMeta }) {
  const t = useW14Theme()
  if (!meta.show) return null
  const color = meta.isConflict ? t.colors.destructive : t.colors.primary
  const Icon = meta.isConflict ? AlertTriangle : CheckCircle2
  return (
    <View
      className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3"
      style={{ backgroundColor: color + "14" }}
      accessibilityRole="alert"
    >
      <View className="pt-0.5">
        <Icon size={t.icon.md} color={color} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold" style={{ color }}>
          {meta.title}
        </Text>
        <Text className="text-muted-foreground text-xs leading-5">{meta.message}</Text>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// The publish-result banner (live / token-pending / not-published — honest)
// ────────────────────────────────────────────────────────────────────────────

function PublishBanner({ meta }: { meta: PublishMeta }) {
  const t = useW14Theme()
  const color = meta.isLive ? t.colors.verdigris : t.colors.mutedForeground
  const Icon = meta.isLive ? CheckCircle2 : Upload
  return (
    <View
      className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3"
      style={{ backgroundColor: color + "14" }}
      accessibilityRole="alert"
    >
      <View className="pt-0.5">
        <Icon size={t.icon.md} color={color} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold" style={{ color }}>
          {meta.title}
        </Text>
        <Text className="text-muted-foreground text-xs leading-5">{meta.message}</Text>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Listing detail sheet — state, transitions, publish, history
// ────────────────────────────────────────────────────────────────────────────

function ListingDetailSheet({
  productId,
  productName,
  open,
  onOpenChange,
  onChanged,
}: {
  productId: string | null
  productName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after any state change or publish so the pipeline refetches. */
  onChanged: () => void
}) {
  const t = useW14Theme()

  // The detail (state) + history are read fresh while the sheet is open.
  const detail = useQuery(() => getProduct(productId as string), {
    key: productId ? `ebay:detail:${productId}` : undefined,
    enabled: open && productId != null,
  })
  const history = useQuery(() => ebayHistory(productId as string, { limit: 20 }), {
    key: productId ? `ebay:history:${productId}` : undefined,
    enabled: open && productId != null,
  })

  // The last side-effect (from a transition) + publish result, shown until the
  // sheet is closed or another action runs.
  const [sideEffect, setSideEffect] = useState<SideEffectMeta | null>(null)
  const [publishMeta, setPublishMeta] = useState<PublishMeta | null>(null)
  // A pending transition awaiting the explicit confirm (the gate).
  const [pending, setPending] = useState<EbayTransitionOption | null>(null)

  useEffect(() => {
    if (open) {
      setSideEffect(null)
      setPublishMeta(null)
      setPending(null)
    }
  }, [open, productId])

  const state = detail.data?.ebayState ?? null
  const transitions = useMemo(() => nextTransitions(state), [state])

  const transitionM = useMutation(
    (vars: { to: EbayState }) => transitionEbayState(productId as string, { toState: vars.to }),
    {
      onSuccess: (res) => {
        haptics.success()
        if (res) setSideEffect(describeSideEffect(res.inventorySideEffect))
        setPublishMeta(null)
        void detail.refetch()
        void history.refetch()
        onChanged()
      },
      onError: () => haptics.error(),
    },
  )

  const publishM = useMutation(() => publishToEbay(productId as string), {
    onSuccess: (res) => {
      if (!res) return
      const meta = describePublish(res)
      if (meta.isLive) haptics.success()
      else haptics.selection()
      setPublishMeta(meta)
      setSideEffect(null)
      void detail.refetch()
      void history.refetch()
      onChanged()
    },
    onError: () => haptics.error(),
  })

  const busy = transitionM.isPending || publishM.isPending

  // The publish CTA only makes sense from a pre-online state (ENTWURF/GEPRUEFT);
  // once ONLINE+ the marketplace push is past. We show it for the prepare phase.
  const canPublish = state === "ENTWURF" || state === "GEPRUEFT"

  function requestTransition(opt: EbayTransitionOption) {
    haptics.selection()
    setPending(opt)
  }

  async function confirmTransition() {
    if (!pending) return
    haptics.impactLight()
    try {
      await transitionM.mutate({ to: pending.to })
    } catch {
      // error surfaced via transitionM.error (themed); keep the sheet open
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>{productName || "Listung"}</DialogTitle>
          <DialogDescription>eBay-Zustand, Aktionen und Verlauf.</DialogDescription>
        </DialogHeader>

        <ScrollView
          className="max-h-[460px]"
          contentContainerStyle={{ gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Current state */}
          {detail.status === "loading" && detail.data == null ? (
            <View className="gap-2">
              <Skeleton width="40%" height={14} />
              <Skeleton width="60%" height={28} radius="button" />
            </View>
          ) : detail.error != null && detail.data == null ? (
            <InlineError message={detail.error} onRetry={() => void detail.refetch()} />
          ) : (
            <View className="items-center gap-1.5 rounded-xl border border-border bg-card py-4">
              <Text className="text-muted-foreground text-xs uppercase tracking-wide">
                Aktueller Zustand
              </Text>
              <Badge variant={stateVariant(state)} dot>
                <Text>{stateLabel(state)}</Text>
              </Badge>
              {detail.data?.ebayStateChangedAt != null ? (
                <Text className="text-muted-foreground text-2xs">
                  geändert {relativeTime(detail.data.ebayStateChangedAt)}
                </Text>
              ) : null}
            </View>
          )}

          {/* Honest result banners */}
          {sideEffect != null ? <SideEffectBanner meta={sideEffect} /> : null}
          {publishMeta != null ? <PublishBanner meta={publishMeta} /> : null}

          {/* Mutation errors (themed German) */}
          {transitionM.error != null ? (
            <InlineError message={transitionM.error} onDismiss={transitionM.reset} />
          ) : null}
          {publishM.error != null ? (
            <InlineError message={publishM.error} onDismiss={publishM.reset} />
          ) : null}

          {/* Publish action honest token-pending state lives in the result */}
          {canPublish ? (
            <View className="gap-2">
              <Text className="text-sm font-semibold">Bei eBay veröffentlichen</Text>
              <Text className="text-muted-foreground text-xs leading-5">
                Schiebt den Artikel als Listung zum Marktplatz. Ist noch kein eBay-Zugang
                hinterlegt, passiert nichts Echtes du siehst dann Token ausstehend".
              </Text>
              <Button
                variant="outline"
                onPress={() => void publishM.mutate(undefined)}
                disabled={busy}
                accessibilityLabel="Bei eBay veröffentlichen"
              >
                <Upload size={t.icon.sm} color={t.colors.primary} />
                <Text>{publishM.isPending ? "Wird veröffentlicht…" : "Veröffentlichen"}</Text>
              </Button>
            </View>
          ) : null}

          {/* Transition actions exactly the server-allowed next steps */}
          <View className="gap-2">
            <Text className="text-sm font-semibold">Nächster Schritt</Text>
            {transitions.length === 0 ? (
              <Text className="text-muted-foreground text-xs leading-5">
                Diese Listung ist am Ende der Pipeline kein weiterer Schritt möglich.
              </Text>
            ) : (
              transitions.map((opt) => (
                <Pressable
                  key={opt.to}
                  onPress={() => requestTransition(opt)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={opt.actionLabel}
                  className="flex-row items-center gap-3 rounded-xl border border-border px-3 py-3"
                  style={{ opacity: busy ? 0.5 : 1 }}
                >
                  <View
                    className="h-8 w-8 items-center justify-center rounded-md"
                    style={{
                      backgroundColor:
                        (opt.isRevert ? t.colors.mutedForeground : t.colors.primary) + "1f",
                    }}
                  >
                    <ArrowRight
                      size={t.icon.sm}
                      color={opt.isRevert ? t.colors.mutedForeground : t.colors.primary}
                    />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-sm font-medium">{opt.actionLabel}</Text>
                    <Text className="text-muted-foreground text-2xs leading-4" numberOfLines={2}>
                      {opt.hint}
                      {entersSoldCluster(opt.to)
                        ? " Reserviert den Bestand serverseitig."
                        : ""}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>

          {/* History the append-only event log */}
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <History size={t.icon.sm} color={t.colors.mutedForeground} />
              <Text className="text-sm font-semibold">Verlauf</Text>
            </View>
            {history.status === "loading" && history.data == null ? (
              <View className="gap-2">
                <Skeleton width="80%" height={12} />
                <Skeleton width="65%" height={12} />
              </View>
            ) : history.error != null && history.data == null ? (
              <InlineError message={history.error} onRetry={() => void history.refetch()} />
            ) : history.data != null && history.data.items.length === 0 ? (
              <Text className="text-muted-foreground text-xs leading-5">
                Noch kein Eintrag. Schritte erscheinen hier, sobald du sie ausführst.
              </Text>
            ) : history.data != null ? (
              <View className="gap-2">
                {history.data.items.map((ev) => (
                  <View key={ev.id} className="flex-row items-start gap-2.5">
                    <View
                      className="mt-1 h-2 w-2 rounded-full"
                      style={{ backgroundColor: t.colors.primary }}
                    />
                    <View className="flex-1">
                      <Text className="text-xs font-medium">
                        {ev.fromState ? `${stateLabel(ev.fromState)} → ` : ""}
                        {stateLabel(ev.toState)}
                      </Text>
                      <Text className="text-muted-foreground text-2xs">
                        {sourceLabel(ev.changedBySource)} · {relativeTime(ev.createdAt)}
                        {ev.notes ? ` · ${ev.notes}` : ""}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* The transition confirm gate an explicit second press before a step
            that the server may have inventory side effects for. Step-up (403)
            is transparent via the global host. */}
        {pending != null ? (
          <View className="gap-2 rounded-xl border border-border bg-card p-3">
            <Text className="text-sm font-semibold">{pending.actionLabel}?</Text>
            <Text className="text-muted-foreground text-xs leading-5">
              {pending.hint}
              {entersSoldCluster(pending.to)
                ? " Dieser Schritt reserviert den Bestand serverseitig und kann einen " +
                  "Konflikt mit dem Ladenbestand melden."
                : ""}
            </Text>
            <View className="flex-row gap-2 pt-1">
              <Button
                className="flex-1"
                onPress={() => void confirmTransition()}
                disabled={busy}
                accessibilityLabel={`${pending.actionLabel} bestätigen`}
              >
                <Text>{transitionM.isPending ? "Wird gespeichert…" : "Bestätigen"}</Text>
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => {
                  haptics.selection()
                  setPending(null)
                }}
                disabled={busy}
                accessibilityLabel="Abbrechen"
              >
                <Text>Abbrechen</Text>
              </Button>
            </View>
          </View>
        ) : (
          <Button
            variant="outline"
            size="xl"
            onPress={() => onOpenChange(false)}
            disabled={busy}
            accessibilityLabel="Schließen"
          >
            <Text>Schließen</Text>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Enroll search row — an AVAILABLE, not-yet-enrolled product
// ────────────────────────────────────────────────────────────────────────────

function EnrollRow({
  item,
  enrolling,
  onEnroll,
}: {
  item: ProductListRow
  enrolling: boolean
  onEnroll: () => void
}) {
  const t = useW14Theme()
  return (
    <PressableScale
      onPress={onEnroll}
      disabled={enrolling}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} als eBay-Entwurf einbuchen`}
      style={{ opacity: enrolling ? 0.55 : 1 }}
    >
 <View className="flex-row items-center gap-3 hairline-b px-3 py-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {item.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {item.sku}
            </Text>
            <Badge variant={STATUS_VARIANT[item.status]} dot>
              <Text>{STATUS_LABEL[item.status]}</Text>
            </Badge>
          </View>
        </View>
        <Text className="text-foreground font-mono-medium text-base" numberOfLines={1}>
          {formatEur(item.listPriceEur)}
        </Text>
        <View
          className="h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: t.colors.primary + "1f" }}
        >
          <PackagePlus size={t.icon.sm} color={t.colors.primary} />
        </View>
      </View>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────────────

export default function EbayScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  // ── Pipeline (enrolled listings + counts) ──────────────────────────────────
  const pipeline = useQuery(fetchPipeline, { key: "ebay:pipeline", staleTimeMs: 5_000 })
  const rc = useRefreshControl(pipeline)

  // ── Detail sheet ────────────────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null)
  const [openName, setOpenName] = useState("")

  const openListing = useCallback((l: EnrolledListing) => {
    haptics.selection()
    setOpenId(l.row.id)
    setOpenName(l.row.name)
  }, [])

  // ── Enroll search (AVAILABLE, not yet on eBay) ─────────────────────────────
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  // We search AVAILABLE stock not yet in the eBay pipeline; the server filters by
  // `enrolledOnEbay: false` (ebay_state IS NULL) so a row that is already
  // enrolled — at ENTWURF or any later stage — never appears here again. (The
  // legacy `listedOnEbay` flag would NOT exclude it: it stays false until a real
  // marketplace publish, so an already-enrolled item would keep showing up.)
  const search = useQuery(
    () =>
      listProducts({
        q: debouncedQ || undefined,
        status: "AVAILABLE",
        enrolledOnEbay: false,
        limit: SEARCH_LIMIT,
      }),
    { key: `ebay:enroll:${debouncedQ}` },
  )

  const [enrollingId, setEnrollingId] = useState<string | null>(null)
  const [enrollError, setEnrollError] = useState<string | null>(null)

  // Enroll = the first legal transition (NULL → ENTWURF). Step-up is transparent.
  const enroll = useCallback(
    async (item: ProductListRow) => {
      haptics.selection()
      setEnrollingId(item.id)
      setEnrollError(null)
      try {
        await transitionEbayState(item.id, { toState: "ENTWURF" })
        haptics.success()
        void pipeline.refetch()
        void search.refetch()
      } catch (e) {
        haptics.error()
        setEnrollError(describeError(e))
      } finally {
        setEnrollingId(null)
      }
    },
    [pipeline, search],
  )

  const listings = pipeline.data?.listings ?? []
  const counts = pipeline.data?.counts
  const hasListings = listings.length > 0

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* ── Pipeline-Übersicht ─────────────────────────────────────────────── */}
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <Store size={t.icon.lg} color={t.colors.primary} />
            {/* Screen title in the Bricolage Grotesque display voice (DESIGN-SYSTEM.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              eBay-Pipeline
            </Text>
          </View>

          {pipeline.status === "loading" && pipeline.data == null ? (
            <View className="flex-row flex-wrap gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="gap-2 px-3 py-3" style={{ width: "47.5%" }}>
                  <Skeleton width="50%" height={11} />
                  <Skeleton width="30%" height={24} />
                  <Skeleton width="80%" height={10} />
                </Card>
              ))}
            </View>
          ) : pipeline.error != null && pipeline.data == null ? (
            <InlineError message={pipeline.error} onRetry={() => void pipeline.refetch()} />
          ) : counts != null ? (
            <>
              <PhaseTiles counts={counts} />
              {pipeline.data?.partial ? (
                <Text className="text-muted-foreground text-2xs leading-4">
                  Für einzelne Listungen ließ sich der Zustand gerade nicht laden. Zum
                  Aktualisieren nach unten ziehen.
                </Text>
              ) : null}
            </>
          ) : null}
        </View>

        {/* ── Listungen ──────────────────────────────────────────────────────── */}
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <Tag size={t.icon.md} color={t.colors.primary} />
            <Text className="text-base font-semibold">Listungen</Text>
            {hasListings ? (
              <Badge variant="outline">
                <Text>{listings.length}</Text>
              </Badge>
            ) : null}
          </View>

          {pipeline.status === "loading" && pipeline.data == null ? (
            <View className="gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 3 }).map((_, i) => (
 <View key={i} className="flex-row items-center gap-3 hairline-b px-3 py-3">
                  <View className="flex-1 gap-2">
                    <Skeleton width="60%" height={14} />
                    <Skeleton width="35%" height={11} />
                  </View>
                  <Skeleton width={70} height={22} radius="button" />
                </View>
              ))}
            </View>
          ) : !hasListings && pipeline.data != null ? (
            <EmptyState
              icon={ShoppingBag}
              title="Noch keine eBay-Listung"
              description="Es ist noch kein Artikel in der eBay-Pipeline. Unten einen verfügbaren Artikel als Entwurf einbuchen."
            />
          ) : (
            <View className="gap-2.5">
              {listings.map((l, index) => (
                <StaggerItem key={l.row.id} index={Math.min(index, 8)} exit={false}>
                  <ListingRow listing={l} onPress={() => openListing(l)} />
                </StaggerItem>
              ))}
            </View>
          )}
        </View>

        {/* ── Artikel einbuchen ──────────────────────────────────────────────── */}
        <SectionCard
          title="Artikel einbuchen"
          subtitle="Verfügbaren Artikel als eBay-Entwurf in die Pipeline aufnehmen."
          icon={PackagePlus}
        >
          <View className="relative justify-center">
            <View className="absolute left-3 z-10">
              <Search size={t.icon.sm} color={t.colors.mutedForeground} />
            </View>
            <Input
              value={q}
              onChangeText={setQ}
              placeholder="Artikel suchen: SKU, Name, Barcode…"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              className="pl-9 pr-9"
              accessibilityLabel="Artikel zum Einbuchen suchen"
            />
            {q.length > 0 ? (
              <Pressable
                onPress={() => {
                  haptics.selection()
                  setQ("")
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Suche löschen"
                className="absolute right-2.5 z-10 h-6 w-6 items-center justify-center"
              >
                <X size={t.icon.sm} color={t.colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {enrollError != null ? (
            <InlineError message={enrollError} onDismiss={() => setEnrollError(null)} />
          ) : null}

          {search.status === "loading" && search.data == null ? (
            <View className="gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 3 }).map((_, i) => (
 <View key={i} className="flex-row items-center gap-3 hairline-b px-3 py-3">
                  <View className="flex-1 gap-2">
                    <Skeleton width="60%" height={14} />
                    <Skeleton width="35%" height={11} />
                  </View>
                  <Skeleton width={56} height={14} />
                  <Skeleton width={32} height={32} radius="button" />
                </View>
              ))}
            </View>
          ) : search.data != null && search.data.items.length === 0 ? (
            <EmptyState
              icon={Search}
              title={debouncedQ ? "Keine Treffer" : "Kein einbuchbarer Artikel"}
              description={
                debouncedQ
                  ? "Für diese Suche ist kein verfügbarer, noch nicht eingebuchter Artikel im Lager."
                  : "Sobald verfügbare, noch nicht gelistete Artikel im Lager sind, erscheinen sie hier."
              }
            />
          ) : search.data != null ? (
            <View className="gap-2.5">
              {search.data.items.map((item) => (
                <EnrollRow
                  key={item.id}
                  item={item}
                  enrolling={enrollingId === item.id}
                  onEnroll={() => void enroll(item)}
                />
              ))}
            </View>
          ) : search.error != null ? (
            <InlineError message={search.error} onRetry={() => void search.refetch()} />
          ) : null}
        </SectionCard>

        {/* A calm honest note on scope: inbound order sync is server-side and not
            part of this client surface. */}
        <Text className="text-muted-foreground text-2xs leading-4">
          Eingehende eBay-Bestellungen werden serverseitig abgeglichen und erscheinen im
          Verlauf der jeweiligen Listung. Diese Ansicht steuert den Listungs-Status.
        </Text>
      </ScrollView>

      <ListingDetailSheet
        productId={openId}
        productName={openName}
        open={openId != null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null)
        }}
        onChanged={() => void pipeline.refetch()}
      />
    </View>
  )
}
