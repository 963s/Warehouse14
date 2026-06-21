/**
 * search-ui.ts — the pure brain of the Global-Search surface (app/suche.tsx).
 *
 * One free-text box that fans out over the three things an Owner looks for from
 * the phone — an Artikel, a Kunde, a recent Beleg — and routes each hit straight
 * to the surface that owns it. This module holds ONLY the pure, JSX-free parts so
 * the screen stays a thin shell over the spine:
 *
 *   • the SearchSection vocabulary (kind · German label · icon · route map),
 *   • the per-source result shapers (ProductListRow / CustomerListRow /
 *     RecentTransactionItem → a uniform SearchHit the row renders),
 *   • the client-side Beleg matcher (the /transactions/recent feed has NO server
 *     `q`, so the last-24h sales are filtered here on the receipt locator —
 *     honestly scoped: the screen labels the section "Letzte Belege"),
 *   • the route target per hit (so a tap deep-links into Artikel / Kunde /
 *     Verkauf), and the small German helpers (initials, the meta line).
 *
 * Honesty rule: nothing here fabricates a value. A shaper only ever copies real
 * fields off a real wire row; the recent-Beleg matcher filters, it never invents
 * a match. Money/weight stay as the wire strings and are formatted by the screen
 * through the shared de-DE helpers, never re-implemented here.
 */
import type {
  CustomerListRow,
  ProductListRow,
  RecentTransactionItem,
} from "@warehouse14/api-client"
import { Boxes, Receipt, type LucideIcon, Users } from "lucide-react-native"

// ── Sections ──────────────────────────────────────────────────────────────────

/** The three things global search reaches. The order here is the render order. */
export type SearchKind = "product" | "customer" | "transaction"

export interface SearchSectionMeta {
  kind: SearchKind
  /** German section header. */
  label: string
  /** German singular for the row's accessibility / count copy. */
  singular: string
  icon: LucideIcon
}

/** Section metadata, in render order (Artikel · Kunden · Belege). */
export const SEARCH_SECTIONS: readonly SearchSectionMeta[] = [
  { kind: "product", label: "Artikel", singular: "Artikel", icon: Boxes },
  { kind: "customer", label: "Kunden", singular: "Kunde", icon: Users },
  { kind: "transaction", label: "Letzte Belege", singular: "Beleg", icon: Receipt },
] as const

// ── The uniform hit a row renders ──────────────────────────────────────────────

/** A route push descriptor (expo-router pathname + params), kept framework-free
 *  so this module never imports expo-router; the screen casts to `Href`. */
export interface SearchRoute {
  pathname: string
  params?: Record<string, string>
}

/**
 * One search result, normalised across the three domains so a single row
 * component can render any hit: a leading line, a muted subtitle, an optional
 * trailing value (the Listenpreis / the Beleg total), and the route to push.
 * `raw` carries the source row for the screen if it needs a field we didn't lift.
 */
export interface SearchHit {
  kind: SearchKind
  /** Stable React key (the entity id / locator), unique within its section. */
  id: string
  /** The bold leading line — Artikelname, Kundenname, or the Beleg locator. */
  title: string
  /** The muted line under the title (SKU + material, Kundennummer, Beleg-Zeit). */
  subtitle: string | null
  /** A trailing money string (wire EUR) the screen formats, or null. */
  trailingEur: string | null
  /** Where a tap deep-links. */
  route: SearchRoute
}

// ── Shapers (real wire row → SearchHit) ─────────────────────────────────────────

const METAL_SHORT: Record<NonNullable<ProductListRow["metal"]>, string> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

/** "12,4 g · Gold" / "Gold" / null — the compact material clause for the subtitle. */
export function productMaterial(
  metal: ProductListRow["metal"],
  weightGrams: string | null,
): string | null {
  const m = metal ? METAL_SHORT[metal] : null
  const n = weightGrams != null ? Number(weightGrams) : NaN
  const w = Number.isFinite(n)
    ? `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} g`
    : null
  if (w && m) return `${w} · ${m}`
  return w ?? m
}

/** An Artikel hit → routes into the product detail modal. SKU + material subtitle. */
export function productHit(row: ProductListRow): SearchHit {
  const material = productMaterial(row.metal, row.weightGrams)
  const subtitle = material ? `${row.sku} · ${material}` : row.sku
  return {
    kind: "product",
    id: row.id,
    title: row.name,
    subtitle,
    trailingEur: row.listPriceEur,
    route: { pathname: "/product/[id]", params: { id: row.id } },
  }
}

/** A Kunde hit → routes into the customer detail modal. Kundennummer subtitle. */
export function customerHit(row: CustomerListRow): SearchHit {
  return {
    kind: "customer",
    id: row.id,
    title: row.fullName,
    subtitle: row.customerNumber,
    trailingEur: null,
    route: { pathname: "/customer/[id]", params: { id: row.id } },
  }
}

/**
 * A recent-Beleg hit → routes to the Verkauf surface (which owns the last-24h
 * sales + the late-storno path). The locator is the title; the timestamp is the
 * subtitle (formatted by the screen). A storno reversal is flagged in the
 * subtitle prefix the screen builds, so we only lift the raw fields here.
 */
export function transactionHit(row: RecentTransactionItem, subtitle: string | null): SearchHit {
  return {
    kind: "transaction",
    id: row.id,
    title: row.receiptLocator,
    subtitle,
    trailingEur: row.totalEur,
    route: { pathname: "/verkauf" },
  }
}

// ── Recent-Beleg client matcher ─────────────────────────────────────────────────

/** Fold accents + case so "müller" matches "Muller" and the input is forgiving. */
export function normalizeQuery(q: string): string {
  return (
    q
      .trim()
      .toLowerCase()
      .normalize("NFD")
      // Strip the combining diacritical marks block (U+0300–U+036F) left by NFD.
      .replace(/[̀-ͯ]/g, "")
  )
}

/**
 * The /transactions/recent feed has no server `q`; filter the last-24h sales
 * here on the receipt locator (a substring, case/accent-insensitive). Pure: it
 * filters real rows, never invents a match. An empty query returns nothing — the
 * screen only fans out once there is something to match.
 */
export function matchTransactions(
  items: readonly RecentTransactionItem[],
  query: string,
): RecentTransactionItem[] {
  const needle = normalizeQuery(query)
  if (needle.length === 0) return []
  return items.filter((it) => normalizeQuery(it.receiptLocator).includes(needle))
}

// ── Small German helpers shared by the screen ───────────────────────────────────

/** First letters of the first/last name parts → a calm avatar monogram. */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** The minimum query length before the surface fans out (avoids one-char storms). */
export const MIN_QUERY_LENGTH = 2

/** The search debounce — long enough to settle typing, short enough to feel live. */
export const SEARCH_DEBOUNCE_MS = 300

/** Per-section fetch cap — a focused result set, not an exhaustive list. */
export const SEARCH_LIMIT = 12
