/**
 * Auswertungen — die Owner-OS-Auswertungsfläche. Wo der Inhaber die Form des
 * Geschäfts liest: den Umsatz-Verlauf und das Handelsergebnis Tag für Tag, wie
 * Ankauf und Verkauf sich ausgleichen, wo der Bestand nach Kategorie liegt und
 * welcher Wert gerade im Lager steht.
 *
 * Form (DESIGN-SYSTEM.md §1, §9): keine Kästen in Kästen. Die Auswertung lebt
 * direkt auf dem warmen Papier — ein ruhiger Kopf mit dem bespoke Auswertungs-
 * Siegel, ein boxloser Zeitraum-Schalter, und jede Auswertung als nackter
 * Abschnitt, getrennt nur durch eine einzige warme Haarlinie. Tiefe kommt aus
 * dem geschichteten Papier und der Linie, nie aus gestapelten Karten. Gold ist
 * Faden, Kante und Siegel — nie Fläche.
 *
 * Ehrlichkeitsregel (DESIGN-SYSTEM.md §9, absolut). Jede Zahl führt zu einem
 * echten Endpunkt:
 *   • die Verläufe kommen aus ABGESCHLOSSENEN Tagesabschlüssen (closingsApi.list)
 *     — Netto-Verkauf und Netto-Ankauf je Geschäftstag, in echten Cent;
 *   • die Kategorie-Rangliste kommt aus der Anzahl im Kategorie-Baum;
 *   • der Lager-Stand kommt aus inventoryApi.value.
 * Wo ein Aggregat wirklich noch fehlt — ein Tages-Gewinn-Verlauf, ein Lagerwert-
 * Verlauf, eine Bestseller-Rangliste — zeigt die Fläche eine ruhige „bald"-Zeile,
 * die zugleich die Backend-Lücke benennt, statt eine erfundene Kurve zu zeichnen.
 * Ein fehlgeschlagener Read zeigt einen gesperrten oder Fehler-Zustand, nie eine
 * Null.
 *
 * Diese Fläche ist NUR-LESEND: sie bewegt kein Geld und löst keine fiskalische
 * Aktion aus — es gibt hier keine Step-up, nur eine ruhige Auswahl-Haptik beim
 * Zeitraum-Wechsel.
 */
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import type {
  CategoryTreeResponse,
  ClosingListItem,
  InventoryValueResponse,
} from "@warehouse14/api-client"
import Svg, { Circle, Path } from "react-native-svg"
import {
  ArrowLeftRight,
  Boxes,
  Clock,
  Layers,
  type LucideIcon,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Vault,
} from "lucide-react-native"

import { Text } from "@/components/ui/text"
import {
  categoryTree,
  formatCents,
  inventoryValue,
  listClosings,
} from "@/warehouse14/api"
import {
  ANALYTICS_PERIODS,
  type AnalyticsPeriod,
  ankaufTrend,
  articleCountLabel,
  type BaldTileCopy,
  BALD_INVENTORY_HISTORY,
  BALD_PROFIT_TREND,
  BALD_TOP_PRODUCTS,
  categoryRanking,
  categoryTotal,
  COPY,
  dayCountLabel,
  flowTotals,
  inventoryMargin,
  periodSpanLabel,
  revenueTrend,
  tradingResultTrend,
  verkaufShare,
} from "@/warehouse14/analytics"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  ErrorState,
  Hairline,
  haptics,
  InlineError,
  PaperGrain,
  PeriodSwitcher,
  RingGauge,
  Skeleton,
  StaggerItem,
  TopNList,
  TrendBars,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// ────────────────────────────────────────────────────────────────────────────
// LedgerMark — ein bespoke Auswertungs-Siegel (react-native-svg). Ein gestempel-
// ter Ring mit einer steigenden Verlaufslinie: die ruhige Marke der Auswertung.
// Der Ring bleibt Tinte, die Verlaufslinie tönt in Gilt — Gold nur als Faden im
// Siegel (DESIGN-SYSTEM.md §1).
// ────────────────────────────────────────────────────────────────────────────
function LedgerMark({
  size = 26,
  ink,
  gilt,
}: {
  size?: number
  ink: string
  gilt: string
}): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Gestempelter Ring — die Siegel-Tinte. */}
      <Circle cx={12} cy={12} r={8.4} stroke={ink} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={6.2} stroke={ink} strokeWidth={0.7} strokeOpacity={0.4} fill="none" />
      {/* Steigende Verlaufslinie — der Gilt-Faden im Siegel. */}
      <Path
        d="M8.4 14.2 L10.6 11.8 L12.4 13.2 L15.4 9.8"
        stroke={gilt}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Die Pfeilspitze am oberen Ende der Kurve. */}
      <Path
        d="M13.6 9.8 L15.4 9.8 L15.4 11.6"
        stroke={gilt}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Abschnitts-Kopf — ein boxloser Titel direkt auf dem Papier. Ein nacktes Tinte-
// Glyph, der Titel in der ruhigen Abschnitts-Stimme, ein leiser Unter-Satz und
// ein optionaler rechter Slot. Kein Kasten, kein Rahmen — die Hierarchie kommt
// aus Typo und Weißraum.
// ────────────────────────────────────────────────────────────────────────────
function SectionLabel({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  action?: ReactNode
}): ReactNode {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1 flex-row items-center gap-2.5">
        {/* Das Abschnitts-Glyph sitzt bare — kein getöntes Chip-Kästchen. */}
        <Icon size={t.icon.md} color={t.colors.foreground} />
        <View className="flex-1">
          <Text className="text-base font-semibold leading-tight" numberOfLines={1}>
            {title}
          </Text>
          {subtitle != null ? (
            <Text className="text-muted-foreground text-xs" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {action != null ? <View>{action}</View> : null}
    </View>
  )
}

// Ein nackter Abschnitt: der boxlose Kopf über seinem Inhalt, beides direkt auf
// dem Papier. Der Container fügt nur einen ruhigen Zwischenraum hinzu.
function Section({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <View className="gap-3.5">
      <SectionLabel icon={icon} title={title} subtitle={subtitle} action={action} />
      {children}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Ankauf vs Verkauf — eine boxlose Balance-Leiste + die Fenster-Summen. Die
// Verteilung als eine ruhige zweifarbige Leiste, darunter die echten Summen,
// und das Netto als eine von einer Haarlinie gekappte Zeile, ehrlich nach
// Vorzeichen gefärbt.
// ────────────────────────────────────────────────────────────────────────────
function FlowBlock({
  closings,
  period,
}: {
  closings: ClosingListItem[]
  period: AnalyticsPeriod
}) {
  const t = useW14Theme()
  const totals = useMemo(() => flowTotals(closings, period), [closings, period])
  const share = verkaufShare(totals)
  const empty = totals.dayCount === 0 || (totals.verkaufCents === 0 && totals.ankaufCents === 0)

  if (empty) {
    return <Text className="text-muted-foreground text-xs leading-5">{COPY.emptyTrendDescription}</Text>
  }

  return (
    <View className="gap-3.5">
      {/* Die Balance: Verkauf-Anteil gegen Ankauf-Anteil am Brutto-Fluss. */}
      <View
        className="h-3 w-full flex-row overflow-hidden rounded-full"
        style={{ backgroundColor: t.colors.border }}
        accessibilityLabel={`Verkauf ${Math.round(share * 100)} Prozent, Ankauf ${Math.round((1 - share) * 100)} Prozent`}
      >
        <View style={{ width: `${share * 100}%`, backgroundColor: t.colors.verdigris }} />
        <View style={{ flex: 1, backgroundColor: t.colors.primary }} />
      </View>

      <View className="flex-row items-start justify-between">
        <FlowLegendItem
          dotColor={t.colors.verdigris}
          label={COPY.verkaufLabel}
          value={formatCents(totals.verkaufCents)}
          sub={`${totals.verkaufCount} Verk.`}
          align="start"
        />
        <FlowLegendItem
          dotColor={t.colors.primary}
          label={COPY.ankaufLabel}
          value={formatCents(totals.ankaufCents)}
          sub={`${totals.ankaufCount} Ank.`}
          align="end"
        />
      </View>

      {/* Das Netto-Handelsergebnis des Fensters, von einer Haarlinie gekappt. */}
      <View className="gap-2.5">
        <Hairline />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-semibold">{COPY.netLabel}</Text>
          <Text
            className="font-mono-medium text-base"
            style={{ color: totals.netCents >= 0 ? t.colors.verdigris : t.colors.destructive }}
            numberOfLines={1}
          >
            {formatCents(totals.netCents)}
          </Text>
        </View>
        <Text className="text-muted-foreground text-2xs">{dayCountLabel(totals.dayCount)}</Text>
      </View>
    </View>
  )
}

function FlowLegendItem({
  dotColor,
  label,
  value,
  sub,
  align,
}: {
  dotColor: string
  label: string
  value: string
  sub: string
  align: "start" | "end"
}) {
  const t = useW14Theme()
  return (
    <View className={align === "end" ? "items-end" : "items-start"}>
      <View className="flex-row items-center gap-1.5">
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
        <Text className="text-muted-foreground text-xs font-medium">{label}</Text>
      </View>
      <Text className="font-mono-medium text-lg leading-tight" numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-muted-foreground text-2xs">{sub}</Text>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Lager-Stand — der Wert im Lager + seine stille Marge, boxlos. Der Listenwert
// als nacktes Hero-Zahl, der Anteil als Ring-Anzeige, der Einkaufswert als eine
// von einer Haarlinie gekappte Zeile.
// ────────────────────────────────────────────────────────────────────────────
function InventorySnapshotBlock({ inv }: { inv: InventoryValueResponse }) {
  const t = useW14Theme()
  const margin = useMemo(
    () => inventoryMargin(inv.listValueCents, inv.acquisitionValueCents, inv.availableCount),
    [inv],
  )
  return (
    <View className="gap-3.5">
      <View className="flex-row items-end justify-between">
        <View>
          <Text className="text-muted-foreground text-xs font-medium" style={{ letterSpacing: 0.4 }}>
            {COPY.listValueLabel}
          </Text>
          <CountUp
            value={margin.listValueCents}
            format={formatCents}
            className="font-mono-medium text-3xl leading-none"
            style={{ color: t.colors.foreground }}
            accessibilityLabel={`${COPY.listValueLabel} ${formatCents(margin.listValueCents)}`}
          />
        </View>
        <View className="items-end">
          <Text className="text-muted-foreground text-2xs">{COPY.availableLabel}</Text>
          <Text className="font-mono-medium text-base">{margin.availableCount}</Text>
        </View>
      </View>

      {/* Der Anteil am Regalpreis, der Marge ist — die Ring-Anzeige füllt ihn. */}
      <RingGauge
        value={margin.marginRatio}
        color={t.colors.verdigris}
        label={formatCents(margin.unrealisedMarginCents)}
        caption={`${COPY.marginLabel} · ${Math.round(margin.marginRatio * 100)} %`}
      />

      <View className="gap-2.5">
        <Hairline />
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm">{COPY.acquisitionLabel}</Text>
          <Text className="font-mono-medium text-sm" numberOfLines={1}>
            {formatCents(margin.acquisitionCostCents)}
          </Text>
        </View>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Ehrliche „bald"-Zeile — benennt ein wirklich fehlendes Aggregat samt der
// Backend-Lücke. Eine NACKTE Zeile auf dem Papier (kein gestrichelter Kasten):
// ein ruhiges Tinte-Glyph, der Titel mit einem leisen Gilt-gefädelten „bald"-
// Marker, eine ruhige Erklärung und die Lücken-Fußnote.
// ────────────────────────────────────────────────────────────────────────────
function BaldRow({ icon: Icon, copy }: { icon: LucideIcon; copy: BaldTileCopy }) {
  const t = useW14Theme()
  return (
    <View className="flex-row items-start gap-3 py-1" style={{ opacity: 0.92 }}>
      <View className="h-8 w-8 items-center justify-center" style={{ marginTop: 1 }}>
        <Icon size={t.icon.lg} color={t.colors.mutedForeground} />
      </View>
      <View className="flex-1 gap-1.5">
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-1 text-base font-semibold leading-tight"
            style={{ color: t.colors.inkAged }}
            numberOfLines={1}
          >
            {copy.title}
          </Text>
          {/* Der „bald"-Marker sitzt als Gilt-gefädelte Zeile, kein getönter Kasten. */}
          <View className="flex-row items-center gap-1.5">
            <View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }} />
            <Text
              className="text-2xs font-semibold"
              style={{ color: t.colors.mutedForeground, letterSpacing: 0.6 }}
            >
              bald
            </Text>
          </View>
        </View>
        <Text className="text-muted-foreground text-xs leading-5">{copy.description}</Text>
        {/* Die ausdrückliche Backend-Lücke — Ehrlichkeit sichtbar gemacht. */}
        <Text className="text-muted-foreground text-2xs leading-4" style={{ opacity: 0.85 }}>
          {copy.gap}
        </Text>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Erst-Lade-Skelett — die eigene Form der Fläche, nie ein zentrierter Spinner.
// Boxlos: der Zeitraum-Schalter, ein Abschnitts-Kopf, ein Säulen-Feld.
// ────────────────────────────────────────────────────────────────────────────
function AnalyticsSkeleton() {
  return (
    <View className="gap-6" accessibilityElementsHidden>
      <Skeleton width="100%" height={36} radius="button" />
      {Array.from({ length: 2 }).map((_, i) => (
        <View key={i} className="gap-3.5">
          {i > 0 ? <Hairline /> : null}
          <View className="flex-row items-center gap-2.5">
            <Skeleton width={18} height={18} radius="button" />
            <View className="flex-1 gap-1.5">
              <Skeleton width="48%" height={14} />
              <Skeleton width="64%" height={10} />
            </View>
          </View>
          <View className="flex-row items-end gap-2" style={{ height: 132 }}>
            {Array.from({ length: 7 }).map((__, j) => (
              <View key={j} className="flex-1 items-center justify-end">
                <Skeleton width="68%" height={40 + ((j * 13) % 70)} radius="button" />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Bildschirm
// ────────────────────────────────────────────────────────────────────────────
export default function AnalyticsScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const [period, setPeriod] = useState<AnalyticsPeriod>("week")

  // Ein Fan-out, drei unabhängige Quellen (Quellen-Ehrlichkeit): ein fehl-
  // geschlagener Kategorie-Read leert nie den Umsatz-Verlauf, und der Lager-Stand
  // beleuchtet seinen eigenen Abschnitt allein. Höfliches Polling hält die Ver-
  // läufe frisch, sobald anderswo ein Tag abgeschlossen wird.
  const q = useMultiQuery(
    {
      closings: listClosings,
      categories: categoryTree,
      inventory: inventoryValue,
    },
    { key: "analytics", pollIntervalMs: 60_000 },
  )

  const closingsData = q.results.closings.data as { items: ClosingListItem[] } | null
  const closings = closingsData?.items ?? []
  const categories = q.results.categories.data as CategoryTreeResponse | null
  const inventory = q.results.inventory.data as InventoryValueResponse | null

  // Abgeleitete Reihen für das aktive Fenster. Billige reine Maps, memoisiert auf
  // (closings, period), damit ein Poll mit identischen Daten nicht neu chartet.
  const revenue = useMemo(() => revenueTrend(closings, period), [closings, period])
  const trading = useMemo(() => tradingResultTrend(closings, period), [closings, period])
  const ankauf = useMemo(() => ankaufTrend(closings, period), [closings, period])
  const catRank = useMemo(() => categoryRanking(categories), [categories])
  const catTotal = useMemo(() => categoryTotal(catRank), [catRank])

  const rc = useRefreshControl(q)

  const onPeriodChange = useCallback((next: AnalyticsPeriod) => {
    haptics.selection()
    setPeriod(next)
  }, [])

  // Erst-Lauf ohne alles → geformtes Skelett. Jede Quelle ist mit nichts auf dem
  // Schirm gescheitert → der eine Fehler+Retry-Block. Sonst Inhalt, wobei jeder
  // Abschnitt seinen eigenen gesperrten/leeren Zustand trägt.
  const firstLoad = q.isLoading && !q.anyData
  const hardError = q.allFailed && !q.anyData

  const closingsLocked = q.results.closings.error != null && closings.length === 0
  const spanLabel = periodSpanLabel(period)

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung: Tiefe aus dem geschichteten Creme plus
          dieser feinen warmen Zahnung, nie eine flache Füllung (§1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: insets.contentBottom,
          gap: 24,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
      >
        {/* ── Kopf — Kicker + das bespoke Auswertungs-Siegel + Titel ──────────── */}
        <View className="gap-1.5">
          <View className="flex-row items-center gap-2">
            <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
            <Text
              className="text-muted-foreground text-2xs font-semibold"
              style={{ letterSpacing: 1.2 }}
            >
              AUSWERTUNG
            </Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <LedgerMark size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
            {/* Bricolage-Grotesque-Display-Stimme (DESIGN-SYSTEM.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              {COPY.screenTitle}
            </Text>
          </View>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            {COPY.screenSubtitle}
          </Text>
        </View>

        {/* Eine Hintergrund-Quelle ist gescheitert, während Daten noch stehen →
            eine ruhige, nicht blockierende Karte mit Retry. Leert nie das Brett. */}
        {!firstLoad && !hardError && q.results.closings.error != null && closings.length > 0 ? (
          <InlineError message={q.results.closings.error} onRetry={() => void q.refetch()} />
        ) : null}

        {firstLoad ? (
          <AnalyticsSkeleton />
        ) : hardError ? (
          <View className="pt-6">
            <ErrorState
              message={q.results.closings.error ?? q.results.inventory.error}
              onRetry={() => void q.refetch()}
              retrying={q.isFetching}
            />
          </View>
        ) : (
          <View className="gap-6">
            {/* Der Fenster-Schalter scopt jeden Verlauf darunter. */}
            <StaggerItem index={0} exit={false}>
              <PeriodSwitcher
                options={ANALYTICS_PERIODS}
                value={period}
                onChange={onPeriodChange}
                accessibilityLabel="Auswertungs-Zeitraum"
              />
            </StaggerItem>

            {/* Umsatz-Verlauf — Netto-Verkauf je abgeschlossenem Tag (echte Cent). */}
            <StaggerItem index={1} exit={false}>
              <Section icon={TrendingUp} title={COPY.revenueTitle} subtitle={spanLabel}>
                <TrendBars
                  data={revenue}
                  formatValue={formatCents}
                  tone="accent"
                  loading={q.isLoading && closings.length === 0}
                  locked={closingsLocked}
                  emptyTitle={COPY.emptyTrendTitle}
                  emptyDescription={COPY.emptyTrendDescription}
                />
              </Section>
            </StaggerItem>

            {/* Handelsergebnis — Verkauf minus Ankauf je Tag; wird ehrlich negativ. */}
            <StaggerItem index={2} exit={false}>
              <Hairline />
            </StaggerItem>
            <StaggerItem index={2} exit={false}>
              <Section icon={ArrowLeftRight} title={COPY.tradingTitle} subtitle={COPY.tradingSubtitle}>
                <TrendBars
                  data={trading}
                  formatValue={formatCents}
                  tone="primary"
                  loading={q.isLoading && closings.length === 0}
                  locked={closingsLocked}
                  emptyTitle={COPY.emptyTrendTitle}
                  emptyDescription={COPY.emptyTrendDescription}
                />
              </Section>
            </StaggerItem>

            {/* Ankauf und Verkauf — die Balance des Fensters + Summen. */}
            <StaggerItem index={3} exit={false}>
              <Hairline />
            </StaggerItem>
            <StaggerItem index={3} exit={false}>
              <Section icon={ArrowLeftRight} title={COPY.flowTitle} subtitle={COPY.flowSubtitle}>
                <FlowBlock closings={closings} period={period} />
              </Section>
            </StaggerItem>

            {/* Ankauf-Verlauf — Netto-Ankauf je abgeschlossenem Tag. */}
            <StaggerItem index={4} exit={false}>
              <Hairline />
            </StaggerItem>
            <StaggerItem index={4} exit={false}>
              <Section
                icon={ShoppingBag}
                title={COPY.ankaufTrendTitle}
                subtitle={COPY.ankaufTrendSubtitle}
              >
                <TrendBars
                  data={ankauf}
                  formatValue={formatCents}
                  tone="primary"
                  loading={q.isLoading && closings.length === 0}
                  locked={closingsLocked}
                  emptyTitle={COPY.emptyTrendTitle}
                  emptyDescription={COPY.emptyTrendDescription}
                />
              </Section>
            </StaggerItem>

            {/* Bestand nach Kategorie — Anzahl-Rangliste (ehrlich: nach Bestand). */}
            <StaggerItem index={5} exit={false}>
              <Hairline />
            </StaggerItem>
            <StaggerItem index={5} exit={false}>
              <Section
                icon={Layers}
                title={COPY.categoryTitle}
                subtitle={COPY.categorySubtitle}
                action={
                  catTotal > 0 ? (
                    <Text className="text-muted-foreground font-mono text-xs">
                      {articleCountLabel(catTotal)}
                    </Text>
                  ) : null
                }
              >
                <TopNList
                  data={catRank}
                  formatValue={(n) => `${n}`}
                  limit={6}
                  tone="primary"
                  loading={q.isLoading && categories == null}
                  locked={q.results.categories.error != null && categories == null}
                  emptyIcon={Boxes}
                  emptyTitle={COPY.emptyCategoryTitle}
                  emptyDescription={COPY.emptyCategoryDescription}
                />
              </Section>
            </StaggerItem>

            {/* Lagerwert heute — der Stand + seine stille Marge. */}
            <StaggerItem index={6} exit={false}>
              <Hairline />
            </StaggerItem>
            <StaggerItem index={6} exit={false}>
              <Section icon={Vault} title={COPY.inventoryTitle} subtitle={COPY.inventorySubtitle}>
                {inventory != null ? (
                  <InventorySnapshotBlock inv={inventory} />
                ) : (
                  <Text className="text-muted-foreground text-xs leading-5">
                    {q.results.inventory.error ?? "Der Lagerwert wird geladen."}
                  </Text>
                )}
              </Section>
            </StaggerItem>

            {/* Die ehrlichen Lücken — echter Gewinn-Verlauf, Wert-Verlauf, Top-Artikel.
                Eine ruhige Gruppe nackter Zeilen, getrennt durch eine eingerückte
                Haarlinie, jede mit ihrer Backend-Lücke. Kein gestapelter Kasten. */}
            <StaggerItem index={7} exit={false}>
              <Hairline />
            </StaggerItem>
            <StaggerItem index={7} exit={false}>
              <Section
                icon={Clock}
                title="Bald verfügbar"
                subtitle="Auswertungen, die ein noch fehlendes Aggregat brauchen, ehrlich benannt."
              >
                <View>
                  <BaldRow icon={ShoppingCart} copy={BALD_PROFIT_TREND} />
                  <Hairline inset={44} />
                  <BaldRow icon={Clock} copy={BALD_INVENTORY_HISTORY} />
                  <Hairline inset={44} />
                  <BaldRow icon={Boxes} copy={BALD_TOP_PRODUCTS} />
                </View>
              </Section>
            </StaggerItem>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
