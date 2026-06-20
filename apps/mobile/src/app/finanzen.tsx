/**
 * Finanzen — the P&L drill-down (Gewinn- und Verlustrechnung) for the Owner OS.
 *
 * The Schatzkammer dashboard shows the headline net-profit gauge; THIS surface is
 * where the owner opens it up and sees how that number is built — the full
 * waterfall for the chosen period (Tag / Monat):
 *
 *   Umsatz (VERKAUF, brutto)
 *     − Ankauf (ANKAUF, brutto)
 *     − Ausgaben (einmalige Betriebsausgaben)
 *     − Fixkosten-Anteil (anteilige laufende Fixkosten)
 *     = Nettogewinn
 *
 * Every line is a REAL value from `financeApi.profit({ period })`
 * (grossRevenueCents · grossAnkaufCents · expensesCents ·
 * fixedCostsAllocatedCents · netProfitCents) — money in integer CENTS, formatted
 * through `formatCents`. Nothing is fabricated: when the period's read has not
 * resolved the surface shows the shaped skeleton or the error+retry state, never
 * a placeholder amount (DESIGN.md §4 — the honesty rule).
 *
 * The MONTH view adds the break-even framing the dashboard hints at: the month's
 * cumulative net profit measured against the active monthly Fixkosten (the
 * break-even line) and the owner's editable Monatsgewinn-Ziel (the chest). It
 * reuses the pure `computeTreasureMap` math and the gamification celebration —
 * crossing into the black arms <GoldFlood> exactly once, paired with the single
 * Heavy haptic (the one place §7 allows it). A row links straight to /ausgaben
 * so the owner can act on the two costs the waterfall just attributed.
 *
 * Built entirely on the shared spine: one `useMultiQuery` fans out the day +
 * month profit reads and the fixed-cost list with per-source honesty, refetch-on-
 * focus + polite polling + pull-to-refresh come free; motion (CountUp, Stagger,
 * RingGauge, GoldFlood), components (SectionCard/StatTile/ListRow), and §7 haptics
 * (selection on a period switch / a navigate). Tokens only; de-DE money; German UI.
 */
import { useCallback, useMemo, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import type { FixedCostRow, ProfitResponse } from "@warehouse14/api-client"
import {
  ArrowDownRight,
  Coins,
  Equal,
  type LucideIcon,
  MapPin,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import {
  financeProfit,
  formatCents,
  listFixedCosts,
} from "@/warehouse14/api"
import { useBreakEvenCelebration } from "@/warehouse14/game"
import { useDashboardTargets } from "@/warehouse14/preferences"
import {
  computeTreasureMap,
  monthlyFixedCostCents,
  monthStartDay,
} from "@/warehouse14/schatzkammer"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  ErrorState,
  GoldFlood,
  haptics,
  InlineError,
  ListRow,
  PressableScale,
  RingGauge,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

type Period = "day" | "month"

// ── Period labels (de-DE, no fabrication — derived from the device clock) ──────
function dayLabel(now: Date): string {
  return now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
}
function monthLabel(now: Date): string {
  return now.toLocaleDateString("de-DE", { month: "long", year: "numeric" })
}

// ── Segmented control (Tag / Monat) — the spine's sliding-pill pattern ─────────
function PeriodSegmented({
  value,
  onChange,
}: {
  value: Period
  onChange: (next: Period) => void
}) {
  const t = useW14Theme()
  const options: readonly { key: Period; label: string }[] = [
    { key: "day", label: "Tag" },
    { key: "month", label: "Monat" },
  ]
  return (
    <View
      className="flex-row rounded-md border p-1"
      style={{ backgroundColor: t.colors.background, borderColor: t.colors.border }}
      accessibilityRole="tablist"
    >
      {options.map((opt) => {
        const active = value === opt.key
        return (
          <PressableScale
            key={opt.key}
            className="flex-1"
            onPress={() => {
              if (active) return
              haptics.selection()
              onChange(opt.key)
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <View
              className="items-center justify-center rounded-md py-2"
              style={{
                backgroundColor: active ? t.colors.card : "transparent",
                borderWidth: active ? 1 : 0,
                borderColor: t.colors.border,
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: active ? t.colors.foreground : t.colors.mutedForeground }}
              >
                {opt.label}
              </Text>
            </View>
          </PressableScale>
        )
      })}
    </View>
  )
}

// ── Net-profit hero — the single big number the waterfall resolves to ──────────
function NetProfitHero({ profit, periodLabel }: { profit: ProfitResponse; periodLabel: string }) {
  const t = useW14Theme()
  const positive = profit.netProfitCents >= 0
  const color = positive ? t.colors.verdigris : t.colors.destructive
  return (
    <Card className="gap-1.5 px-4 py-4">
      <Text
        className="text-muted-foreground text-xs font-medium uppercase"
        style={{ letterSpacing: 0.4 }}
        numberOfLines={1}
      >
        Nettogewinn
      </Text>
      <CountUp
        value={profit.netProfitCents}
        format={formatCents}
        className="font-mono-medium text-2xl"
        style={{ color }}
        accessibilityLabel={`Nettogewinn ${formatCents(profit.netProfitCents)}`}
      />
      <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
        {positive ? "im Plus · " : "im Minus · "}
        {periodLabel}
      </Text>
    </Card>
  )
}

// ── One waterfall line ─────────────────────────────────────────────────────────
type LineTone = "add" | "subtract" | "result"

function WaterfallLine({
  icon: Icon,
  label,
  cents,
  tone,
}: {
  icon: LucideIcon
  label: string
  cents: number
  tone: LineTone
}) {
  const t = useW14Theme()
  // The sign that prefixes the amount: revenue adds, costs subtract, the result
  // shows its own sign through colour. Costs are shown as a positive magnitude
  // with a leading „−" so the column reads as a subtraction, never a double sign.
  const prefix = tone === "add" ? "+ " : tone === "subtract" ? "− " : ""
  const magnitude = tone === "subtract" ? Math.abs(cents) : cents
  const isResult = tone === "result"
  // Only the result line is coloured by sign (verdigris in the black, wax-red in
  // the red); the contributing lines stay neutral foreground so the column reads
  // as one calm ledger, with the +/− prefix carrying the direction.
  const amountColor = isResult
    ? cents >= 0
      ? t.colors.verdigris
      : t.colors.destructive
    : t.colors.foreground
  const iconTint = tone === "subtract" ? t.colors.mutedForeground : t.colors.primary

  return (
    <View
      className="min-h-[44px] flex-row items-center gap-3 py-1"
      style={
        isResult
          ? { borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.space.x3 }
          : undefined
      }
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-md"
        style={{ backgroundColor: iconTint + "1f" }}
      >
        <Icon size={t.icon.md} color={iconTint} />
      </View>
      <Text
        className={isResult ? "flex-1 text-base font-semibold" : "flex-1 text-base font-medium"}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        className={isResult ? "font-mono-medium text-base" : "font-mono-medium text-sm"}
        style={{ color: amountColor }}
        numberOfLines={1}
      >
        {prefix}
        {formatCents(magnitude)}
      </Text>
    </View>
  )
}

// ── The P&L waterfall card ──────────────────────────────────────────────────────
function ProfitWaterfall({
  profit,
  onOpenExpenses,
}: {
  profit: ProfitResponse
  onOpenExpenses: () => void
}) {
  return (
    <SectionCard
      title="Gewinn- und Verlustrechnung"
      subtitle="So entsteht der Nettogewinn — Umsatz minus aller Kosten."
      icon={TrendingUp}
    >
      <WaterfallLine icon={Coins} label="Umsatz" cents={profit.grossRevenueCents} tone="add" />
      <WaterfallLine
        icon={ShoppingCart}
        label="Ankauf"
        cents={profit.grossAnkaufCents}
        tone="subtract"
      />
      <WaterfallLine
        icon={Receipt}
        label="Ausgaben"
        cents={profit.expensesCents}
        tone="subtract"
      />
      <WaterfallLine
        icon={Wallet}
        label="Fixkosten-Anteil"
        cents={profit.fixedCostsAllocatedCents}
        tone="subtract"
      />
      <WaterfallLine
        icon={Equal}
        label="Nettogewinn"
        cents={profit.netProfitCents}
        tone="result"
      />
      <View style={{ marginTop: 4 }}>
        <ListRow
          icon={ArrowDownRight}
          title="Ausgaben verwalten"
          subtitle="Einzelkosten und Fixkosten bearbeiten."
          onPress={onOpenExpenses}
        />
      </View>
    </SectionCard>
  )
}

// ── Break-even card (Monat) — cumulative profit vs the month's fixed costs ─────
function BreakEvenCard({
  netProfitCents,
  fixedCostCents,
  targetCents,
  onManageFixedCosts,
}: {
  netProfitCents: number
  fixedCostCents: number
  targetCents: number
  onManageFixedCosts: () => void
}) {
  const t = useW14Theme()
  const map = useMemo(
    () => computeTreasureMap(netProfitCents, fixedCostCents, targetCents),
    [netProfitCents, fixedCostCents, targetCents],
  )

  return (
    <SectionCard
      title="Break-even des Monats"
      subtitle="Erst die Fixkosten decken, dann Gewinn heben."
      icon={MapPin}
      action={
        map.brokeEven ? (
          <View
            className="rounded-md px-2.5 py-1"
            style={{ borderWidth: 1, borderColor: t.colors.verdigris }}
          >
            <Text className="text-xs font-semibold" style={{ color: t.colors.verdigris }}>
              Erreicht
            </Text>
          </View>
        ) : null
      }
    >
      <View className="gap-1">
        <View className="flex-row items-end justify-between">
          <CountUp
            value={map.netProfitCents}
            format={formatCents}
            className="font-mono-medium text-2xl"
            style={{ color: map.brokeEven ? t.colors.verdigris : t.colors.foreground }}
            accessibilityLabel={`Monatsgewinn ${formatCents(map.netProfitCents)}`}
          />
          <Text className="text-muted-foreground text-xs">Ziel {formatCents(targetCents)}</Text>
        </View>

        {/* Progress toward the profit target, with the break-even flag. */}
        <View className="relative w-full py-1.5">
          <RingGauge
            value={map.targetProgress}
            color={map.brokeEven ? t.colors.verdigris : t.colors.primary}
          />
          {map.breakEvenMarker !== null ? (
            <View
              className="absolute"
              style={{
                left: `${Math.round(map.breakEvenMarker * 100)}%`,
                top: 6,
                bottom: 6,
                width: 2,
                backgroundColor: t.colors.foreground,
              }}
            />
          ) : null}
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
            Fixkosten {formatCents(map.fixedCostCents)} (Break-even)
          </Text>
          <Text
            className="text-xs font-semibold"
            style={{ color: map.brokeEven ? t.colors.verdigris : t.colors.primary }}
            numberOfLines={1}
          >
            {map.brokeEven ? "Kosten gedeckt" : `noch ${formatCents(map.toBreakEvenCents)}`}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 4 }}>
        <ListRow
          icon={Wallet}
          title="Fixkosten verwalten"
          subtitle="Die laufenden Kosten hinter der Break-even-Linie."
          onPress={onManageFixedCosts}
        />
      </View>
    </SectionCard>
  )
}

// ── First-load skeleton — the surface's own shape, never a mid-screen spinner ──
function FinanzenSkeleton() {
  return (
    <View className="gap-5">
      <Card className="gap-2 px-4 py-4">
        <Skeleton width="40%" height={12} />
        <Skeleton width="56%" height={26} />
        <Skeleton width="48%" height={11} />
      </Card>
      <Card className="gap-3 px-4 py-4">
        <Skeleton width="62%" height={16} />
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={i} className="flex-row items-center gap-3 py-1">
            <Skeleton width={32} height={32} radius="button" />
            <Skeleton width="40%" height={15} />
            <View className="flex-1" />
            <Skeleton width={84} height={15} />
          </View>
        ))}
      </Card>
    </View>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────────────
export default function FinanzenScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const insets = useScreenInsets()
  const targets = useDashboardTargets()

  const [period, setPeriod] = useState<Period>("day")

  // One fan-out powers both period views + the break-even card, each settled
  // independently (per-source honesty): a failing fixed-cost read never blanks
  // the day waterfall, and the month profit read lights its own card alone.
  const q = useMultiQuery(
    {
      profitDay: () => financeProfit("day"),
      profitMonth: () => financeProfit("month"),
      fixed: () => listFixedCosts({ limit: 200 }),
    },
    { key: "finanzen", pollIntervalMs: 60_000 },
  )

  const profitDay = q.results.profitDay.data as ProfitResponse | null
  const profitMonth = q.results.profitMonth.data as ProfitResponse | null
  const fixedRows = q.results.fixed.data
    ? (q.results.fixed.data as { items: FixedCostRow[] }).items
    : null

  const now = useMemo(() => new Date(), [])
  const monthStart = monthStartDay(now)
  const fixedCostCents = fixedRows ? monthlyFixedCostCents(fixedRows, monthStart) : 0
  const targetCents = Math.round(targets.monthlyProfitTargetEur * 100)

  // Break-even celebration — fire the gold flood once on the real false→true
  // crossing of the MONTH's cumulative profit over its fixed costs. Held inert
  // until the month profit + fixed costs have both settled, so a transient
  // first-load `false` is never mistaken for a "before" state (honesty).
  const breakEvenReady = profitMonth !== null && fixedRows !== null
  const brokeEven = breakEvenReady
    ? computeTreasureMap(profitMonth.netProfitCents, fixedCostCents, targetCents).brokeEven
    : false
  const flood = useBreakEvenCelebration(brokeEven, monthStart, { enabled: breakEvenReady })

  const rc = useRefreshControl(q)

  const activeProfit = period === "day" ? profitDay : profitMonth
  const activeRes = period === "day" ? q.results.profitDay : q.results.profitMonth
  const periodLabel = period === "day" ? dayLabel(now) : monthLabel(now)

  const onOpenExpenses = useCallback(() => {
    haptics.selection()
    router.push("/ausgaben" as Href)
  }, [router])

  // First load with nothing on screen → shaped skeleton. The active period's read
  // failing with nothing to show → the error+retry block. Otherwise the content.
  const firstLoad = q.isLoading && activeProfit == null
  const hardError = activeProfit == null && activeRes.error != null

  return (
    <View className="flex-1 bg-background">
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
        <View className="gap-1">
          <Text className="text-xl font-bold" numberOfLines={1}>
            Finanzen
          </Text>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            Gewinn, Umsatz und Kosten — Tag und Monat im Detail.
          </Text>
        </View>

        <PeriodSegmented value={period} onChange={setPeriod} />

        {/* A background read failed while data is still on screen → the one
            non-blocking error card, with a retry. Never blanks the board. */}
        {!firstLoad && !hardError && activeRes.error != null ? (
          <InlineError message={activeRes.error} onRetry={() => void q.refetch()} />
        ) : null}

        {firstLoad ? (
          <FinanzenSkeleton />
        ) : hardError ? (
          <View className="pt-6">
            <ErrorState
              message={activeRes.error}
              cause={activeRes.errorCause}
              onRetry={() => void q.refetch()}
              retrying={q.isFetching}
            />
          </View>
        ) : activeProfit != null ? (
          <View className="gap-5">
            <StaggerItem index={0} exit={false}>
              <NetProfitHero profit={activeProfit} periodLabel={periodLabel} />
            </StaggerItem>

            <StaggerItem index={1} exit={false}>
              <ProfitWaterfall profit={activeProfit} onOpenExpenses={onOpenExpenses} />
            </StaggerItem>

            {period === "month" ? (
              <StaggerItem index={2} exit={false}>
                {breakEvenReady && profitMonth != null ? (
                  <BreakEvenCard
                    netProfitCents={profitMonth.netProfitCents}
                    fixedCostCents={fixedCostCents}
                    targetCents={targetCents}
                    onManageFixedCosts={onOpenExpenses}
                  />
                ) : (
                  // Fixed costs not loaded yet → honest locked-style note, never a
                  // fabricated break-even line.
                  <Card
                    className="gap-2.5 px-4 py-4"
                    style={{ borderWidth: 1, borderStyle: "dashed", borderColor: t.colors.border }}
                  >
                    <View className="flex-row items-center gap-2.5">
                      <View
                        className="h-8 w-8 items-center justify-center rounded-md"
                        style={{ backgroundColor: t.colors.mutedForeground + "14" }}
                      >
                        <MapPin size={t.icon.md} color={t.colors.mutedForeground} />
                      </View>
                      <Text className="flex-1 text-base font-semibold" numberOfLines={1}>
                        Break-even des Monats
                      </Text>
                    </View>
                    <Text className="text-muted-foreground text-2xs">
                      Die Break-even-Linie erscheint, sobald die Fixkosten geladen sind.
                    </Text>
                  </Card>
                )}
              </StaggerItem>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Break-even gold flood — plays once on the real crossing into profit. */}
      <GoldFlood visible={flood.visible} onReachPeak={flood.onReachPeak} onDone={flood.onDone} />
    </View>
  )
}
