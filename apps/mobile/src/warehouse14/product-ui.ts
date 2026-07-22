/** Shared product-status presentation (German labels + Badge variants). */
import type {
  Metal,
  ProductConditionCode,
  ProductItemType,
  ProductStatus,
  TaxTreatmentCode,
} from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"
import { deriveSizeClass, type SizeClass } from "@warehouse14/domain"

import { germanLabel } from "@/warehouse14/german-text"

export const STATUS_LABEL: Record<ProductStatus, string> = {
  AVAILABLE: "Verfügbar",
  DRAFT: "Entwurf",
  RESERVED: "Reserviert",
  SOLD: "Verkauft",
}

export const STATUS_VARIANT: Record<ProductStatus, NonNullable<BadgeProps["variant"]>> = {
  AVAILABLE: "success",
  DRAFT: "secondary",
  RESERVED: "default",
  SOLD: "destructive",
}

/** Lager filter chips: Alle + the four statuses, in scan-verdict order. */
export const STATUS_FILTERS: ReadonlyArray<{ label: string; value: ProductStatus | "ALL" }> = [
  { label: "Alle", value: "ALL" },
  { label: "Verfügbar", value: "AVAILABLE" },
  { label: "Entwurf", value: "DRAFT" },
  { label: "Reserviert", value: "RESERVED" },
  { label: "Verkauft", value: "SOLD" },
]

/**
 * A NUMERIC(15,4) gram weight from the wire → a de-DE string with a sane
 * precision (e.g. "33.9300" → "33,93", "31.0799" → "31,08"). Matches the
 * intake form's own Feingewicht preview (comma + maximumFractionDigits: 3),
 * so the same value never reads two different ways across screens.
 *
 * The `g` suffix is the caller's job. If the wire value is not a finite
 * number we return it unchanged rather than printing "NaN" (honesty rule).
 */
export function formatGrams(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return n.toLocaleString("de-DE", { maximumFractionDigits: 3 })
}

/** A product's Lagerort triplet → "Tresor A · Schublade 1 · Pos 3" (omits gaps). */
export function formatLocation(
  unit: string | null,
  drawer: string | null,
  position: string | null,
): string {
  const parts = [unit, drawer, position].filter((p): p is string => !!p && p.trim() !== "")
  return parts.length ? parts.join(" · ") : "Kein Lagerort"
}

// ── Intake-Auswahllisten (German labels for the "Neu"/"Bearbeiten" flow) ──────

/** Artikelart — mirrors ProductItemType. Order: edelmetall, dann Sonstiges. */
export const ITEM_TYPE_OPTIONS: ReadonlyArray<{ value: ProductItemType; label: string }> = [
  { value: "gold_jewelry", label: "Goldschmuck" },
  { value: "gold_coin", label: "Goldmünze" },
  { value: "gold_bar", label: "Goldbarren" },
  { value: "silver_jewelry", label: "Silberschmuck" },
  { value: "silver_coin", label: "Silbermünze" },
  { value: "silver_bar", label: "Silberbarren" },
  { value: "platinum_jewelry", label: "Platinschmuck" },
  { value: "platinum_coin", label: "Platinmünze" },
  { value: "platinum_bar", label: "Platinbarren" },
  { value: "antique", label: "Antiquität" },
  { value: "watch", label: "Uhr" },
  { value: "other", label: "Sonstiges" },
]

/** Edelmetall — mirrors Metal. */
export const METAL_OPTIONS: ReadonlyArray<{ value: Metal; label: string }> = [
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silber" },
  { value: "platinum", label: "Platin" },
  { value: "palladium", label: "Palladium" },
]

export const METAL_LABEL: Record<Metal, string> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

/** Zustand — mirrors ProductConditionCode. */
export const CONDITION_OPTIONS: ReadonlyArray<{ value: ProductConditionCode; label: string }> = [
  { value: "NEW", label: "Neu" },
  { value: "USED_EXCELLENT", label: "Sehr gut" },
  { value: "USED_GOOD", label: "Gut" },
  { value: "USED_FAIR", label: "Gebraucht" },
  { value: "ANTIQUE_RESTORED", label: "Antik, restauriert" },
  { value: "ANTIQUE_AS_FOUND", label: "Antik, original" },
]

export const CONDITION_LABEL: Record<ProductConditionCode, string> = Object.fromEntries(
  CONDITION_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ProductConditionCode, string>

/**
 * A condition value from the wire → its clean German label. The detail wire types
 * `condition` as a loose `string`, so an unmapped code must NOT leak as the raw
 * SCREAMING_SNAKE token — `germanLabel` returns „Unbekannt" instead (purity rule).
 */
export function conditionLabel(condition: string | null | undefined): string {
  if (!condition) return "Unbekannt"
  return germanLabel(CONDITION_LABEL, condition)
}

/**
 * A status value from the wire → its German label. `status` is a DB-backed enum,
 * but reading it through the safe helper means a future/unknown member can never
 * render as a blank badge or a raw token — it degrades to „Unbekannt".
 */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unbekannt"
  return germanLabel(STATUS_LABEL, status)
}

/** A status value → its Badge variant, defaulting to the quiet „secondary" tone
 *  for any value outside the known set (never an undefined variant). */
export function statusVariant(status: string | null | undefined): NonNullable<BadgeProps["variant"]> {
  if (status && status in STATUS_VARIANT) return STATUS_VARIANT[status as ProductStatus]
  return "secondary"
}

/** Steuerbehandlung — mirrors TaxTreatmentCode. Differenzbesteuerung ist der
 *  Normalfall für Ankaufsware (§25a), daher zuerst. */
export const TAX_TREATMENT_OPTIONS: ReadonlyArray<{ value: TaxTreatmentCode; label: string }> = [
  { value: "MARGIN_25A", label: "Differenz §25a" },
  { value: "INVESTMENT_GOLD_25C", label: "Anlagegold §25c" },
  { value: "STANDARD_19", label: "Regel 19 %" },
  { value: "REDUCED_7", label: "Ermäßigt 7 %" },
  { value: "MIXED", label: "Gemischt" },
  { value: "REVERSE_CHARGE_13B", label: "Reverse-Charge §13b" },
]

/**
 * Auto-generate a human-readable SKU for a new intake when the Owner does not
 * type one — "W14-<YYMMDD>-<4 random base36>". The backend treats sku as an
 * intake-locked identity field (min 1 char); this only guarantees uniqueness
 * for fast phone intake, the Owner may override.
 */
export function generateSku(now: Date = new Date()): string {
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `W14-${yy}${mm}${dd}-${rand}`
}

// ── Field-level validation (mirrors the Kunden form: an error MAP, not a banner) ─
//
// Money is on the wire as a decimal EUR STRING for the products API („199.90"),
// so these guards check the decimal shape, not cents. Each validator returns a
// map keyed by field so a screen paints exactly the offending input red; the
// `first…Error` helper gives the FormScreen banner copy + the Error haptic.

/** Decimal money/weight: up to 16 integer + 2 fractional digits. */
const DECIMAL_RE = /^\d{1,16}(\.\d{1,2})?$/
/** Feinheit 0..1 with up to 4 fractional digits (mirrors the server FinenessString). */
const FINENESS_RE = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/

/**
 * Normalise a user-typed decimal to the wire shape: trim and turn the German
 * decimal comma into a period. A `decimal-pad` on a German device types „199,90",
 * but the products API (and these guards) speak the period form „199.90" — so a
 * comma must be translated before it is validated OR put on the wire, exactly the
 * way every other money path in this app does (`cart-math.ts`, `ankauf-flow.ts`,
 * `einstellungen.tsx`). Idempotent for values that already use a period.
 */
export function normalizeDecimal(value: string): string {
  return value.trim().replace(",", ".")
}

/** A decimal-string amount strictly greater than zero (comma-tolerant). */
function isPositivePrice(value: string): boolean {
  const v = normalizeDecimal(value)
  return DECIMAL_RE.test(v) && Number(v) > 0
}

// ── Neuer Artikel (intake) ───────────────────────────────────────────────────

/** The intake draft — all strings/enums the „Neu"-Formular collects. */
export interface ProductIntakeForm {
  name: string
  /** Optional free-text description — shown in the storefront (descriptionDe). */
  description: string
  itemType: ProductItemType | null
  metal: Metal | null
  weightGrams: string
  fineness: string
  // Outer packing dimensions in cm → derived S/M/L/XL size class.
  lengthCm: string
  widthCm: string
  heightCm: string
  condition: ProductConditionCode | null
  taxCode: TaxTreatmentCode | null
  acquisition: string
  listPrice: string
  sku: string
  categoryId: string | null
  unit: string
  drawer: string
  position: string
}

/** A blank intake draft (Differenzbesteuerung §25a + „Gut" are the defaults). */
export const EMPTY_PRODUCT_INTAKE: ProductIntakeForm = {
  name: "",
  description: "",
  itemType: null,
  metal: null,
  weightGrams: "",
  fineness: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  condition: "USED_GOOD",
  taxCode: "MARGIN_25A",
  acquisition: "",
  listPrice: "",
  sku: "",
  categoryId: null,
  unit: "",
  drawer: "",
  position: "",
}

export type ProductIntakeFieldKey =
  | "name"
  | "itemType"
  | "condition"
  | "taxCode"
  | "acquisition"
  | "listPrice"
  | "weightGrams"
  | "fineness"
  | "lengthCm"
  | "widthCm"
  | "heightCm"

export type ProductIntakeErrors = Partial<Record<ProductIntakeFieldKey, string>>

/** Field-level guard for the intake draft → a German message per offending field. */
export function validateProductIntake(s: ProductIntakeForm): ProductIntakeErrors {
  const errors: ProductIntakeErrors = {}

  if (!s.name.trim()) errors.name = "Name ist erforderlich."
  else if (s.name.trim().length < 2) errors.name = "Name ist zu kurz."

  if (!s.itemType) errors.itemType = "Artikelart auswählen."
  if (!s.condition) errors.condition = "Zustand auswählen."
  if (!s.taxCode) errors.taxCode = "Steuerbehandlung auswählen."

  if (!isPositivePrice(s.acquisition))
    errors.acquisition = "Einkaufspreis als Betrag angeben (z. B. 199,90)."
  if (!isPositivePrice(s.listPrice))
    errors.listPrice = "Listenpreis als Betrag angeben (z. B. 349,00)."

  if (s.weightGrams.trim() && !DECIMAL_RE.test(normalizeDecimal(s.weightGrams)))
    errors.weightGrams = "Gewicht als Zahl in Gramm angeben."
  if (s.fineness.trim() && !FINENESS_RE.test(normalizeDecimal(s.fineness)))
    errors.fineness = "Feinheit als Dezimalzahl zwischen 0 und 1 angeben (z. B. 0,585)."

  const dimMsg = "Maß als Zahl in cm angeben (z. B. 12,5)."
  if (s.lengthCm.trim() && !DECIMAL_RE.test(normalizeDecimal(s.lengthCm))) errors.lengthCm = dimMsg
  if (s.widthCm.trim() && !DECIMAL_RE.test(normalizeDecimal(s.widthCm))) errors.widthCm = dimMsg
  if (s.heightCm.trim() && !DECIMAL_RE.test(normalizeDecimal(s.heightCm))) errors.heightCm = dimMsg

  return errors
}

/**
 * Live packing size class (S/M/L/XL) for the intake form, derived from the
 * entered cm dimensions + gram weight via the shared `@warehouse14/domain` rule
 * (the same one the server applies). Returns `null` until a dimension is set, so
 * the form shows „—" rather than a guessed size.
 */
export function intakeSizeClass(s: ProductIntakeForm): SizeClass | null {
  const num = (v: string): number | null => {
    const t = normalizeDecimal(v)
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return deriveSizeClass({
    lengthCm: num(s.lengthCm),
    widthCm: num(s.widthCm),
    heightCm: num(s.heightCm),
    weightGrams: num(s.weightGrams),
  })
}

export function isProductIntakeValid(errors: ProductIntakeErrors): boolean {
  return Object.keys(errors).length === 0
}

const INTAKE_ORDER: ProductIntakeFieldKey[] = [
  "name",
  "itemType",
  "condition",
  "taxCode",
  "acquisition",
  "listPrice",
  "weightGrams",
  "fineness",
]

/** The first intake error in reading order — for the banner copy. */
export function firstProductIntakeError(errors: ProductIntakeErrors): string | null {
  for (const key of INTAKE_ORDER) {
    if (errors[key]) return errors[key]!
  }
  return null
}

// ── Artikel bearbeiten (edit — only the PUT-allowed fields) ──────────────────

export type ProductEditFieldKey = "name" | "listPrice" | "lengthCm" | "widthCm" | "heightCm"
export type ProductEditErrors = Partial<Record<ProductEditFieldKey, string>>

/** Field-level guard for the edit draft (Name + Listenpreis, plus optional Maße). */
export function validateProductEdit(
  name: string,
  listPrice: string,
  dims?: { lengthCm: string; widthCm: string; heightCm: string },
): ProductEditErrors {
  const errors: ProductEditErrors = {}
  if (!name.trim()) errors.name = "Name ist erforderlich."
  else if (name.trim().length < 2) errors.name = "Name ist zu kurz."
  if (!isPositivePrice(listPrice))
    errors.listPrice = "Listenpreis als Betrag angeben (z. B. 349,00)."
  if (dims) {
    const dimMsg = "Maß als Zahl in cm angeben (z. B. 12,5)."
    if (dims.lengthCm.trim() && !DECIMAL_RE.test(normalizeDecimal(dims.lengthCm))) errors.lengthCm = dimMsg
    if (dims.widthCm.trim() && !DECIMAL_RE.test(normalizeDecimal(dims.widthCm))) errors.widthCm = dimMsg
    if (dims.heightCm.trim() && !DECIMAL_RE.test(normalizeDecimal(dims.heightCm))) errors.heightCm = dimMsg
  }
  return errors
}

export function isProductEditValid(errors: ProductEditErrors): boolean {
  return Object.keys(errors).length === 0
}

export function firstProductEditError(errors: ProductEditErrors): string | null {
  return (
    errors.name ?? errors.listPrice ?? errors.lengthCm ?? errors.widthCm ?? errors.heightCm ?? null
  )
}
