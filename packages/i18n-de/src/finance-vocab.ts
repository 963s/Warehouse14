/**
 * Finanz-Vokabular — die deutschen Wörter der Gewinn-und-Verlust-Ansicht.
 *
 * Der Server rechnet in ganzen Cent (nie in Gleitkomma-Euro) und liefert die
 * Kategorien als Aufzählungs-Token. Beides gehört übersetzt, bevor es jemand
 * liest. Framework-frei, damit Telefon und Kasse dieselben Wörter verwenden.
 */
import type { ExpenseCategory } from "@warehouse14/api-client"

/** Deutsche Bezeichnung je einmaliger Betriebsausgabe. */
export const EXPENSE_CATEGORY_LABELS: Readonly<Record<ExpenseCategory, string>> = {
  WARENEINKAUF: "Wareneinkauf",
  MIETE: "Miete",
  MARKETING: "Marketing",
  VERSAND: "Versand",
  BUEROMATERIAL: "Büromaterial",
  REPARATUR: "Reparatur",
  GEBUEHREN: "Gebühren",
  REISEKOSTEN: "Reisekosten",
  SONSTIGES: "Sonstiges",
}

/** Ein unbekannter Token darf nie roh erscheinen. */
export function expenseCategoryLabel(category: string): string {
  return EXPENSE_CATEGORY_LABELS[category as ExpenseCategory] ?? "Sonstiges"
}

/**
 * Ganze Cent als deutscher Euro-Betrag: 123456 wird „1.234,56 €".
 *
 * Der Betrag kommt als ganze Zahl vom Server. Wir teilen erst bei der Anzeige
 * durch 100 und niemals vorher, damit keine Rundung im Rechenweg landet.
 */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return "0,00 €"
  const euro = cents / 100
  return `${euro.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`
}

/** Der Betrag als Dezimalzeichenkette („1234.56"), z. B. für MoneyAmount. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isFinite(cents)) return "0.00"
  return (cents / 100).toFixed(2)
}

/** Gramm mit höchstens drei Nachkommastellen, deutsch gesetzt. */
export function formatGrams(grams: number): string {
  if (!Number.isFinite(grams)) return "0 g"
  return `${grams.toLocaleString("de-DE", { maximumFractionDigits: 3 })} g`
}

/** Die Zeitspanne der Gewinnrechnung, in Worten. */
export const FINANCE_PERIOD_LABELS: Readonly<Record<"day" | "month", string>> = {
  day: "Heute",
  month: "Dieser Monat",
}

/**
 * Eine Zeile der Gewinn-Kaskade: was hinzukommt, was abgeht, und was bleibt.
 * Reine Ableitung aus der Server-Antwort, ohne eigene Rechnung: das Netto steht
 * so, wie der Server es berechnet hat, und wird hier nicht nachgerechnet.
 */
export interface ProfitStep {
  label: string
  /** Ganze Cent. Abzüge tragen ein negatives Vorzeichen. */
  cents: number
  /** Ob die Zeile das Ergebnis ist (fett, eigene Linie). */
  isResult: boolean
  /** Eine Zeile Erklärung, warum der Posten hier steht. */
  hint: string
}

export interface ProfitLike {
  grossRevenueCents: number
  grossAnkaufCents: number
  expensesCents: number
  fixedCostsAllocatedCents: number
  netProfitCents: number
}

// ── Geschäftsverlauf (Trend aus abgeschlossenen Kassenabschlüssen) ────────────
// Nur FINALISIERTE Tage tragen einen belastbaren Wert; ein laufender Tag
// (COUNTING) ist unvollständig und wird ausgelassen. Die Euro-Zeichenketten
// werden nur für die Balkenhöhe in Zahlen gelesen, nie für eine Geldrechnung.

export interface ClosingLike {
  businessDay: string
  state: "COUNTING" | "FINALIZED"
  netVerkaufEur: string
  netAnkaufEur: string
}

export interface TrendDay {
  businessDay: string
  verkauf: number
  ankauf: number
  /** Verkauf minus Ankauf: der Nettozufluss des Tages. */
  fluss: number
}

/**
 * Eine Euro-Zeichenkette rein zur Anzeige-Skalierung in eine Zahl lesen. Der
 * Server liefert Maschinenformat („1234.50"); ein deutsches Anzeigeformat
 * („1.234,50") wird ebenfalls sauber gelesen (Tausenderpunkt weg, Komma zu
 * Punkt). Nie für eine Geldrechnung, nur für die Balkenhöhe.
 */
function euroToNumber(s: string): number {
  const german = s.includes(",")
  const normalized = german ? s.replace(/\./g, "").replace(",", ".") : s
  const n = Number.parseFloat(normalized)
  return Number.isFinite(n) ? n : 0
}

/**
 * Die letzten `limit` abgeschlossenen Geschäftstage in chronologischer
 * Reihenfolge (ältester zuerst), als Trend-Punkte. Laufende Tage fallen weg.
 */
export function closingsTrend(closings: readonly ClosingLike[], limit = 14): TrendDay[] {
  const finalized = closings
    .filter((c) => c.state === "FINALIZED")
    .slice()
    .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
  const window = finalized.slice(-limit)
  return window.map((c) => {
    const verkauf = euroToNumber(c.netVerkaufEur)
    const ankauf = euroToNumber(c.netAnkaufEur)
    return { businessDay: c.businessDay, verkauf, ankauf, fluss: verkauf - ankauf }
  })
}

export function profitSteps(p: ProfitLike): ProfitStep[] {
  return [
    {
      label: "Umsatz",
      cents: p.grossRevenueCents,
      isResult: false,
      hint: "Alles, was in diesem Zeitraum verkauft wurde.",
    },
    {
      label: "Ankauf",
      cents: -p.grossAnkaufCents,
      isResult: false,
      hint: "An Verkäufer ausgezahlte Beträge.",
    },
    {
      label: "Ausgaben",
      cents: -p.expensesCents,
      isResult: false,
      hint: "Einmalige Betriebsausgaben des Zeitraums.",
    },
    {
      label: "Fixkosten (anteilig)",
      cents: -p.fixedCostsAllocatedCents,
      isResult: false,
      hint: "Der auf den Zeitraum entfallende Anteil der monatlichen Fixkosten.",
    },
    {
      label: "Ergebnis",
      cents: p.netProfitCents,
      isResult: true,
      hint: "So, wie der Server es gerechnet hat.",
    },
  ]
}
