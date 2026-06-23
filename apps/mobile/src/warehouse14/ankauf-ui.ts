/**
 * ankauf-ui — the German display vocabulary + option lists for the mobile
 * buy-in (Ankauf) flow, plus the pure helpers the intake form needs that are NOT
 * money math (the money lives in `ankauf-flow`).
 *
 * WHY IT MIRRORS, NEVER IMPORTS: the canonical labels live in
 * `apps/tauri-pos/src/lib/item-type-label.ts`, which the mobile app may not
 * reach across the app boundary. This module is a faithful MIRROR of that source
 * (same German strings, same enum values) so the two POS surfaces never drift.
 * The wire enums themselves come from `@warehouse14/api-client`, so the option
 * `value`s are type-checked against the real `AnkaufItemType` / `AnkaufMetal` /
 * `AnkaufCondition` / `TaxTreatmentCode` unions — a server enum change is a
 * compile error here, not a silent mismatch.
 */
import type {
  AnkaufCondition,
  AnkaufItemType,
  AnkaufMetal,
  AnkaufPayoutMethod,
  TaxTreatmentCode,
} from "@warehouse14/api-client"

// ────────────────────────────────────────────────────────────────────────────
// Item type (Warenart)
// ────────────────────────────────────────────────────────────────────────────

/** German labels for the buy-in item type (mirror of item-type-label.ts). */
export const ITEM_TYPE_LABEL: Readonly<Record<AnkaufItemType, string>> = {
  gold_jewelry: "Goldschmuck",
  gold_coin: "Goldmünze",
  gold_bar: "Goldbarren",
  silver_jewelry: "Silberschmuck",
  silver_coin: "Silbermünze",
  silver_bar: "Silberbarren",
  platinum_jewelry: "Platinschmuck",
  platinum_coin: "Platinmünze",
  platinum_bar: "Platinbarren",
  antique: "Antiquität",
  watch: "Uhr",
  other: "Sonstiges",
}

export const ITEM_TYPE_OPTIONS: ReadonlyArray<{ value: AnkaufItemType; label: string }> = (
  Object.keys(ITEM_TYPE_LABEL) as AnkaufItemType[]
).map((value) => ({ value, label: ITEM_TYPE_LABEL[value] }))

// ────────────────────────────────────────────────────────────────────────────
// Condition (Zustand)
// ────────────────────────────────────────────────────────────────────────────

export const CONDITION_LABEL: Readonly<Record<AnkaufCondition, string>> = {
  NEW: "Neu",
  USED_EXCELLENT: "Gebraucht sehr gut",
  USED_GOOD: "Gebraucht gut",
  USED_FAIR: "Gebraucht mäßig",
  ANTIQUE_RESTORED: "Antik restauriert",
  ANTIQUE_AS_FOUND: "Antik Fundzustand",
}

export const CONDITION_OPTIONS: ReadonlyArray<{ value: AnkaufCondition; label: string }> = (
  Object.keys(CONDITION_LABEL) as AnkaufCondition[]
).map((value) => ({ value, label: CONDITION_LABEL[value] }))

// ────────────────────────────────────────────────────────────────────────────
// Metal (Edelmetall)
// ────────────────────────────────────────────────────────────────────────────

export const METAL_LABEL: Readonly<Record<AnkaufMetal, string>> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

export const METAL_OPTIONS: ReadonlyArray<{ value: AnkaufMetal; label: string }> = (
  ["gold", "silver", "platinum", "palladium"] as AnkaufMetal[]
).map((value) => ({ value, label: METAL_LABEL[value] }))

/**
 * Infer the precious metal from an item-type prefix (mirror of
 * intake-math.metalFromItemType). A non-metal type (antique/watch/other) → null,
 * so the valuation hint stays off until the operator picks a metal explicitly.
 */
export function metalFromItemType(itemType: AnkaufItemType): AnkaufMetal | null {
  if (itemType.startsWith("gold")) return "gold"
  if (itemType.startsWith("silver")) return "silver"
  if (itemType.startsWith("platinum")) return "platinum"
  if (itemType.startsWith("palladium")) return "palladium"
  return null
}

/** Common hallmark finenesses per metal (per mille) for the quick-pick chips. */
export const COMMON_FINENESS_PER_MILLE: Readonly<Record<AnkaufMetal, readonly number[]>> = {
  gold: [999, 916, 750, 585, 375],
  silver: [999, 925, 800],
  platinum: [999, 950],
  palladium: [999, 950],
}

/** "585" → "0.585" (the 0..1 decimal the valuation core consumes). */
export function finenessDecimalForPerMille(perMille: number): string {
  return (perMille / 1000).toFixed(3)
}

// ────────────────────────────────────────────────────────────────────────────
// Tax treatment (Steuerschlüssel) for the resale of a bought-in item
// ────────────────────────────────────────────────────────────────────────────

/**
 * The Steuerschlüssel a buy-in line can carry on the product it creates. A
 * second-hand item bought from a private person is the textbook §25a
 * Differenzbesteuerung case, so that is the default; investment gold (§25c) and
 * the standard rate are offered for the cases where they apply. The server is the
 * authority — it re-validates the treatment against the item on resale.
 */
export const ANKAUF_TAX_OPTIONS: ReadonlyArray<{ value: TaxTreatmentCode; label: string }> = [
  { value: "MARGIN_25A", label: "§25a Differenzbesteuerung" },
  { value: "INVESTMENT_GOLD_25C", label: "§25c Anlagegold" },
  { value: "STANDARD_19", label: "Regelsteuersatz 19%" },
]

// ────────────────────────────────────────────────────────────────────────────
// Payout method (Auszahlung)
// ────────────────────────────────────────────────────────────────────────────

export const PAYOUT_METHOD_LABEL: Readonly<Record<AnkaufPayoutMethod, string>> = {
  CASH: "Bar",
  BANK_TRANSFER: "Überweisung",
}

// ────────────────────────────────────────────────────────────────────────────
// SKU generator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique, human-scannable SKU for a freshly bought-in item. The
 * Ankauf route requires a `sku` per line and there is no scanner step on mobile,
 * so we mint one: `AN-<base36 day>-<4 random base36>`. It is unique enough for
 * a single buy-in lot and reads as an Ankauf article at a glance; the operator
 * can overwrite it in the form. NOT a fiscal value — purely an inventory label.
 */
export function generateAnkaufSku(): string {
  const day = Math.floor(Date.now() / 86_400_000)
    .toString(36)
    .toUpperCase()
  let rand = ""
  for (let i = 0; i < 4; i++) {
    rand += Math.floor(Math.random() * 36)
      .toString(36)
      .toUpperCase()
  }
  return `AN-${day}-${rand}`
}
