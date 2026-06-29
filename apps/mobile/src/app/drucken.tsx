/**
 * Drucken — die mobile Etiketten- und Beleg-Fläche. Die ehrliche Owner-Antwort
 * auf „kann ich vom Handy aus drucken?", ohne eine schwere native Drucker-
 * Abhängigkeit zu tragen.
 *
 * Zwei Stufen, klar getrennt (siehe warehouse14/print/capabilities.ts):
 *
 *   1. AIRPRINT / PDF (jetzt verfügbar). Einen Artikel wählen, die echte
 *      Preisetikett-Vorschau prüfen und an einen AirPrint- oder Netzwerkdrucker
 *      senden oder als PDF teilen: das Dokument wird zu einer Datei gerendert und
 *      an das Teilen-Blatt des Systems übergeben. Echte, ausgelieferte Fähigkeit
 *      jeder Wert stammt aus einem echten Endpunkt, nichts ist erfunden.
 *
 *   2. THERMODRUCKER AM TRESEN (ehrlich gesperrt). Direktes ESC/POS oder ZPL an
 *      einen Bon- oder Etikettendrucker braucht eine native Verbindung und einen
 *      eigenen App-Build, den diese Version bewusst nicht trägt. Statt eines
 *      vorgetäuschten Druck-Knopfs zeigen wir eine präzise gesperrte Zeile, die
 *      auf den Desktop-Kassenplatz verweist.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Die Fläche lebt direkt auf dem
 * warmen Papier — ein Kicker mit bespoke Etiketten-Siegel, eine boxlose Suchzeile
 * mit einem Gilt-Faden, die Treffer als nackte Zeilen, getrennt nur durch eine
 * einzige warme Haarlinie, und eine echte Etikett-Vorschau als physisches Schild
 * auf dem Papier statt einer gestapelten Karte. Tiefe kommt aus dem geschichteten
 * Papier und der Linie, nie aus gestapelten Karten. Deutsche UI, de-DE-Geld über
 * die geteilten Helfer.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { Money } from "@warehouse14/domain/money"
import type { ProductListRow } from "@warehouse14/api-client"
import Svg, { Path, Rect } from "react-native-svg"

import { code128Bars } from "@/warehouse14/print/code128"
import { Check, FileText, Monitor, Printer, Search, Tag } from "lucide-react-native"

import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { listProducts } from "@/warehouse14/api"
import { conditionLabel, METAL_LABEL } from "@/warehouse14/product-ui"
import {
  escposRequirement,
  getPrintCapabilities,
  printPrintable,
  sharePdfPrintable,
  type LabelDoc,
  type Printable,
} from "@/warehouse14/print"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  Hairline,
  haptics,
  InlineError,
  KeyboardAvoidingScreen,
  PressableScale,
  QueryBoundary,
  Skeleton,
  StaggerItem,
  useQuery,
} from "@/warehouse14/ui"

const DEBOUNCE_MS = 300
const SEARCH_LIMIT = 20

// ────────────────────────────────────────────────────────────────────────────
// LabelMark — ein bespoke Etiketten-Siegel (react-native-svg). Ein gestanztes
// Schild mit Aufhänge-Loch und einer Preislinie: die ruhige Marke der Drucken-
// Fläche. Der Faden (Preislinie + Lochrand) tönt in Gilt, der Schild-Umriss
// bleibt Tinte — Gold nur als Faden/Siegel (DESIGN-SYSTEM.md §1).
// ────────────────────────────────────────────────────────────────────────────

function LabelMark({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Der Schild-Umriss — die Etiketten-Tinte. */}
      <Path
        d="M4 5.4 L13.6 5.4 L20 11.8 L13.4 18.4 L4 18.4 Z"
        stroke={ink}
        strokeWidth={1.4}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Aufhänge-Loch — der Gilt-Ring im Siegel. */}
      <Path
        d="M8 9.4 m-1.5 0 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0"
        stroke={gilt}
        strokeWidth={1.2}
        fill="none"
      />
      {/* Preislinien — der ruhige Gilt-Faden auf dem Schild. */}
      <Path d="M12 11.4 L16.6 11.4 M12 13.8 L15 13.8" stroke={gilt} strokeWidth={1.1} strokeLinecap="round" />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Barcode — ein ECHTER, scannbarer Code-128-Strichcode des Barcodes/der SKU,
// gezeichnet aus derselben reinen Encoder-Quelle wie das gedruckte Etikett. Was
// der Owner in der Vorschau sieht, ist exakt das, was gedruckt + gescannt wird.
// ────────────────────────────────────────────────────────────────────────────

function BarcodeThread({ value, ink, width = 150 }: { value: string; ink: string; width?: number }): ReactNode {
  const { bars, width: total } = code128Bars(value)
  if (total === 0) return null
  const height = 26
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${total} ${height}`}
      preserveAspectRatio="none"
      fill="none"
      accessibilityElementsHidden
    >
      {bars.map((b, i) => (
        <Rect key={i} x={b.x} y={0} width={b.width} height={height} fill={ink} />
      ))}
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Etikett-Vorschau — die echte Vorschau als physisches Preisschild auf dem
// Papier (kein gestapelter Kasten). Jeder Wert stammt aus der echten `LabelDoc`,
// die der Drucken-Service gleich rendert — was der Owner sieht, wird gedruckt.
// ────────────────────────────────────────────────────────────────────────────

function LabelTagPreview({ doc }: { doc: LabelDoc }): ReactNode {
  const t = useW14Theme()
  const price = Money.of(doc.priceEur, "EUR").format()
  return (
    // Ein Schild, das auf dem Papier liegt: ein Hauch heller als der Grund
    // (parchment-2) mit einem Gilt-Faden an der oberen Kante — Gold nur als
    // Kante, nie als Fläche. Keine schwere Karte, kein Kasten im Kasten.
    <View
      className="overflow-hidden rounded-xl"
      style={{ backgroundColor: t.colors.card }}
    >
      {/* Der Gilt-Faden an der oberen Schild-Kante. */}
      <View style={{ height: 2, backgroundColor: t.colors.gilt }} />
      <View className="gap-2 px-4 py-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-0.5">
            <Text className="text-base font-semibold leading-tight" numberOfLines={2}>
              {doc.name}
            </Text>
            {doc.note != null ? (
              <Text
                className="text-2xs font-medium"
                style={{ color: t.colors.inkAged, letterSpacing: 0.2 }}
                numberOfLines={1}
              >
                {doc.note}
              </Text>
            ) : null}
          </View>
          {/* Der Preis trägt das Schild — Bricolage-frei, in der Mono-Stimme. */}
          <Text className="font-mono-medium text-2xl leading-none" style={{ color: t.colors.foreground }}>
            {price}
          </Text>
        </View>

        {/* Eine ruhige Haarlinie trennt Kopf und Codes — die einzige Linie. */}
        <Hairline />

        <View className="flex-row items-end justify-between gap-3">
          <View className="gap-1">
            <Text className="text-muted-foreground font-mono text-2xs">{`Art-Nr. ${doc.sku}`}</Text>
            {doc.location != null ? (
              <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
                {doc.location}
              </Text>
            ) : null}
          </View>
          {doc.barcode != null ? (
            <View className="items-end gap-0.5">
              <BarcodeThread value={doc.barcode} ink={t.colors.foreground} />
              <Text
                className="text-muted-foreground font-mono text-2xs"
                style={{ letterSpacing: 1.5 }}
              >
                {doc.barcode}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

/**
 * Die deutsche Notiz-Zeile für ein Etikett — Metall + Zustand, durch die
 * geteilten Label-Maps geführt, damit ein KUNDENSEITIGES Schild nie einen rohen
 * Maschinencode zeigt. Ein unbekannter Code fällt sauber auf seinen Rohwert
 * zurück, statt verloren zu gehen.
 */
function noteFor(p: ProductListRow): string | null {
  const metal = p.metal ? (METAL_LABEL[p.metal] ?? p.metal) : null
  const condition = p.condition ? conditionLabel(p.condition) : null
  const parts = [metal, condition].filter((s): s is string => !!s)
  return parts.length ? parts.join(" · ") : null
}

/** Baut das Etikett-Dokument für einen Artikel — jedes Feld eine echte `ProductListRow`-Spalte. */
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

// ────────────────────────────────────────────────────────────────────────────
// Eine Treffer-Zeile — eine NACKTE Zeile auf dem Papier (kein Kasten). Ein leiser
// Tag-Glyph, der Name, die Art-Nr., und rechts der Auswahl-Haken. Getrennt nur
// durch eine einzige warme Haarlinie zwischen den Zeilen.
// ────────────────────────────────────────────────────────────────────────────

function ResultRow({
  product,
  selected,
  onPress,
}: {
  product: ProductListRow
  selected: boolean
  onPress: () => void
}): ReactNode {
  const t = useW14Theme()
  const price = Money.of(product.listPriceEur, "EUR").format()
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${product.name}, Artikelnummer ${product.sku}${
        selected ? ", gewählt" : ""
      }`}
    >
      <View className="flex-row items-center gap-3 py-3.5">
        {/* Das Tag-Glyph sitzt bare — kein getöntes Chip-Kästchen. */}
        <View className="h-9 w-9 items-center justify-center">
          <Tag size={t.icon.lg} color={selected ? t.colors.foreground : t.colors.mutedForeground} />
        </View>

        <View className="flex-1 gap-0.5">
          <Text className="text-base font-semibold leading-tight" numberOfLines={1}>
            {product.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-muted-foreground font-mono text-2xs">{`Art-Nr. ${product.sku}`}</Text>
            <Text className="text-muted-foreground text-2xs">·</Text>
            <Text className="text-muted-foreground font-mono text-2xs">{price}</Text>
          </View>
        </View>

        {/* Der Auswahl-Haken in der Patina-Tinte (verdigris = bestätigt/aktiv). */}
        {selected ? (
          <View className="h-7 w-7 items-center justify-center">
            <Check size={t.icon.md} color={t.colors.verdigris} />
          </View>
        ) : null}
      </View>
    </PressableScale>
  )
}

export default function DruckenScreen() {
  const t = useW14Theme()
  const caps = useMemo(() => getPrintCapabilities(), [])

  // ── Auswahl + Druck-/Teilen-Status ──────────────────────────────────────────
  const [selected, setSelected] = useState<ProductListRow | null>(null)
  // Welche Aktion läuft, damit jeder Knopf sein eigenes „wird vorbereitet" zeigt.
  const [busy, setBusy] = useState<null | "print" | "pdf">(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // ── Suche (entprellt, wie Verkauf/Lager) ────────────────────────────────────
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

  // Ein-Tipp-Druck — öffnet den OS-Druckdialog (AirPrint / Android-Druck).
  async function onPrint(): Promise<void> {
    if (!printable || busy) return
    setBusy("print")
    setActionError(null)
    haptics.selection()
    const res = await printPrintable(printable)
    setBusy(null)
    if (res.status === "ok") haptics.success()
    else if (res.status === "unsupported") setActionError(res.reason)
    else if (res.status === "error") setActionError(res.message)
    // „dismissed" ist eine normale Nutzerwahl — kein Fehler, keine Haptik.
  }

  // Sekundär — ein echtes PDF rendern und an das Teilen-Blatt übergeben.
  async function onSharePdf(): Promise<void> {
    if (!printable || busy) return
    setBusy("pdf")
    setActionError(null)
    haptics.selection()
    const res = await sharePdfPrintable(printable, { dialogTitle: "Etikett als PDF teilen" })
    setBusy(null)
    if (res.status === "ok") haptics.success()
    else if (res.status === "unsupported") setActionError(res.reason)
    else if (res.status === "error") setActionError(res.message)
  }

  const searchFocused = q.length > 0

  return (
    <KeyboardAvoidingScreen
      contentPadding={t.space.x2}
      contentContainerStyle={{ gap: t.space.x3, paddingTop: t.space.x1_5 }}
    >
      {/* ── Kopf: Kicker + bespoke Etiketten-Siegel + Bricolage-Display-Titel ── */}
      <View className="gap-1.5">
        <View className="flex-row items-center gap-2">
          <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
          <Text className="text-muted-foreground text-2xs font-semibold" style={{ letterSpacing: 1.2 }}>
            ETIKETTEN & BELEGE
          </Text>
        </View>
        <View className="flex-row items-center gap-2.5">
          <LabelMark size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
          <Text className="text-2xl font-display-semibold leading-tight">Drucken</Text>
        </View>
        <Text className="text-muted-foreground text-sm leading-5">
          Preisetiketten an einen AirPrint- oder Netzwerkdrucker senden oder als PDF teilen.
        </Text>
      </View>

      {/* ── Suche: eine boxlose Zeile mit Gilt-Faden, kein gerahmtes Feld ────── */}
      <View className="gap-2">
        <View className="flex-row items-center gap-2.5">
          <Search size={t.icon.md} color={t.colors.mutedForeground} />
          <Input
            className="h-11 flex-1 border-0 bg-transparent px-0 text-base"
            placeholder="Artikel suchen (Name, Art-Nr., Barcode)"
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Artikel für Etikett suchen"
          />
        </View>
        {/* Der Faden unter der Suchzeile gildet, sobald getippt wird — Gold als Kante. */}
        <View
          style={{
            height: 1.5,
            borderRadius: 1,
            backgroundColor: searchFocused ? t.colors.gilt : t.colors.border,
          }}
        />
      </View>

      {/* ── Treffer-Zeilen ────────────────────────────────────────────────────── */}
      <QueryBoundary
        query={results}
        loading={
          <View accessibilityElementsHidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i}>
                {i > 0 ? <Hairline inset={48} /> : null}
                <View className="flex-row items-center gap-3 py-3.5">
                  <Skeleton width={36} height={36} radius="card" />
                  <View className="flex-1 gap-2">
                    <Skeleton width="62%" height={14} />
                    <Skeleton width="38%" height={10} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        }
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
            {data.items.map((p, index) => {
              const isSel = selected?.id === p.id
              return (
                <StaggerItem key={p.id} index={Math.min(index, 8)} exit={false}>
                  {index > 0 ? <Hairline inset={48} /> : null}
                  <ResultRow
                    product={p}
                    selected={isSel}
                    onPress={() => {
                      haptics.selection()
                      setActionError(null)
                      setSelected(isSel ? null : p)
                    }}
                  />
                </StaggerItem>
              )
            })}
          </View>
        )}
      </QueryBoundary>

      {/* ── Vorschau + Aktionen: erst wenn ein echter Artikel gewählt ist ─────── */}
      {printable && selected ? (
        <View className="gap-3">
          <Hairline />
          <View className="flex-row items-center gap-2">
            <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
            <Text className="text-muted-foreground text-2xs font-semibold" style={{ letterSpacing: 1.2 }}>
              VORSCHAU
            </Text>
          </View>
          <Text className="text-muted-foreground text-xs leading-5">
            Genau dieses Etikett wird gedruckt. Alle Werte sind echt.
          </Text>

          <LabelTagPreview doc={labelForProduct(selected)} />

          {actionError != null ? (
            <InlineError message={actionError} onDismiss={() => setActionError(null)} />
          ) : null}

          {/* PRIMÄR — Ein-Tipp-Druck über den OS-Druckdialog (AirPrint / Android). */}
          {caps.canPrintNative ? (
            <Pressable
              onPress={() => void onPrint()}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="Etikett drucken"
              accessibilityState={{ disabled: busy !== null, busy: busy === "print" }}
              className="flex-row items-center justify-center gap-2 rounded-md"
              style={{
                minHeight: t.touch.comfortable,
                backgroundColor: t.colors.primary,
                opacity: busy !== null ? 0.5 : 1,
              }}
            >
              <Printer size={t.icon.sm} color={t.colors.primaryForeground} />
              <Text className="text-base font-semibold" style={{ color: t.colors.primaryForeground }}>
                {busy === "print" ? "Wird vorbereitet…" : "Etikett drucken"}
              </Text>
            </Pressable>
          ) : null}

          {/* SEKUNDÄR — ein PDF rendern und teilen (Dateien, Mail, …). */}
          {caps.canSharePdf ? (
            <Pressable
              onPress={() => void onSharePdf()}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="Etikett als PDF teilen"
              accessibilityState={{ disabled: busy !== null, busy: busy === "pdf" }}
              className="flex-row items-center justify-center gap-2 rounded-md border"
              style={{
                minHeight: t.touch.comfortable,
                borderColor: t.colors.border,
                backgroundColor: t.colors.background,
                opacity: busy !== null ? 0.5 : 1,
              }}
            >
              <FileText size={t.icon.sm} color={t.colors.foreground} />
              <Text className="text-base font-semibold" style={{ color: t.colors.foreground }}>
                {busy === "pdf" ? "Wird vorbereitet…" : "Als PDF teilen"}
              </Text>
            </Pressable>
          ) : null}

          {/* Ehrlich, wenn das Gerät weder drucken noch teilen kann. */}
          {!caps.canExportDocument ? (
            <View className="flex-row items-start gap-2">
              <View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt, marginTop: 6 }} />
              <Text className="text-muted-foreground flex-1 text-xs leading-5">
                Auf diesem Gerät ist das Drucken und Teilen nicht verfügbar. Der Druck läuft über den
                Desktop-Kassenplatz.
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <EmptyState
          icon={Tag}
          title="Kein Artikel gewählt"
          description="Wähle oben einen Artikel, um sein Preisetikett als Vorschau zu sehen."
        />
      )}

      {/* ── Die ehrlich gesperrte Stufe: direktes Thermo-Drucken am Desktop ──── */}
      <DesktopPrinterStrip />
    </KeyboardAvoidingScreen>
  )
}

/**
 * Die ehrlich gesperrte „Drucker am Tresen"-Zeile. Sie täuscht KEINEN Druck vom
 * Telefon an einen Bon-/Etikettendrucker vor; sie nennt präzise, was so ein Pfad
 * braucht und was der Owner heute stattdessen tun kann. Boxlos auf dem Papier,
 * getrennt nur durch eine warme Haarlinie — keine Kästen in Kästen, keine Aktion.
 */
function DesktopPrinterStrip(): ReactNode {
  const t = useW14Theme()
  return (
    <View className="gap-3">
      <Hairline />
      <View className="flex-row items-start gap-3">
        {/* Das Monitor-Glyph sitzt bare — kein getöntes Chip-Kästchen. */}
        <View className="h-9 w-9 items-center justify-center" style={{ marginTop: 1 }}>
          <Monitor size={t.icon.lg} color={t.colors.mutedForeground} />
        </View>
        <View className="flex-1 gap-2">
          <View className="gap-0.5">
            <Text className="text-base font-semibold leading-tight">Thermodrucker am Tresen</Text>
            <Text className="text-muted-foreground text-xs leading-5">{escposRequirement.summary}</Text>
          </View>

          {/* Der technische Grund — eine leise Zeile, kein getönter Kasten. */}
          <Text className="text-muted-foreground text-xs leading-5">{escposRequirement.detail}</Text>

          {/* Was heute geht — als Gilt-gefädelte Zeile, kein Kasten. */}
          <View className="mt-0.5 flex-row items-start gap-2">
            <View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt, marginTop: 6 }} />
            <Text className="text-muted-foreground flex-1 text-xs leading-5">
              {escposRequirement.alternative}
            </Text>
          </View>
        </View>
      </View>
    </View>
  )
}
