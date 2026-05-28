/**
 * TypeBox schemas for the Edelmetall-Kursmodul (Day 23).
 *
 * Exposes two surfaces:
 *   • metal_prices  — read current, read history, manual override (Owner)
 *   • product valuation — schmelzwert + collector_premium + total
 *
 * Prices on the wire are JSON strings (same convention as money.ts).
 * Metal precision is NUMERIC(15,4); valuation totals are NUMERIC(18,2).
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString } from './money.js';

const METAL_ENUM = Type.Union([
  Type.Literal('gold'),
  Type.Literal('silver'),
  Type.Literal('platinum'),
  Type.Literal('palladium'),
]);

const SOURCE_ENUM = Type.Union([
  Type.Literal('LBMA'),
  Type.Literal('XAUEUR_VENDOR'),
  Type.Literal('MANUAL'),
  Type.Literal('INTERNAL_ESTIMATE'),
]);

/**
 * NUMERIC(15,4)-shaped string: up to 11 digits + optional `.dddd`.
 * Matches metal_prices.price_per_gram_eur exactly.
 */
const PricePerGramString = Type.String({
  pattern: '^\\d{1,11}(\\.\\d{1,4})?$',
  examples: ['62.5000', '0.7500', '29.4500'],
  description: 'Price per gram in EUR, NUMERIC(15,4) compatible.',
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/metal-prices/current — all 4 metals' CURRENT row
// ────────────────────────────────────────────────────────────────────────

export const CurrentMetalPrice = Type.Object({
  metal: METAL_ENUM,
  pricePerGramEur: Type.Union([PricePerGramString, Type.Null()], {
    description: 'NULL when no row has ever been recorded for this metal.',
  }),
  source: Type.Union([SOURCE_ENUM, Type.Null()]),
  fetchedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  validFrom: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export const CurrentMetalPricesResponse = Type.Object({
  prices: Type.Array(CurrentMetalPrice),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/metal-prices/history — paged
// ────────────────────────────────────────────────────────────────────────

export const MetalPriceHistoryQuery = Type.Object({
  metal: Type.Optional(METAL_ENUM),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const MetalPriceHistoryRow = Type.Object({
  id: Type.String({ description: 'bigserial as decimal string' }),
  metal: METAL_ENUM,
  pricePerGramEur: PricePerGramString,
  source: SOURCE_ENUM,
  validFrom: Type.String({ format: 'date-time' }),
  validTo: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  fetchedAt: Type.String({ format: 'date-time' }),
  manualOverrideByUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  manualOverrideReason: Type.Union([Type.String(), Type.Null()]),
});

export const MetalPriceHistoryResponse = Type.Object({
  items: Type.Array(MetalPriceHistoryRow),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/metal-prices — Owner manual override
// ────────────────────────────────────────────────────────────────────────

export const ManualOverrideBody = Type.Object({
  metal: METAL_ENUM,
  pricePerGramEur: PricePerGramString,
  reason: Type.String({
    minLength: 8,
    maxLength: 500,
    description:
      'Mandatory human-readable justification (≥ 8 chars). Persisted to ' +
      'metal_prices.manual_override_reason + audit_log payload.',
  }),
});

export const ManualOverrideResponse = Type.Object({
  metal: METAL_ENUM,
  pricePerGramEur: PricePerGramString,
  source: Type.Literal('MANUAL'),
  validFrom: Type.String({ format: 'date-time' }),
  previousPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/metal-prices/rates — per-metal pricing (current + 10d avg + Ankauf)
// ────────────────────────────────────────────────────────────────────────

export const MetalRate = Type.Object({
  metal: METAL_ENUM,
  /** CURRENT row price per gram. NULL when no row exists yet. */
  currentPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /** Time-weighted 10-day average. NULL when no in-window coverage. */
  avg10dPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /** Ankauf (buy) rate = avg10d × (1 − safetyMarginPct). NULL when avg is NULL. */
  ankaufRatePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /**
   * Verkauf (sell) melt baseline per gram = current spot. The full item-level
   * suggested ask (Schmelzwert + Sammleraufschlag) is per-product — see
   * GET /api/products/:id/valuation.
   */
  verkaufBasePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
});

export const MetalRatesResponse = Type.Object({
  /** Ankauf safety margin applied (0.10 = 10%). Phase A3 makes this Owner-editable. */
  safetyMarginPct: Type.Number(),
  /** Averaging window in days (10). */
  windowDays: Type.Integer(),
  rates: Type.Array(MetalRate),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/valuation
// ────────────────────────────────────────────────────────────────────────

export const ProductValuationParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const ProductValuationResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  metal: Type.Union([METAL_ENUM, Type.Null()]),
  weightGrams: Type.Union([Type.String(), Type.Null()]),
  finenessDecimal: Type.Union([Type.String(), Type.Null()]),
  feingewichtGrams: Type.Union([Type.String(), Type.Null()]),
  currentPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /** Schmelzwert = feingewicht × current_price. NULL when any operand is missing. */
  schmelzwertEur: Type.Union([DecimalString, Type.Null()]),
  collectorPremiumEur: Type.Union([DecimalString, Type.Null()]),
  /** schmelzwert + collector_premium. NULL when either is missing. */
  suggestedAskPriceEur: Type.Union([DecimalString, Type.Null()]),
  listPriceEur: DecimalString,
  /** list_price − schmelzwert. NULL when schmelzwert is unknown. */
  marginOverScrapEur: Type.Union([DecimalString, Type.Null()]),
  /** When the current price was first recorded (valid_from of the CURRENT row). */
  pricedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

// ────────────────────────────────────────────────────────────────────────
// Static type re-exports
// ────────────────────────────────────────────────────────────────────────

export type TMetalPriceHistoryQuery = Static<typeof MetalPriceHistoryQuery>;
export type TManualOverrideBody = Static<typeof ManualOverrideBody>;
export type TProductValuationParams = Static<typeof ProductValuationParams>;
