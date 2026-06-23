/**
 * Analytics surface vocabulary — the German copy, the period options, and the
 * honest "bald"-tile texts that name each genuinely-missing aggregate AND the
 * backend gap behind it. Kept out of the screen so the wording is reviewed in
 * one place and the screen stays layout-only.
 *
 * Honesty (DESIGN.md §4): the screen NEVER shows a fabricated trend. Where the
 * data simply does not exist yet (a per-day PROFIT series, an inventory-value
 * HISTORY, a per-product SALES ranking), it shows the matching `BaldTileCopy`
 * below — a calm "kommt bald" card that also states, in plain German, which
 * backend aggregate is missing. The note doubles as the backend-gap record the
 * task asks for.
 */
import type { PeriodOption } from "@/warehouse14/ui"
import type { AnalyticsPeriod } from "./derive"

// ── The trend window switcher (Woche · Monat · Quartal) ──────────────────────
/**
 * We offer Woche / Monat / Quartal rather than the dashboard's Tag/…/Jahr set:
 * the trend is built from FINALIZED daily closings, so "Tag" would be a single
 * column and a full "Jahr" is more rows than the bar chart reads well. These
 * three windows all chart cleanly and map to PERIOD_DAYS in derive.ts.
 */
export const ANALYTICS_PERIODS: ReadonlyArray<PeriodOption<AnalyticsPeriod>> = [
  { id: "week", label: "Woche", a11yLabel: "Letzte 7 Tage" },
  { id: "month", label: "Monat", a11yLabel: "Letzte 30 Tage" },
  { id: "quarter", label: "Quartal", a11yLabel: "Letzte 90 Tage" },
] as const

/** A short German caption naming the active window's span (for chart subtitles). */
export function periodSpanLabel(period: AnalyticsPeriod): string {
  switch (period) {
    case "week":
      return "Die letzten 7 abgeschlossenen Tage"
    case "month":
      return "Die letzten 30 abgeschlossenen Tage"
    case "quarter":
      return "Die letzten 90 abgeschlossenen Tage"
  }
}

// ── Honest "bald" tiles — a missing aggregate + the backend gap behind it ────
export interface BaldTileCopy {
  /** Card title (German), e.g. "Gewinn-Verlauf". */
  title: string
  /** One calm sentence telling the owner what this will become. */
  description: string
  /**
   * The backend gap in plain German — which aggregate/endpoint is missing. Shown
   * as a quiet footnote on the locked card so the honesty is explicit, and it
   * doubles as the gap record for the team.
   */
  gap: string
}

/**
 * Net-PROFIT over time. The closings carry net Verkauf/Ankauf but NOT operating
 * expenses or allocated fixed costs, and `financeApi.profit` has no date-range
 * (only period=day|month, a single point). So a real per-day profit trend can't
 * be drawn honestly yet. We chart the trading result (Verkauf − Ankauf) instead
 * and keep this tile for the true profit curve.
 */
export const BALD_PROFIT_TREND: BaldTileCopy = {
  title: "Gewinn-Verlauf",
  description:
    "Der echte Gewinn pro Tag Umsatz minus Ankauf, Ausgaben und anteiliger Fixkosten erscheint hier, sobald die Auswertung steht.",
  gap: "Backend-Lücke: kein Tages-Zeitreihen-Endpunkt für den Nettogewinn (financeApi.profit liefert nur einen Einzelwert für Tag/Monat; Tagesabschlüsse enthalten keine Ausgaben/Fixkosten).",
}

/**
 * Inventory value OVER TIME. `inventoryApi.value` is a single current snapshot;
 * there is no history series to chart. We show the snapshot + its unrealised
 * margin and keep this tile for the value curve.
 */
export const BALD_INVENTORY_HISTORY: BaldTileCopy = {
  title: "Lagerwert-Verlauf",
  description:
    "Wie sich der Lagerwert über die Wochen entwickelt, zeigt sich hier, sobald der Verlauf erfasst wird. Aktuell sehen Sie den heutigen Stand.",
  gap: "Backend-Lücke: kein Verlaufs-Endpunkt für den Lagerwert (inventoryApi.value liefert nur den aktuellen Stand, keine Historie).",
}

/**
 * Top PRODUCTS by sales. No per-product sales aggregate endpoint exists; the
 * category ranking we DO show is by current inventory count, not by what sold.
 * This tile holds the true best-sellers ranking.
 */
export const BALD_TOP_PRODUCTS: BaldTileCopy = {
  title: "Meistverkaufte Artikel",
  description:
    "Die Bestseller nach tatsächlichem Verkauf erscheinen hier, sobald die Verkaufsauswertung pro Artikel verfügbar ist.",
  gap: "Backend-Lücke: kein Aggregat für Verkäufe je Artikel (Tagesabschlüsse zählen Transaktionen, nicht Positionen).",
}

// ── Section copy (kept here so the screen reads as layout) ───────────────────
export const COPY = {
  screenTitle: "Auswertungen",
  screenSubtitle: "Umsatz, Handel und Lager aus echten Tagesabschlüssen.",

  revenueTitle: "Umsatz-Verlauf",
  revenueSubtitle: "Netto-Verkauf je abgeschlossenem Tag.",

  tradingTitle: "Handelsergebnis",
  tradingSubtitle: "Netto-Verkauf minus Netto-Ankauf je Tag.",

  flowTitle: "Ankauf und Verkauf",
  flowSubtitle: "Wie sich Geld-Ein und Geld-Aus im Zeitraum verteilen.",

  ankaufTrendTitle: "Ankauf-Verlauf",
  ankaufTrendSubtitle: "Netto-Ankauf je abgeschlossenem Tag.",

  categoryTitle: "Bestand nach Kategorie",
  categorySubtitle: "Wo die Artikel im Lager liegen nach Anzahl, nicht nach Verkauf.",

  inventoryTitle: "Lagerwert heute",
  inventorySubtitle: "Listenwert, Einkaufswert und die stille Marge im Regal.",

  /** Labels for the Ankauf/Verkauf balance + totals block. */
  verkaufLabel: "Verkauf",
  ankaufLabel: "Ankauf",
  netLabel: "Netto",

  /** Inventory snapshot tile labels. */
  listValueLabel: "Listenwert",
  acquisitionLabel: "Einkaufswert",
  marginLabel: "Stille Marge",
  availableLabel: "Verfügbar",

  /** Empty-window copy reused by the trend cards. */
  emptyTrendTitle: "Noch keine Tagesabschlüsse",
  emptyTrendDescription:
    "Sobald Tage rechtsverbindlich abgeschlossen sind, erscheint hier ihr Verlauf.",

  emptyCategoryTitle: "Keine Kategorien mit Artikeln",
  emptyCategoryDescription: "Sobald Artikel Kategorien zugeordnet sind, erscheint die Verteilung.",
} as const

/** "12 Artikel" / "1 Artikel" — German article-count caption (no fabrication).
 *  „Artikel" is invariant in German (singular = plural), so no inflection. */
export function articleCountLabel(count: number): string {
  return `${count} Artikel`
}

/** "über 7 Tage" / "über 1 Tag" — the span suffix for the totals caption. */
export function dayCountLabel(days: number): string {
  return `über ${days} ${days === 1 ? "Tag" : "Tage"}`
}
