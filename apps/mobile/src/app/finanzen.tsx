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
 * VISUAL LAW (DESIGN-SYSTEM.md): the waterfall is rendered as a bare LEDGER on
 * the parchment canvas — no cards-inside-cards, no tinted icon chips. Real
 * hierarchy comes from one warm hairline between rows, the gilt thread above the
 * result, the Bricolage display voice on the hero number, and JetBrains Mono on
 * every amount. Each contributing line carries a thin proportional bar (its share
 * of Umsatz) so the owner SEES where the money goes — honest data-viz, never a
 * fabricated axis.
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
 * RingGauge, GrowBar, GoldFlood), components (Hairline, ListRow), and §7 haptics
 * (selection on a period switch / a navigate). Tokens only; de-DE money; German UI.
 */
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import type { FixedCostRow, ProfitResponse } from "@warehouse14/api-client"
import { ArrowDownRight, Wallet } from "lucide-react-native"
import Svg, { Path } from "react-native-svg"

import { Text } from "@/components/ui/text"
import {
  financeProfit,
  formatCents,
  listFixedCosts,
} from "@/warehouse14/api"
import { useBreakEvenCelebration } from "@/warehouse14/game"
import { useDashboardTargets } from "@/warehouse14/preferences"
import { computeTreasureMap, monthStartDay } from "@/warehouse14/schatzkammer"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  ErrorState,
  GoldFlood,
  GrowBar,
  Hairline,
  haptics,
  InlineError,
  ListRow,
  PaperGrain,
  PressableScale,
  RingGauge,
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

// ── The gilt seal ◆ — the Kicker diamond (DESIGN-SYSTEM.md §6: every section
// opens with a gold diamond). A tiny bespoke mark, gilt as a SEAL only. ─────────
function DiamondSeal({ size, color }: { size: number; color: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path d="M6 1 L11 6 L6 11 L1 6 Z" fill={color} />
    </Svg>
  )
}

// ── The Kicker — gilt diamond + a small-caps tracked line over a block ──────────
function Kicker({ label }: { label: string }): ReactNode {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center gap-2">
      <DiamondSeal size={9} color={t.colors.gilt} />
      <Text
        className="text-2xs font-semibold uppercase"
        style={{ letterSpacing: 1.4, color: t.colors.mutedForeground }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
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
      className="flex-row rounded-md p-1"
      style={{ backgroundColor: t.colors.raised }}
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
                minHeight: t.touch.min,
                backgroundColor: active ? t.colors.card : "transparent",
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
// Bare on the canvas: a Kicker, the Bricolage/mono number coloured by sign, a
// one-line meta, and a single gilt thread under it. NO card box (DESIGN-SYSTEM.md §9).
function NetProfitHero({ profit, periodLabel }: { profit: ProfitResponse; periodLabel: string }) {
  const t = useW14Theme()
  const positive = profit.netProfitCents >= 0
  const color = positive ? t.colors.verdigris : t.colors.destructive
  return (
    <View className="gap-2">
      <Kicker label="Nettogewinn" />
      <CountUp
        value={profit.netProfitCents}
        format={formatCents}
        className="font-mono-medium"
        style={{ fontSize: 38, lineHeight: 44, color }}
        accessibilityLabel={`Nettogewinn ${formatCents(profit.netProfitCents)}`}
      />
      <Text className="text-muted-foreground text-sm" numberOfLines={1}>
        {positive ? "Im Plus" : "Im Minus"} · {periodLabel}
      </Text>
      {/* The single gilt thread — gilt as an edge only (DESIGN-SYSTEM.md §1). */}
      <View
        className="mt-1 rounded-full"
        style={{ height: 2, width: 44, backgroundColor: t.colors.gilt }}
      />
    </View>
  )
}

// ── One waterfall line — a bare ledger row (no chip, no card) ──────────────────
type LineTone = "add" | "subtract" | "result"

function WaterfallLine({
  label,
  cents,
  tone,
  shareRatio,
}: {
  label: string
  cents: number
  tone: LineTone
  /** This line's magnitude as a share of Umsatz (0..1) — drives the mini-bar. */
  shareRatio: number
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
  // The mini-bar colour: verdigris for the inflow, a quiet ink for the outflows.
  const barColor = tone === "add" ? t.colors.verdigris : t.colors.mutedForeground

  if (isResult) {
    // The result sits below a gilt thread, the heaviest line in the ledger.
    return (
      <View className="gap-3 pt-3">
        <View
          className="rounded-full"
          style={{ height: 1.5, width: "100%", backgroundColor: t.colors.gilt }}
        />
        <View className="min-h-[44px] flex-row items-baseline justify-between gap-3">
          <Text className="text-lg font-display-semibold leading-tight" numberOfLines={1}>
            {label}
          </Text>
          <Text
            className="font-mono-medium text-xl"
            style={{ color: amountColor }}
            numberOfLines={1}
          >
            {prefix}
            {formatCents(magnitude)}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View className="min-h-[44px] justify-center gap-1.5 py-2">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 text-base font-medium" numberOfLines={1}>
          {label}
        </Text>
        <Text
          className="font-mono-medium text-base"
          style={{ color: amountColor }}
          numberOfLines={1}
        >
          {prefix}
          {formatCents(magnitude)}
        </Text>
      </View>
      {/* The proportional thread — this line's share of Umsatz. Honest: a track
          in the hairline colour, a fill that depicts the real magnitude. */}
      <View
        className="w-full overflow-hidden rounded-full"
        style={{ height: 3, backgroundColor: t.colors.border }}
      >
        <GrowBar ratio={shareRatio} color={barColor} direction="right" thickness={3} radius={2} />
      </View>
    </View>
  )
}

// ── The P&L waterfall — a bare ledger on the canvas, hairline-separated ─────────
function ProfitWaterfall({
  profit,
  onOpenExpenses,
}: {
  profit: ProfitResponse
  onOpenExpenses: () => void
}) {
  const t = useW14Theme()
  // The bars scale against Umsatz (the inflow everything is carved out of). A
  // non-positive Umsatz means there is nothing to apportion — every bar is 0,
  // which is honest (no fabricated axis), the amounts still read true.
  const base = profit.grossRevenueCents > 0 ? profit.grossRevenueCents : 0
  const share = (cents: number): number =>
    base > 0 ? Math.min(1, Math.abs(cents) / base) : 0

  const lines: readonly { key: string; label: string; cents: number; tone: LineTone }[] = [
    { key: "umsatz", label: "Umsatz", cents: profit.grossRevenueCents, tone: "add" },
    { key: "ankauf", label: "Ankauf", cents: profit.grossAnkaufCents, tone: "subtract" },
    { key: "ausgaben", label: "Ausgaben", cents: profit.expensesCents, tone: "subtract" },
    {
      key: "fixkosten",
      label: "Fixkosten-Anteil",
      cents: profit.fixedCostsAllocatedCents,
      tone: "subtract",
    },
  ]

  return (
    <View className="gap-2">
      <Kicker label="Gewinn- und Verlustrechnung" />
      <Text className="text-muted-foreground text-sm" numberOfLines={2}>
        So entsteht der Nettogewinn. Umsatz abzüglich aller Kosten.
      </Text>

      <View className="mt-1">
        {lines.map((line, i) => (
          <View key={line.key}>
            {i > 0 ? <Hairline /> : null}
            <WaterfallLine
              label={line.label}
              cents={line.cents}
              tone={line.tone}
              shareRatio={share(line.cents)}
            />
          </View>
        ))}
        <WaterfallLine
          label="Nettogewinn"
          cents={profit.netProfitCents}
          tone="result"
          shareRatio={0}
        />
      </View>

      <View className="mt-1">
        <Hairline />
        <ListRow
          icon={ArrowDownRight}
          title="Ausgaben verwalten"
          subtitle="Einzelkosten und Fixkosten bearbeiten."
          onPress={onOpenExpenses}
        />
      </View>
    </View>
  )
}

// ── Break-even block (Monat) — cumulative profit vs the month's fixed costs ────
// Bare on the canvas: a Kicker + status seal, the big mono figure, the gauge, the
// honest status line, and a bare link row. No nested card.
function BreakEvenBlock({
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

  // Before break-even the bar tracks fixed-cost coverage (gross margin / fixed);
  // once in the black it tracks the owner's own profit goal. Both fills are real.
  const barValue = map.brokeEven ? map.targetProgress : map.coverage
  const showGoal = map.brokeEven && targetCents > 0

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Kicker label="Break-even des Monats" />
        {map.brokeEven ? (
          <View className="flex-row items-center gap-1.5">
            <DiamondSeal size={8} color={t.colors.verdigris} />
            <Text className="text-2xs font-semibold uppercase" style={{ letterSpacing: 1, color: t.colors.verdigris }}>
              Erreicht
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="text-muted-foreground text-sm" numberOfLines={2}>
        Erst die Fixkosten decken, dann Gewinn heben.
      </Text>

      <View className="mt-1 flex-row items-baseline justify-between gap-3">
        <CountUp
          value={map.netProfitCents}
          format={formatCents}
          className="font-mono-medium"
          style={{
            fontSize: 28,
            lineHeight: 34,
            color: map.brokeEven ? t.colors.verdigris : t.colors.foreground,
          }}
          accessibilityLabel={`Monatsgewinn ${formatCents(map.netProfitCents)}`}
        />
        <Text className="text-muted-foreground text-xs" numberOfLines={1}>
          {showGoal ? `Ziel ${formatCents(targetCents)}` : `Fixkosten ${formatCents(map.fixedCostCents)}`}
        </Text>
      </View>

      {/* Coverage of fixed costs until break-even, then progress to the owner goal. */}
      <View className="w-full py-1">
        <RingGauge value={barValue} color={map.brokeEven ? t.colors.verdigris : t.colors.primary} />
      </View>

      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
          {map.brokeEven
            ? "Fixkosten gedeckt, der Monat ist im Plus."
            : `Fixkosten zu ${Math.round(map.coverage * 100)} % gedeckt`}
        </Text>
        <Text
          className="text-xs font-semibold"
          style={{ color: map.brokeEven ? t.colors.verdigris : t.colors.primary }}
          numberOfLines={1}
        >
          {map.brokeEven ? "Break-even erreicht" : `noch ${formatCents(map.toBreakEvenCents)}`}
        </Text>
      </View>

      <View className="mt-1">
        <Hairline />
        <ListRow
          icon={Wallet}
          title="Fixkosten verwalten"
          subtitle="Die laufenden Kosten hinter der Break-even-Linie."
          onPress={onManageFixedCosts}
        />
      </View>
    </View>
  )
}

// ── First-load skeleton — the surface's own shape, never a mid-screen spinner ──
function FinanzenSkeleton() {
  return (
    <View className="gap-8">
      <View className="gap-2">
        <Skeleton width="34%" height={12} />
        <Skeleton width="60%" height={40} />
        <Skeleton width="46%" height={13} />
      </View>
      <View className="gap-3">
        <Skeleton width="62%" height={14} />
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} className="gap-1.5 py-1">
            <View className="flex-row items-center justify-between">
              <Skeleton width="38%" height={15} />
              <Skeleton width={84} height={15} />
            </View>
            <Skeleton width="100%" height={3} radius="full" />
          </View>
        ))}
      </View>
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

  // One fan-out powers both period views + the break-even block, each settled
  // independently (per-source honesty): a failing fixed-cost read never blanks
  // the day waterfall, and the month profit read lights its own block alone.
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
  const targetCents = Math.round(targets.monthlyProfitTargetEur * 100)

  // The month's fixed-cost line — the SAME number the waterfall shows as
  // „Fixkosten-Anteil". It is the backend's allocated fixed cost
  // (financeApi.profit, period=month: overlap filter active_from ≤ Monatsende
  // AND active_to ≥ Monatsanfang), so a cost that started mid-month is counted
  // here exactly as it is in the waterfall and in netProfitCents above. We do NOT
  // recompute it client-side: the old monthlyFixedCostCents(rows, monthStart)
  // used an active_from ≤ Monatsanfang filter that dropped any cost added after
  // the 1st, which made the break-even block disagree with the waterfall on the
  // same screen and could arm the gold flood against contradicted data.
  const fixedCostCents = profitMonth ? profitMonth.fixedCostsAllocatedCents : 0

  // Break-even celebration — fire the gold flood once on the real false→true
  // crossing of the MONTH's cumulative profit into the black. Held inert until
  // the month profit AND the fixed-cost list have both settled, so a transient
  // first-load `false` is never mistaken for a "before" state (honesty). The
  // fixed-cost read still gates readiness so the block mirrors the waterfall only
  // once the costs behind it are actually loaded.
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
      {/* The aged-paper grain canvas — depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: t.space.x4,
          paddingHorizontal: t.space.x4,
          paddingBottom: insets.contentBottom,
          gap: t.space.x4,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
      >
        <View className="gap-1">
          {/* Screen title in the Bricolage Grotesque display voice (DESIGN-SYSTEM.md §3). */}
          <Text className="font-display-bold text-3xl leading-tight" numberOfLines={1}>
            Finanzen
          </Text>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            Gewinn, Umsatz und Kosten. Tag und Monat im Detail.
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
          <View className="gap-8">
            <StaggerItem index={0} exit={false}>
              <NetProfitHero profit={activeProfit} periodLabel={periodLabel} />
            </StaggerItem>

            <StaggerItem index={1} exit={false}>
              <ProfitWaterfall profit={activeProfit} onOpenExpenses={onOpenExpenses} />
            </StaggerItem>

            {period === "month" ? (
              <StaggerItem index={2} exit={false}>
                {breakEvenReady && profitMonth != null ? (
                  <BreakEvenBlock
                    netProfitCents={profitMonth.netProfitCents}
                    fixedCostCents={fixedCostCents}
                    targetCents={targetCents}
                    onManageFixedCosts={onOpenExpenses}
                  />
                ) : (
                  // Fixed costs not loaded yet → honest locked-style note, never a
                  // fabricated break-even line. Bare on the canvas, not a box.
                  <View className="gap-2">
                    <Kicker label="Break-even des Monats" />
                    <Text className="text-muted-foreground text-sm">
                      Die Break-even-Linie erscheint, sobald die Fixkosten geladen sind.
                    </Text>
                  </View>
                )}
              </StaggerItem>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Break-even gold flood plays once on the real crossing into profit. */}
      <GoldFlood visible={flood.visible} onReachPeak={flood.onReachPeak} onDone={flood.onDone} />
    </View>
  )
}
