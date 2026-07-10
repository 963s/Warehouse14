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
