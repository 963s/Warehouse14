/**
 * Zielkarte — live data layer for the antique "treasure board" of owner goals.
 *
 * This is the SAME honest fan-out the Schatzkammer dashboard runs (bridge ·
 * finance · inventory · metals · fixed costs), folded into the 12 gauge metrics
 * the board draws. Self-contained: it owns its own useMultiQuery so the board is
 * a standalone route and never depends on the dashboard being mounted. Polls
 * every 30 s while focused + refetches on focus → the instruments feel live.
 *
 * Honesty (DESIGN.md §4): every VALUE is a real number from a real endpoint. The
 * denominators are the owner's goals (useDashboardTargets) where editable, else
 * the house references (GAUGE_TARGETS). A source that is not readable yields
 * `available: false` → the instrument renders a calm locked state, never a 0 or a
 * fabricated win. The Fixkosten budget is the one local reference (no endpoint
 * goal yet); it is labelled a Richtwert, not a Ziel.
 */
import { useMemo } from "react"

import {
  bridgeSummary,
  dashboardSummary,
  financeMonthRevenue,
  financeProfit,
  inventoryValue,
  listFixedCosts,
  metalWeights,
} from "@/warehouse14/api"
import { useDashboardTargets } from "@/warehouse14/preferences"
import { GAUGE_TARGETS, monthlyFixedCostCents, monthStartDay } from "@/warehouse14/schatzkammer"
import { useMultiQuery } from "@/warehouse14/ui/data"
import { useRefreshControl } from "@/warehouse14/ui/data/useRefreshControl"

import type {
  BridgeSummary,
  DashboardSummary,
  InventoryValueResponse,
  MetalWeightsResponse,
  MonthRevenueResponse,
  ProfitResponse,
} from "@warehouse14/api-client"

/** A self-contained dark canvas for the treasure board (independent of the app's
 *  light theme — this surface is a deliberate dark "instrument panel", like a
 *  game board). Warm umber blacks + brass + the red→amber→green progress ramp. */
export const TREASURE_COLORS = {
  page: "#0c0b08", // deep warm-black ground
  panel: "#15130e", // widget panel (a half-step lifted)
  panelTop: "#1b1813", // panel top sheen (gradient start)
  edge: "#2c271e", // panel hairline
  edgeSoft: "#211d16",
  ink: "#efe7d6", // parchment text — titles + values
  inkMuted: "#9c9384", // labels / Ziel lines
  inkFaint: "#6f6757",
  gilt: "#c9a55c", // brass / gold accent thread
  giltBright: "#e6c878",
  giltDeep: "#876a2c",
  green: "#74c07a", // goal reached
  amber: "#e0a63f", // on the way
  red: "#d65a3f", // far / over budget
  silver: "#c4c9d0", // silver tank fill
  silverDeep: "#7e858f",
  gold: "#d9b154", // gold tank fill
  goldDeep: "#9c7a2e",
  glass: "#080706", // inside a glass tube
  parchment: "#d7c59c", // scroll + map ground
  parchmentEdge: "#b7a172",
  parchmentInk: "#3b3020",
} as const

/** A local Richtwert (reference), not an endpoint goal: the monthly fixed-cost
 *  budget the thermometer fills toward. Honest label: „Richtwert", not „Ziel". */
export const FIXKOSTEN_BUDGET_EUR = 7500

const POLL_MS = 30_000

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

// ── formatting ───────────────────────────────────────────────────────────────

const eur0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 })
const eur2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatEur(cents: number, withCents = false): string {
  const v = cents / 100
  return `${withCents ? eur2.format(v) : eur0.format(Math.round(v))} €`
}
export function formatEurAmount(eurValue: number): string {
  return `${eur0.format(Math.round(eurValue))} €`
}
/** Grams rendered as g under 1 kg, else kg with one decimal (matches the image:
 *  „350 g" for gold, „22,4 kg" for silver). */
export function formatWeight(grams: number): string {
  if (grams >= 1000) return `${num1.format(grams / 1000)} kg`
  return `${eur0.format(Math.round(grams))} g`
}
export function formatPct(ratio: number): string {
  return `${Math.round(clamp01(ratio) * 100)}%`
}

/** The red→amber→green tone the arcs/rings use, keyed off how close to goal. */
export function toneFor(ratio: number): string {
  const r = clamp01(ratio)
  if (r >= 0.75) return TREASURE_COLORS.green
  if (r >= 0.4) return TREASURE_COLORS.amber
  return TREASURE_COLORS.red
}

// ── metric model ─────────────────────────────────────────────────────────────

export type GoalKind =
  | "arc" // half-circle speedometer
  | "ring" // closed vault ring
  | "thermo" // thermometer
  | "tank" // horizontal glass cylinder
  | "chest" // treasure chest + bar
  | "scale" // balance scale
  | "lens" // magnifier ring
  | "scroll" // parchment month goals
  | "map" // treasure map overview

export interface GoalMetric {
  id: string
  /** Screaming German header, e.g. TAGESUMSATZ. */
  title: string
  /** The denominator line, e.g. „Ziel: 1.000 €" / „Richtwert: 30 kg". */
  zielText: string
  /** The big live value, e.g. „780 €" / „22,4 kg" / „7 / 10". */
  valueText: string
  /** „78%" or null when the source is not readable. */
  pctText: string | null
  /** 0..1 fill for the instrument (0 when unavailable). */
  ratio: number
  /** Brass-on-dark fill tone for this ratio (green/amber/red). */
  tone: string
  /** A live, readable source backs the value (else a calm locked instrument). */
  available: boolean
  /** Which instrument draws it. */
  kind: GoalKind
}

export interface MonthlyBar {
  label: string
  ratio: number
  available: boolean
}

export interface TreasureBoard {
  metrics: GoalMetric[]
  /** The 5 mini-bars on the Monatsziele scroll. */
  monthlyBars: MonthlyBar[]
  /** Overall Zielerreichung 0..1 — the mean of the readable axes. */
  overall: number
  overallAvailable: boolean
  refresh: ReturnType<typeof useRefreshControl>
  isFirstLoad: boolean
}

interface Axis {
  ratio: number
  available: boolean
}

function metric(
  id: string,
  title: string,
  kind: GoalKind,
  zielText: string,
  valueText: string,
  axis: Axis,
): GoalMetric {
  const ratio = axis.available ? clamp01(axis.ratio) : 0
  return {
    id,
    title,
    kind,
    zielText,
    valueText: axis.available ? valueText : "—",
    pctText: axis.available ? formatPct(ratio) : null,
    ratio,
    tone: toneFor(ratio),
    available: axis.available,
  }
}

/**
 * The live treasure board. Reuses the dashboard's exact sources + denominators so
 * a gauge here can never disagree with the Schatzkammer about the same number.
 */
export function useTreasureMetrics(): TreasureBoard {
  const targets = useDashboardTargets()

  const q = useMultiQuery(
    {
      bridge: bridgeSummary,
      dash: dashboardSummary,
      profitDay: () => financeProfit("day"),
      monthRev: financeMonthRevenue,
      invValue: inventoryValue,
      metals: metalWeights,
      fixedCosts: () => listFixedCosts({ activeOnly: true }),
    },
    { key: "zielkarte", pollIntervalMs: POLL_MS },
  )
  const refresh = useRefreshControl(q)

  const bridge = q.results.bridge.data as BridgeSummary | null
  const dash = q.results.dash.data as DashboardSummary | null
  const profitDay = q.results.profitDay.data as ProfitResponse | null
  const monthRev = q.results.monthRev.data as MonthRevenueResponse | null
  const invValue = q.results.invValue.data as InventoryValueResponse | null
  const metals = q.results.metals.data as MetalWeightsResponse | null
  const fixedCostsRows = q.results.fixedCosts.data?.items ?? null

  return useMemo(() => {
    const monthStart = monthStartDay(new Date())
    const fixedCostCents = fixedCostsRows ? monthlyFixedCostCents(fixedCostsRows, monthStart) : 0

    // — axes (each independent; an unread source → available:false) —
    const dayRevEur = bridge ? bridge.todayRevenueCents / 100 : 0
    const aTagesumsatz: Axis = { available: !!bridge, ratio: dayRevEur / targets.revenueEur }

    const monthRevEur = monthRev ? monthRev.monthToDateRevenueCents / 100 : 0
    const aMonatsumsatz: Axis = {
      available: !!monthRev,
      ratio: monthRevEur / targets.monthRevenueEur,
    }

    // Fixkosten: how much of the monthly budget is committed (a cost gauge).
    const hasFixed = fixedCostsRows !== null && fixedCostCents > 0
    const aFixkosten: Axis = {
      available: hasFixed,
      ratio: fixedCostCents / 100 / FIXKOSTEN_BUDGET_EUR,
    }

    const aSilber: Axis = {
      available: !!metals,
      ratio: metals ? metals.silverGrams / GAUGE_TARGETS.silverGrams : 0,
    }
    const aGold: Axis = {
      available: !!metals,
      ratio: metals ? metals.goldGrams / GAUGE_TARGETS.goldGrams : 0,
    }

    const dayProfitEur = profitDay ? profitDay.netProfitCents / 100 : 0
    const aGewinn: Axis = { available: !!profitDay, ratio: dayProfitEur / targets.netProfitDayEur }

    const aAnkauf: Axis = {
      available: !!bridge,
      ratio: bridge ? bridge.todayAnkaufCount / GAUGE_TARGETS.ankaufCount : 0,
    }
    const aVerkauf: Axis = {
      available: !!bridge,
      ratio: bridge ? bridge.todaySalesCount / GAUGE_TARGETS.soldCount : 0,
    }

    const invEur = invValue ? invValue.listValueCents / 100 : 0
    const aLager: Axis = {
      available: !!invValue,
      ratio: invEur / GAUGE_TARGETS.inventoryValueEur,
    }

    const aExpertisen: Axis = {
      available: !!dash,
      ratio: dash ? dash.pendingAppraisals / GAUGE_TARGETS.appraisals : 0,
    }

    const metrics: GoalMetric[] = [
      metric(
        "tagesumsatz",
        "TAGESUMSATZ",
        "arc",
        `Ziel: ${formatEurAmount(targets.revenueEur)}`,
        formatEur(bridge?.todayRevenueCents ?? 0),
        aTagesumsatz,
      ),
      metric(
        "monatsumsatz",
        "MONATSUMSATZ",
        "ring",
        `Ziel: ${formatEurAmount(targets.monthRevenueEur)}`,
        formatEur(monthRev?.monthToDateRevenueCents ?? 0),
        aMonatsumsatz,
      ),
      metric(
        "fixkosten",
        "FIXKOSTEN",
        "thermo",
        `Richtwert: ${formatEurAmount(FIXKOSTEN_BUDGET_EUR)}`,
        formatEur(fixedCostCents),
        aFixkosten,
      ),
      metric(
        "silber",
        "SILBERBESTAND",
        "tank",
        `Referenz: ${formatWeight(GAUGE_TARGETS.silverGrams)}`,
        formatWeight(metals?.silverGrams ?? 0),
        aSilber,
      ),
      metric(
        "gold",
        "GOLDBESTAND",
        "tank",
        `Referenz: ${formatWeight(GAUGE_TARGETS.goldGrams)}`,
        formatWeight(metals?.goldGrams ?? 0),
        aGold,
      ),
      metric(
        "gewinn",
        "GEWINN HEUTE",
        "arc",
        `Ziel: ${formatEurAmount(targets.netProfitDayEur)}`,
        `${dayProfitEur >= 0 ? "+" : ""}${formatEur(profitDay?.netProfitCents ?? 0)}`,
        aGewinn,
      ),
      metric(
        "ankauf",
        "ANKÄUFE HEUTE",
        "chest",
        `Ziel: ${GAUGE_TARGETS.ankaufCount} Kunden`,
        `${bridge?.todayAnkaufCount ?? 0} / ${GAUGE_TARGETS.ankaufCount}`,
        aAnkauf,
      ),
      metric(
        "verkauf",
        "VERKAUFTE ARTIKEL",
        "chest",
        `Ziel: ${GAUGE_TARGETS.soldCount} Stück`,
        `${bridge?.todaySalesCount ?? 0} / ${GAUGE_TARGETS.soldCount}`,
        aVerkauf,
      ),
      metric(
        "lager",
        "LAGERWERT",
        "scale",
        `Referenz: ${formatEurAmount(GAUGE_TARGETS.inventoryValueEur)}`,
        formatEur(invValue?.listValueCents ?? 0),
        aLager,
      ),
      metric(
        "expertisen",
        "EXPERTISEN",
        "lens",
        `Ziel: ${GAUGE_TARGETS.appraisals}`,
        `${dash?.pendingAppraisals ?? 0} / ${GAUGE_TARGETS.appraisals}`,
        aExpertisen,
      ),
    ]

    const monthlyBars: MonthlyBar[] = [
      { label: "Umsatz", ratio: clamp01(aMonatsumsatz.ratio), available: aMonatsumsatz.available },
      { label: "Silber", ratio: clamp01(aSilber.ratio), available: aSilber.available },
      { label: "Gold", ratio: clamp01(aGold.ratio), available: aGold.available },
      { label: "Ankäufe", ratio: clamp01(aAnkauf.ratio), available: aAnkauf.available },
      { label: "Expertisen", ratio: clamp01(aExpertisen.ratio), available: aExpertisen.available },
    ]

    const readable = monthlyBars.filter((b) => b.available)
    const overallAvailable = readable.length > 0
    const overall = overallAvailable
      ? readable.reduce((s, b) => s + b.ratio, 0) / readable.length
      : 0

    return {
      metrics,
      monthlyBars,
      overall,
      overallAvailable,
      refresh,
      isFirstLoad: q.isLoading && bridge === null,
    }
  }, [
    bridge,
    dash,
    profitDay,
    monthRev,
    invValue,
    metals,
    fixedCostsRows,
    targets,
    refresh,
    q.isLoading,
  ])
}
