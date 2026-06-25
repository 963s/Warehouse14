/**
 * Auswertungen — the Owner-OS Analytics surface.
 *
 * Where the owner reads the shape of the business: the Umsatz-Verlauf and the
 * Handelsergebnis day-over-day, how Ankauf and Verkauf balance, where the
 * inventory sits by category, and what value is in the vault right now. Built
 * entirely on the shared spine — the SVG-free chart kit (PeriodSwitcher /
 * TrendBars / TopNList), the data layer (useMultiQuery with per-source honesty,
 * refetch-on-focus + polite polling + pull-to-refresh), the motion system
 * (Stagger / CountUp), the components (SectionCard / RingGauge / EmptyState), and
 * the §7 haptic vocabulary — so it looks and behaves like every other surface.
 *
 * Honesty rule (DESIGN.md §4, absolute). Every number here traces to a real
 * endpoint:
 *   • the trends come from FINALIZED daily closings (closingsApi.list) — net
 *     Verkauf / Ankauf per businessDay, in real cents;
 *   • the category ranking comes from the category tree's productCount;
 *   • the inventory snapshot comes from inventoryApi.value.
 * Where an aggregate genuinely does NOT exist yet — a per-day PROFIT trend, an
 * inventory-value HISTORY, a per-product SALES ranking — the screen shows an
 * explicit „bald"-Karte that also names the backend gap, instead of charting a
 * fabricated curve. A failing read shows a locked / error state, never a zero.
 *
 * This surface is READ-ONLY: it moves no money and fires no fiscal action, so
 * there is no step-up here — just calm selection haptics on a period change.
 */
import { useCallback, useMemo, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import type {
  CategoryTreeResponse,
  ClosingListItem,
  InventoryValueResponse,
} from "@warehouse14/api-client"
import {
  ArrowLeftRight,
  Boxes,
  Clock,
  Coins,
  Layers,
  type LucideIcon,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Vault,
} from "lucide-react-native"

import { Card } from "@/components/ui/card"
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
  haptics,
  InlineError,
  PaperGrain,
  PeriodSwitcher,
  RingGauge,
  SectionCard,
  Skeleton,
  StaggerItem,
  TopNList,
  TrendBars,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── Honest "bald" tile — names a missing aggregate + the backend gap ─────────
function BaldTile({ icon: Icon, copy }: { icon: LucideIcon; copy: BaldTileCopy }) {
  const t = useW14Theme()
  return (
    <Card
      className="gap-2.5 px-4 py-4"
      style={{ borderWidth: 1, borderStyle: "dashed", borderColor: t.colors.border }}
    >
      <View className="flex-row items-center gap-2.5">
        <View
          className="h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: t.colors.mutedForeground + "14" }}
        >
          <Icon size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {copy.title}
          </Text>
          <View
            className="mt-0.5 self-start rounded-full px-2 py-0.5"
            style={{ backgroundColor: t.colors.mutedForeground + "14" }}
          >
            <Text
              className="text-2xs font-semibold"
              style={{ color: t.colors.mutedForeground, letterSpacing: 0.4 }}
            >
              bald
            </Text>
          </View>
        </View>
      </View>
      <Text className="text-muted-foreground text-xs">{copy.description}</Text>
      {/* The explicit backend-gap footnote honesty made visible. */}
      <Text className="text-muted-foreground text-2xs" style={{ opacity: 0.8 }}>
        {copy.gap}
      </Text>
    </Card>
  )
}

// ── Ankauf vs Verkauf — a single balance bar + the window totals ─────────────
function FlowCard({
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

  return (
    <SectionCard title={COPY.flowTitle} subtitle={COPY.flowSubtitle} icon={ArrowLeftRight}>
      {empty ? (
        <Text className="text-muted-foreground text-xs">{COPY.emptyTrendDescription}</Text>
      ) : (
        <View className="gap-3">
          {/* The balance: Verkauf share vs Ankauf share of the gross flow. */}
          <View
            className="h-3 w-full flex-row overflow-hidden rounded-full"
            style={{ backgroundColor: t.colors.border }}
            accessibilityLabel={`Verkauf ${Math.round(share * 100)} Prozent, Ankauf ${Math.round((1 - share) * 100)} Prozent`}
          >
            <View style={{ width: `${share * 100}%`, backgroundColor: t.colors.verdigris }} />
            <View style={{ flex: 1, backgroundColor: t.colors.primary }} />
          </View>

          <View className="flex-row items-center justify-between">
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

          {/* The net trading result of the window coloured by sign, honest. */}
          <View
            className="flex-row items-center justify-between border-t pt-3"
            style={{ borderTopColor: t.colors.border }}
          >
            <Text className="text-sm font-semibold">{COPY.netLabel}</Text>
            <Text
              className="font-mono-medium text-base"
              style={{
                color: totals.netCents >= 0 ? t.colors.verdigris : t.colors.destructive,
              }}
              numberOfLines={1}
            >
              {formatCents(totals.netCents)}
            </Text>
          </View>
          <Text className="text-muted-foreground text-2xs">{dayCountLabel(totals.dayCount)}</Text>
        </View>
      )}
    </SectionCard>
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
      <Text className="font-mono-medium text-base" numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-muted-foreground text-2xs">{sub}</Text>
    </View>
  )
}

// ── Inventory snapshot — the value in the vault + its unrealised margin ───────
function InventorySnapshotCard({ inv }: { inv: InventoryValueResponse }) {
  const t = useW14Theme()
  const margin = useMemo(
    () => inventoryMargin(inv.listValueCents, inv.acquisitionValueCents, inv.availableCount),
    [inv],
  )
  return (
    <SectionCard title={COPY.inventoryTitle} subtitle={COPY.inventorySubtitle} icon={Vault}>
      <View className="gap-3">
        <View className="flex-row items-end justify-between">
          <View>
            <Text
              className="text-muted-foreground text-xs font-medium"
              style={{ letterSpacing: 0.4 }}
            >
              {COPY.listValueLabel}
            </Text>
            <CountUp
              value={margin.listValueCents}
              format={formatCents}
              className="font-mono-medium text-2xl"
              style={{ color: t.colors.foreground }}
              accessibilityLabel={`${COPY.listValueLabel} ${formatCents(margin.listValueCents)}`}
            />
          </View>
          <View className="items-end">
            <Text className="text-muted-foreground text-2xs">{COPY.availableLabel}</Text>
            <Text className="font-mono-medium text-base">{margin.availableCount}</Text>
          </View>
        </View>

        {/* The share of the shelf price that is margin the gauge fills it. */}
        <RingGauge
          value={margin.marginRatio}
          color={t.colors.verdigris}
          label={formatCents(margin.unrealisedMarginCents)}
          caption={`${COPY.marginLabel} · ${Math.round(margin.marginRatio * 100)} %`}
        />

        <View
          className="flex-row items-center justify-between border-t pt-3"
          style={{ borderTopColor: t.colors.border }}
        >
          <Text className="text-muted-foreground text-sm">{COPY.acquisitionLabel}</Text>
          <Text className="font-mono-medium text-sm" numberOfLines={1}>
            {formatCents(margin.acquisitionCostCents)}
          </Text>
        </View>
      </View>
    </SectionCard>
  )
}

// ── First-load skeleton — the surface's own shape, never a center spinner ────
function AnalyticsSkeleton() {
  return (
    <View className="gap-5">
      <View className="h-9 w-full">
        <Skeleton width="100%" height={36} radius="button" />
      </View>
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} className="gap-3 px-4 py-4">
          <Skeleton width="56%" height={16} />
          <View className="flex-row items-end gap-2" style={{ height: 120 }}>
            {Array.from({ length: 7 }).map((__, j) => (
              <View key={j} className="flex-1 items-center justify-end">
                <Skeleton width="70%" height={40 + ((j * 13) % 70)} radius="button" />
              </View>
            ))}
          </View>
        </Card>
      ))}
    </View>
  )
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function AnalyticsScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const [period, setPeriod] = useState<AnalyticsPeriod>("week")

  // One fan-out, three independent sources (per-source honesty): a failing
  // category read never blanks the revenue trend, and the inventory snapshot
  // lights its own card alone. Polite polling keeps the trends fresh after a
  // day is finalized elsewhere.
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

  // Derived series for the active window. Cheap pure maps, memoised on
  // (closings, period) so a poll that returns identical data does not re-chart.
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

  // First load with nothing yet → shaped skeleton. Every source failed with
  // nothing on screen → the one error+retry block. Otherwise content, with each
  // card carrying its own locked/empty state.
  const firstLoad = q.isLoading && !q.anyData
  const hardError = q.allFailed && !q.anyData

  const closingsLocked = q.results.closings.error != null && closings.length === 0
  const spanLabel = periodSpanLabel(period)

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: t.space.x4,
          paddingHorizontal: t.space.x4,
          paddingBottom: insets.contentBottom,
          gap: t.space.x5,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
      >
        <View className="gap-1.5">
          <View className="flex-row items-center gap-2.5">
            <TrendingUp size={t.icon.lg} color={t.colors.primary} />
            {/* Screen title in the Bricolage Grotesque display voice (DESIGN-SYSTEM.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              {COPY.screenTitle}
            </Text>
          </View>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            {COPY.screenSubtitle}
          </Text>
        </View>

        {/* A background source failed while data is still on screen → one calm
            non-blocking card, with retry. Never blanks the board. */}
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
          <View className="gap-5">
            {/* The window switcher scopes every trend card below. */}
            <StaggerItem index={0} exit={false}>
              <PeriodSwitcher
                options={ANALYTICS_PERIODS}
                value={period}
                onChange={onPeriodChange}
                accessibilityLabel="Auswertungs-Zeitraum"
              />
            </StaggerItem>

            {/* Umsatz-Verlauf net Verkauf per finalized day (real cents). */}
            <StaggerItem index={1} exit={false}>
              <SectionCard
                title={COPY.revenueTitle}
                subtitle={spanLabel}
                icon={TrendingUp}
                action={<Coins size={t.icon.md} color={t.colors.verdigris} />}
              >
                <TrendBars
                  data={revenue}
                  formatValue={formatCents}
                  tone="accent"
                  loading={q.isLoading && closings.length === 0}
                  locked={closingsLocked}
                  emptyTitle={COPY.emptyTrendTitle}
                  emptyDescription={COPY.emptyTrendDescription}
                />
              </SectionCard>
            </StaggerItem>

            {/* Handelsergebnis Verkauf − Ankauf per day; goes negative honestly. */}
            <StaggerItem index={2} exit={false}>
              <SectionCard
                title={COPY.tradingTitle}
                subtitle={COPY.tradingSubtitle}
                icon={ArrowLeftRight}
              >
                <TrendBars
                  data={trading}
                  formatValue={formatCents}
                  tone="primary"
                  loading={q.isLoading && closings.length === 0}
                  locked={closingsLocked}
                  emptyTitle={COPY.emptyTrendTitle}
                  emptyDescription={COPY.emptyTrendDescription}
                />
              </SectionCard>
            </StaggerItem>

            {/* Ankauf vs Verkauf the window's balance + totals. */}
            <StaggerItem index={3} exit={false}>
              <FlowCard closings={closings} period={period} />
            </StaggerItem>

            {/* Ankauf-Verlauf net Ankauf per finalized day. */}
            <StaggerItem index={4} exit={false}>
              <SectionCard
                title={COPY.ankaufTrendTitle}
                subtitle={COPY.ankaufTrendSubtitle}
                icon={ShoppingBag}
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
              </SectionCard>
            </StaggerItem>

            {/* Bestand nach Kategorie productCount ranking (honest: by stock). */}
            <StaggerItem index={5} exit={false}>
              <SectionCard
                title={COPY.categoryTitle}
                subtitle={COPY.categorySubtitle}
                icon={Layers}
                action={
                  catTotal > 0 ? (
                    <Text className="text-muted-foreground text-xs">
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
              </SectionCard>
            </StaggerItem>

            {/* Lagerwert heute the snapshot + its unrealised margin. */}
            <StaggerItem index={6} exit={false}>
              {inventory != null ? (
                <InventorySnapshotCard inv={inventory} />
              ) : (
                <SectionCard title={COPY.inventoryTitle} subtitle={COPY.inventorySubtitle} icon={Vault}>
                  <Text className="text-muted-foreground text-xs">
                    {q.results.inventory.error ?? "Der Lagerwert wird geladen."}
                  </Text>
                </SectionCard>
              )}
            </StaggerItem>

            {/* The honest gaps real profit trend, value history, top products. */}
            <StaggerItem index={7} exit={false}>
              <BaldTile icon={ShoppingCart} copy={BALD_PROFIT_TREND} />
            </StaggerItem>
            <StaggerItem index={8} exit={false}>
              <BaldTile icon={Clock} copy={BALD_INVENTORY_HISTORY} />
            </StaggerItem>
            <StaggerItem index={9} exit={false}>
              <BaldTile icon={Boxes} copy={BALD_TOP_PRODUCTS} />
            </StaggerItem>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
