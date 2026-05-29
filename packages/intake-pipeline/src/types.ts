/**
 * Shared types for the intake pipeline's deterministic core (ADR-0015).
 *
 * `VisionClassification` is the (untrusted) hint produced by the Vision call;
 * the deterministic `classifyTaxTreatment` turns it into a tax treatment.
 * The Vision model NEVER decides tax — it only describes the item.
 */

/** The three tax-treatment codes seeded in `tax_treatment_codes` (migration 0006/0007). */
export type TaxTreatmentCode = 'INVESTMENT_GOLD_25C' | 'MARGIN_25A' | 'STANDARD_19';

export const ITEM_TYPES = [
  'gold_bar',
  'gold_coin',
  'silver_coin',
  'gold_jewelry',
  'silver_jewelry',
  'watch',
  'antique',
  'other',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const CONDITIONS = ['new', 'excellent', 'good', 'fair', 'poor'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const AGE_BANDS = ['modern', 'vintage', 'antique'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Raw, untrusted output of the Vision classification step. */
export interface VisionClassification {
  item_type: ItemType;
  /** Visible karat marking, e.g. "14K", "585", "999" — or null if none read. */
  karat_visible: string | null;
  /** Hallmark strings the model thinks it saw. Empty array = none. */
  hallmarks_visible: string[];
  estimated_age_band: AgeBand | null;
  condition: Condition;
  /** Free-form coin identifier hint (e.g. "krugerrand"), used by identifyCoin. */
  coin_hint?: string | null;
  /** Estimated issue year for coins, if the model offered one. */
  estimated_issue_year?: number | null;
  /** Fine-metal weight in grams the model estimated (for markup-over-spot). */
  estimated_fine_grams?: number | null;
  /** Observed market/ask price in EUR, if present in the photos (price tag, etc.). */
  observed_market_price_eur?: number | null;
  /** Mint name when legible — a collector-silver indicator. */
  mint_hint?: string | null;
}

/** Cached LBMA price snapshot (EUR per gram per metal). */
export interface LbmaSnapshot {
  goldEurPerGram: number | null;
  silverEurPerGram: number | null;
  /** ISO timestamp the snapshot was taken. */
  asOf: string;
}

export type TaxConfidence = 'high' | 'medium' | 'low';

export interface TaxTreatmentResult {
  code: TaxTreatmentCode;
  explanation: string;
  confidence: TaxConfidence;
  requires_admin_confirmation: boolean;
  legal_reference: string;
}
