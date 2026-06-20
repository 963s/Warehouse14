/**
 * Ausgaben UI helpers — the pure, dependency-light glue between the finance
 * api-client (expensesApi / fixedCostsApi) and the Ausgaben screens
 * (src/app/ausgaben.tsx + ausgaben/ausgabe.tsx + ausgaben/fixkosten.tsx).
 *
 * Holds ONLY presentation + state logic: the German category labels + glyphs,
 * the de-DE Euro ⇄ integer-CENTS parsing/formatting, the `YYYY-MM-DD` business-
 * day helpers the finance routes expect (NOTE: these endpoints take a plain DATE
 * `YYYY-MM-DD`, NOT an ISO date-time — so we must NOT reuse the aufgaben
 * `toISOString()` parser here), the list sorting, and the HONEST aggregations
 * for the KPI tiles + summary lines (derived only from the fetched rows, never a
 * fabricated total). The actual api calls live in src/warehouse14/api.ts.
 */
import type { ExpenseCategory, ExpenseRow, FixedCostRow } from "@warehouse14/api-client"
import { EXPENSE_CATEGORIES } from "@warehouse14/api-client"
import {
  Boxes,
  Building2,
  Megaphone,
  type LucideIcon,
  Receipt,
  Truck,
  Wrench,
  Plane,
  Landmark,
  Package,
} from "lucide-react-native"

// ── Category labels + glyphs ──────────────────────────────────────────────────
/** German labels for each one-off expense category (the api-client enum). */
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

/** The matched glyph for a category — the leading icon on its row / chip. */
export const EXPENSE_CATEGORY_ICON: Readonly<Record<ExpenseCategory, LucideIcon>> = {
  WARENEINKAUF: Boxes,
  MIETE: Building2,
  MARKETING: Megaphone,
  VERSAND: Truck,
  BUEROMATERIAL: Package,
  REPARATUR: Wrench,
  GEBUEHREN: Landmark,
  REISEKOSTEN: Plane,
  SONSTIGES: Receipt,
}

/** The categories in picker order (mirrors the api-client constant). */
export const EXPENSE_CATEGORY_OPTIONS: readonly ExpenseCategory[] = EXPENSE_CATEGORIES

// ── de-DE Euro ⇄ integer CENTS ────────────────────────────────────────────────
/**
 * Parse a German money field ("1.234,56", "99", "12,5", "1234.56") → integer
 * CENTS, or null when it is not a valid positive amount. Accepts the comma OR
 * the dot as the decimal separator and ignores thousands dots/spaces, so the
 * owner can type however the keyboard offers. Rounds to the nearest cent. The
 * backend requires `amountCents >= 1`, so 0 and negatives are rejected here.
 */
export function parseEuroToCents(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === "") return null

  // Keep only digits, separators and a leading sign; reject anything else.
  if (!/^[0-9.,\s]+$/.test(trimmed)) return null

  // Strip spaces (thousands grouping) up-front.
  let s = trimmed.replace(/\s/g, "")

  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  // The decimal separator is whichever appears LAST; the other is grouping.
  const decimalSep = lastComma > lastDot ? "," : lastDot > lastComma ? "." : ""

  let intPart: string
  let fracPart: string
  if (decimalSep === "") {
    intPart = s.replace(/[.,]/g, "")
    fracPart = ""
  } else {
    const groupSep = decimalSep === "," ? "." : ","
    s = s.split(groupSep).join("")
    const parts = s.split(decimalSep)
    if (parts.length !== 2) return null
    intPart = parts[0]
    fracPart = parts[1]
  }

  if (fracPart.length > 2) return null // more precise than a cent → reject
  if (intPart === "" && fracPart === "") return null

  const euros = Number(intPart === "" ? "0" : intPart)
  const cents = Number((fracPart + "00").slice(0, 2))
  if (!Number.isFinite(euros) || !Number.isFinite(cents)) return null

  const total = euros * 100 + cents
  if (!Number.isInteger(total) || total < 1) return null
  return total
}

/**
 * Prefill an amount field from integer CENTS → a de-DE plain string with comma
 * decimals and NO currency symbol (so it edits cleanly), e.g. `150000` →
 * "1500,00". Used to seed the edit form.
 */
export function centsToEuroInput(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const rest = String(abs % 100).padStart(2, "0")
  return `${sign}${euros},${rest}`
}

// ── `YYYY-MM-DD` business-day helpers (NOT ISO date-time) ─────────────────────
/** Today as the backend's `YYYY-MM-DD` business day (local calendar date). */
export function todayBusinessDay(): string {
  return toBusinessDay(new Date())
}

/** A `Date` → `YYYY-MM-DD` (local calendar date). */
export function toBusinessDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Prefill a "TT.MM.JJJJ" field from a `YYYY-MM-DD` business day (or "" if null). */
export function businessDayInput(day: string | null): string {
  if (!day) return ""
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ""
  const [, yyyy, mm, dd] = m
  return `${dd}.${mm}.${yyyy}`
}

/**
 * Parse a "TT.MM.JJJJ" field → a `YYYY-MM-DD` business day for the finance body
 * fields, or null if malformed. An empty/whitespace string returns
 * `{ ok: true, day: null }` so callers can treat it as "kein Datum" (e.g. an
 * open-ended `activeTo`). Guards against JS Date roll-over (32.01 → 01.02).
 */
export function parseBusinessDayInput(
  input: string,
): { ok: true; day: string | null } | { ok: false } {
  const trimmed = input.trim()
  if (trimmed === "") return { ok: true, day: null }
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return { ok: false }
  const [, dd, mm, yyyy] = m
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0, 0)
  if (Number.isNaN(d.getTime())) return { ok: false }
  if (d.getDate() !== Number(dd) || d.getMonth() !== Number(mm) - 1) return { ok: false }
  return { ok: true, day: toBusinessDay(d) }
}

// ── de-DE display formatting ──────────────────────────────────────────────────
const DAY_FMT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

/** "20.06.2026" for a `YYYY-MM-DD` business day, or null when malformed. */
export function formatBusinessDay(day: string | null): string | null {
  if (!day) return null
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, yyyy, mm, dd] = m
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
  if (Number.isNaN(d.getTime())) return null
  return DAY_FMT.format(d)
}

const MONTH_FMT = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" })

/** "Juni 2026" — the long month label for a `YYYY-MM-DD` (its first-of-month). */
export function formatMonthLabel(day: string): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return day
  const [, yyyy, mm] = m
  return MONTH_FMT.format(new Date(Number(yyyy), Number(mm) - 1, 1))
}

/** The `YYYY-MM` month key of a business day, for grouping. */
export function monthKey(day: string): string {
  return day.slice(0, 7)
}

// ── Fixed-cost active-state ───────────────────────────────────────────────────
/**
 * Whether a fixed cost is still running as of today: it has started
 * (`activeFrom <= today`) and is not retired (`activeTo` is null or in the
 * future). A future-dated `activeFrom` reads as "geplant" (not yet active).
 */
export function isFixedCostActive(row: FixedCostRow, today = todayBusinessDay()): boolean {
  if (row.activeFrom > today) return false
  if (row.activeTo != null && row.activeTo < today) return false
  return true
}

/** Whether a fixed cost is retired (has an `activeTo` already in the past). */
export function isFixedCostRetired(row: FixedCostRow, today = todayBusinessDay()): boolean {
  return row.activeTo != null && row.activeTo < today
}

/** A one-word German status for a fixed-cost row. */
export type FixedCostState = "aktiv" | "geplant" | "beendet"
export function fixedCostState(row: FixedCostRow, today = todayBusinessDay()): FixedCostState {
  if (row.activeFrom > today) return "geplant"
  if (isFixedCostRetired(row, today)) return "beendet"
  return "aktiv"
}

export const FIXED_COST_STATE_LABEL: Readonly<Record<FixedCostState, string>> = {
  aktiv: "Aktiv",
  geplant: "Geplant",
  beendet: "Beendet",
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "outline"
export const FIXED_COST_STATE_VARIANT: Readonly<Record<FixedCostState, BadgeVariant>> = {
  aktiv: "success",
  geplant: "secondary",
  beendet: "outline",
}

// ── Sorting ───────────────────────────────────────────────────────────────────
/** One-off expenses newest first (by business day, then creation as tiebreak). */
export function sortExpenses(rows: readonly ExpenseRow[]): ExpenseRow[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

/**
 * Fixed costs with the live ones first (active → geplant → beendet), and inside
 * a bucket the biggest monthly burden first, so the rent sits at the top.
 */
export function sortFixedCosts(
  rows: readonly FixedCostRow[],
  today = todayBusinessDay(),
): FixedCostRow[] {
  const rank: Record<FixedCostState, number> = { aktiv: 0, geplant: 1, beendet: 2 }
  return [...rows].sort((a, b) => {
    const byState = rank[fixedCostState(a, today)] - rank[fixedCostState(b, today)]
    if (byState !== 0) return byState
    return b.monthlyAmountCents - a.monthlyAmountCents
  })
}

// ── Honest aggregations (derived ONLY from the fetched rows) ──────────────────
/** The total monthly burden of the CURRENTLY ACTIVE fixed costs, in cents. */
export function activeFixedMonthlyCents(
  rows: readonly FixedCostRow[],
  today = todayBusinessDay(),
): number {
  let sum = 0
  for (const r of rows) if (isFixedCostActive(r, today)) sum += r.monthlyAmountCents
  return sum
}

/** Count of currently active fixed-cost lines. */
export function activeFixedCount(
  rows: readonly FixedCostRow[],
  today = todayBusinessDay(),
): number {
  let n = 0
  for (const r of rows) if (isFixedCostActive(r, today)) n += 1
  return n
}

/** The sum of one-off expenses that fall in the given `YYYY-MM` month, in cents. */
export function expensesInMonthCents(rows: readonly ExpenseRow[], ym: string): number {
  let sum = 0
  for (const r of rows) if (monthKey(r.date) === ym) sum += r.amountCents
  return sum
}

/** The current calendar month as a `YYYY-MM` key. */
export function currentMonthKey(today = todayBusinessDay()): string {
  return today.slice(0, 7)
}

/**
 * A de-DE summary line for the Fixkosten tab header, built only from real
 * counts, e.g. „3 aktiv · 5 gesamt". Drops the parts that are zero.
 */
export function fixedCostsSummaryLine(
  rows: readonly FixedCostRow[],
  today = todayBusinessDay(),
): string {
  const active = activeFixedCount(rows, today)
  const parts: string[] = []
  if (active > 0) parts.push(`${active} aktiv`)
  parts.push(`${rows.length} ${rows.length === 1 ? "Posten" : "Posten"} gesamt`)
  return parts.join(" · ")
}

/**
 * A de-DE summary line for the Ausgaben tab header, e.g. „12 Ausgaben · 8 diesen
 * Monat". Built only from the fetched rows.
 */
export function expensesSummaryLine(
  rows: readonly ExpenseRow[],
  today = todayBusinessDay(),
): string {
  const ym = currentMonthKey(today)
  const thisMonth = rows.filter((r) => monthKey(r.date) === ym).length
  const parts: string[] = [`${rows.length} ${rows.length === 1 ? "Ausgabe" : "Ausgaben"}`]
  if (thisMonth > 0) parts.push(`${thisMonth} diesen Monat`)
  return parts.join(" · ")
}
