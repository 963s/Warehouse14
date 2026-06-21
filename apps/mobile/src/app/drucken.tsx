/**
 * Drucken — the mobile print/label hub. The owner's honest answer to "kann ich
 * vom Handy aus drucken?" without shipping a heavy native printer dep.
 *
 * Two tiers, made explicit (see warehouse14/print/capabilities.ts):
 *
 *   1. TEILEN / PDF (available now). Pick a recent article, see a real price-tag
 *      label preview (or the Beleg preview), and share it: the document is
 *      rendered to a file and handed to the OS share sheet, from where the owner
 *      saves a PDF, AirPrints to any known printer, or sends it on. Real,
 *      shipping capability — every figure is a real value from a real endpoint.
 *
 *   2. THERMODRUCKER AM TRESEN (locked, honest). Direct ESC/POS or ZPL to a
 *      Bluetooth/LAN Bon- oder Etikettendrucker needs a native transport + a
 *      custom App-Build, which this version deliberately does not carry. We show
 *      a precise locked card pointing at the Desktop-Kasse — no fabricated
 *      capability, no fake "Drucken"-Knopf that silently does nothing.
 *
 * Built on the shared spine (theme tokens, SectionCard/ListRow, QueryBoundary,
 * the §6 motion + §7 haptic vocabulary, the print/ abstraction). German UI,
 * de-DE money via the shared helpers.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { View } from "react-native"
import type { ProductListRow } from "@warehouse14/api-client"
import {
  Check,
  Info,
  Monitor,
  Printer,
  Search,
  Share2,
  Tag,
} from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { listProducts } from "@/warehouse14/api"
import { CONDITION_LABEL, METAL_LABEL } from "@/warehouse14/product-ui"
import {
  escposRequirement,
  getPrintCapabilities,
  PrintPreview,
  sharePrintable,
  type LabelDoc,
  type Printable,
} from "@/warehouse14/print"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  haptics,
  InlineError,
  KeyboardAvoidingScreen,
  ListRow,
  QueryBoundary,
  SectionCard,
  useQuery,
} from "@/warehouse14/ui"

const DEBOUNCE_MS = 300
const SEARCH_LIMIT = 20

/**
 * The German note line for a label — metal + condition, mapped through the
 * shared label maps so a CUSTOMER-FACING tag never shows a raw machine code
 * ("gold · USED_EXCELLENT"). An unknown code degrades to its raw value rather
 * than being dropped, so no real attribute is ever silently lost.
 */
function noteFor(p: ProductListRow): string | null {
  const metal = p.metal ? (METAL_LABEL[p.metal] ?? p.metal) : null
  const condition = p.condition
    ? (CONDITION_LABEL[p.condition as keyof typeof CONDITION_LABEL] ?? p.condition)
    : null
  const parts = [metal, condition].filter((s): s is string => !!s)
  return parts.length ? parts.join(" · ") : null
}

/** Build the label doc for a product — every field a real `ProductListRow` column. */
function labelForProduct(p: ProductListRow): LabelDoc {
  const locationParts = [p.locationStorageUnit, p.locationDrawer, p.locationPosition].filter(
    (s): s is string => !!s,
  )
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    priceEur: p.listPriceEur,
    location: locationParts.length ? locationParts.join(" · ") : null,
    note: noteFor(p),
  }
}

export default function DruckenScreen() {
  const t = useW14Theme()
  const caps = useMemo(() => getPrintCapabilities(), [])

  // ── Selection + share state ────────────────────────────────────────────────
  const [selected, setSelected] = useState<ProductListRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  // ── Search (debounced, mirrors Verkauf/Lager) ──────────────────────────────
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

  const results = useQuery(
    () => listProducts({ q: debouncedQ || undefined, limit: SEARCH_LIMIT }),
    { key: `drucken:search:${debouncedQ}` },
  )

  const printable: Printable | null = selected
    ? { type: "labels", docs: [labelForProduct(selected)] }
    : null

  async function onShare(): Promise<void> {
    if (!printable) return
    setBusy(true)
    setShareError(null)
    haptics.selection()
    const res = await sharePrintable(printable, { dialogTitle: "Etikett teilen" })
    setBusy(false)
    if (res.status === "ok") haptics.success()
    else if (res.status === "unsupported") setShareError(res.reason)
    else if (res.status === "error") setShareError(res.message)
    // "dismissed" is a normal user choice — no error, no haptic.
  }

  return (
    <KeyboardAvoidingScreen
      contentPadding={t.space.x4}
      contentContainerStyle={{ gap: t.space.x4 }}
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Printer size={t.icon.lg} color={t.colors.primary} />
          {/* Bildschirmtitel in der antiken Cormorant-Display-Stimme (DESIGN §3). */}
          <Text className="text-2xl font-display-semibold leading-tight">Drucken</Text>
        </View>
        <Text className="text-muted-foreground text-sm">
          Etiketten und Belege als PDF teilen oder per AirPrint senden.
        </Text>
      </View>

      {/* What this surface can do, honestly framed. */}
      <SectionCard
        title="Etikett teilen"
        subtitle="Artikel wählen, Vorschau prüfen, als PDF teilen oder per AirPrint senden."
        icon={Tag}
      >
        <View className="flex-row items-center gap-2 rounded-lg border border-border bg-background px-3">
          <Search size={t.icon.md} color={t.colors.mutedForeground} />
          <Input
            className="h-11 flex-1 border-0 bg-transparent px-0"
            placeholder="Artikel suchen (Name, Art-Nr., Barcode)"
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Artikel für Etikett suchen"
          />
        </View>

        <QueryBoundary
          query={results}
          isEmpty={(d) => d.items.length === 0}
          empty={{
            icon: Search,
            title: debouncedQ ? "Kein Artikel gefunden" : "Artikel suchen",
            description: debouncedQ
              ? "Andere Bezeichnung, Art-Nr. oder Barcode versuchen."
              : "Tippe oben, um einen Artikel für ein Preisetikett zu finden.",
          }}
        >
          {(data) => (
            <View>
              {data.items.map((p) => {
                const isSel = selected?.id === p.id
                return (
                  <ListRow
                    key={p.id}
                    title={p.name}
                    subtitle={`Art-Nr. ${p.sku}`}
                    icon={Tag}
                    right={
                      isSel ? <Check size={t.icon.md} color={t.colors.verdigris} /> : undefined
                    }
                    onPress={() => {
                      haptics.selection()
                      setShareError(null)
                      setSelected(isSel ? null : p)
                    }}
                    hideChevron
                  />
                )
              })}
            </View>
          )}
        </QueryBoundary>
      </SectionCard>

      {/* Live preview + the share action — only once a real article is chosen. */}
      {printable ? (
        <SectionCard
          title="Vorschau"
          subtitle="Genau dieses Etikett wird geteilt — alle Werte sind echt."
          icon={Printer}
        >
          <PrintPreview printable={printable} />

          {shareError ? (
            <InlineError message={shareError} onDismiss={() => setShareError(null)} />
          ) : null}

          <Button
            size="xl"
            onPress={() => void onShare()}
            disabled={busy || !caps.canExportDocument}
            accessibilityLabel="Etikett teilen oder als PDF sichern"
          >
            <Share2 size={t.icon.sm} color={t.colors.primaryForeground} />
            <Text>{busy ? "Wird vorbereitet…" : "Teilen / als PDF"}</Text>
          </Button>

          {!caps.canExportDocument ? (
            <Text className="text-muted-foreground text-xs leading-5">
              Auf diesem Gerät ist das Teilen nicht verfügbar.
            </Text>
          ) : null}
        </SectionCard>
      ) : (
        <EmptyState
          icon={Tag}
          title="Kein Artikel gewählt"
          description="Wähle oben einen Artikel, um das Preisetikett als Vorschau zu sehen."
        />
      )}

      {/* The honest locked tier — direct thermal printing lives on the desktop. */}
      <DesktopPrinterCard />
    </KeyboardAvoidingScreen>
  )
}

/**
 * The honest "Drucker am Desktop" locked card. It does NOT pretend to drive a
 * Bon-/Etikettendrucker from the phone; it states precisely what such a path
 * needs and what the owner can do today instead. No fake action.
 */
function DesktopPrinterCard() {
  const t = useW14Theme()
  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-center gap-2.5">
        <View
          className="h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: t.colors.mutedForeground + "1f" }}
        >
          <Monitor size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold">Thermodrucker am Tresen</Text>
          <Text className="text-muted-foreground text-xs">{escposRequirement.summary}</Text>
        </View>
      </View>

      <View
        className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3"
        style={{ backgroundColor: t.colors.mutedForeground + "12" }}
      >
        <View className="pt-0.5">
          <Info size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
        <Text className="text-muted-foreground flex-1 text-xs leading-5">
          {escposRequirement.detail}
        </Text>
      </View>

      <View className="flex-row items-start gap-2.5">
        <View className="pt-0.5">
          <Printer size={t.icon.md} color={t.colors.primary} />
        </View>
        <Text className="text-muted-foreground flex-1 text-xs leading-5">
          {escposRequirement.alternative}
        </Text>
      </View>
    </Card>
  )
}
