/**
 * Metal-prices domain client — Edelmetall-Kursmodul (Day 23).
 *
 *   current()                 — GET   /api/metal-prices/current
 *   history(query)            — GET   /api/metal-prices/history
 *   rates()                   — GET   /api/metal-prices/rates
 *   override(body)            — POST  /api/metal-prices         (Owner + step-up)
 *   updateMargin(body)        — PATCH /api/metal-prices/margin  (Owner + step-up)
 *
 * Prices on the wire are JSON-safe NUMERIC(15,4) decimal strings.
 */

import type { ApiClient } from '../client.js';

export type MetalKind = 'gold' | 'silver' | 'platinum' | 'palladium';
export type MetalPriceSource = 'LBMA' | 'XAUEUR_VENDOR' | 'MANUAL' | 'INTERNAL_ESTIMATE';

export const METAL_KIND_ORDER: readonly MetalKind[] = ['gold', 'silver', 'platinum', 'palladium'];

export interface CurrentMetalPrice {
  metal: MetalKind;
  /** Decimal string (15,4). null when no row has ever been recorded. */
  pricePerGramEur: string | null;
  source: MetalPriceSource | null;
  fetchedAt: string | null;
  validFrom: string | null;
}

export interface CurrentMetalPricesResponse {
  prices: CurrentMetalPrice[];
}

export interface MetalPriceHistoryRow {
  /** bigserial as decimal string. */
  id: string;
  metal: MetalKind;
  pricePerGramEur: string;
  source: MetalPriceSource;
  validFrom: string;
  validTo: string | null;
  fetchedAt: string;
  manualOverrideByUserId: string | null;
  manualOverrideReason: string | null;
}

export interface MetalPriceHistoryQuery {
  metal?: MetalKind;
  limit?: number;
  offset?: number;
}

export interface MetalPriceHistoryResponse {
  items: MetalPriceHistoryRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ManualOverrideBody {
  metal: MetalKind;
  /** Decimal string (15,4). */
  pricePerGramEur: string;
  /** ≥ 8 chars. Persisted to metal_prices.manual_override_reason + audit. */
  reason: string;
}

export interface ManualOverrideResponse {
  metal: MetalKind;
  pricePerGramEur: string;
  source: 'MANUAL';
  validFrom: string;
  previousPricePerGramEur: string | null;
}

/** One metal's pricing row from GET /api/metal-prices/rates. */
export interface MetalRate {
  metal: MetalKind;
  /** Current spot per gram (melt). null when no row yet. */
  currentPricePerGramEur: string | null;
  /** Time-weighted 10-day average per gram. null when no in-window coverage. */
  avg10dPricePerGramEur: string | null;
  /** Buy rate = avg10d × (1 − safetyMarginPct). null when avg is null. */
  ankaufRatePerGramEur: string | null;
  /** Sell melt baseline per gram (= current spot). null when no row yet. */
  verkaufBasePerGramEur: string | null;
}

export interface MetalRatesResponse {
  /** Ankauf safety margin fraction in effect (0.10 = 10%). */
  safetyMarginPct: number;
  /** Averaging window in days (10). */
  windowDays: number;
  rates: MetalRate[];
}

export interface UpdateMarginBody {
  /** Safety margin fraction in [0, 0.5]. 0.12 = 12%. */
  marginPct: number;
}

export interface UpdateMarginResponse {
  marginPct: number;
}

function buildQuery(q: MetalPriceHistoryQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const metalPricesApi = {
  current(client: ApiClient): Promise<CurrentMetalPricesResponse> {
    return client.request<CurrentMetalPricesResponse>('GET', '/api/metal-prices/current');
  },
  history(
    client: ApiClient,
    query: MetalPriceHistoryQuery = {},
  ): Promise<MetalPriceHistoryResponse> {
    return client.request<MetalPriceHistoryResponse>(
      'GET',
      `/api/metal-prices/history${buildQuery(query)}`,
    );
  },
  rates(client: ApiClient): Promise<MetalRatesResponse> {
    return client.request<MetalRatesResponse>('GET', '/api/metal-prices/rates');
  },
  override(client: ApiClient, body: ManualOverrideBody): Promise<ManualOverrideResponse> {
    return client.request<ManualOverrideResponse>('POST', '/api/metal-prices', body);
  },
  updateMargin(client: ApiClient, body: UpdateMarginBody): Promise<UpdateMarginResponse> {
    return client.request<UpdateMarginResponse>('PATCH', '/api/metal-prices/margin', body);
  },
};
