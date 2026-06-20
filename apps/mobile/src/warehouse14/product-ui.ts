/** Shared product-status presentation (German labels + Badge variants). */
import type {
  Metal,
  ProductConditionCode,
  ProductItemType,
  ProductStatus,
  TaxTreatmentCode,
} from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"

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

/** A decimal-string amount strictly greater than zero. */
function isPositivePrice(value: string): boolean {
  const v = value.trim()
  return DECIMAL_RE.test(v) && Number(v) > 0
}

// ── Neuer Artikel (intake) ───────────────────────────────────────────────────

/** The intake draft — all strings/enums the „Neu"-Formular collects. */
export interface ProductIntakeForm {
  name: string
  itemType: ProductItemType | null
  metal: Metal | null
  weightGrams: string
  fineness: string
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
  itemType: null,
  metal: null,
  weightGrams: "",
  fineness: "",
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
    errors.acquisition = "Einkaufspreis als Betrag angeben (z. B. 199.90)."
  if (!isPositivePrice(s.listPrice))
    errors.listPrice = "Listenpreis als Betrag angeben (z. B. 349.00)."

  if (s.weightGrams.trim() && !DECIMAL_RE.test(s.weightGrams.trim()))
    errors.weightGrams = "Gewicht als Zahl in Gramm angeben."
  if (s.fineness.trim() && !FINENESS_RE.test(s.fineness.trim()))
    errors.fineness = "Feinheit als Dezimalzahl 0–1 angeben (z. B. 0.585)."

  return errors
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

export type ProductEditFieldKey = "name" | "listPrice"
export type ProductEditErrors = Partial<Record<ProductEditFieldKey, string>>

/** Field-level guard for the edit draft (Name + Listenpreis are validated). */
export function validateProductEdit(name: string, listPrice: string): ProductEditErrors {
  const errors: ProductEditErrors = {}
  if (!name.trim()) errors.name = "Name ist erforderlich."
  else if (name.trim().length < 2) errors.name = "Name ist zu kurz."
  if (!isPositivePrice(listPrice))
    errors.listPrice = "Listenpreis als Betrag angeben (z. B. 349.00)."
  return errors
}

export function isProductEditValid(errors: ProductEditErrors): boolean {
  return Object.keys(errors).length === 0
}

export function firstProductEditError(errors: ProductEditErrors): string | null {
  return errors.name ?? errors.listPrice ?? null
}
