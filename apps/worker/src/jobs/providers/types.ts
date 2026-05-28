/**
 * Metal-price provider abstraction (Epic A, Phase A1).
 *
 * Every provider — mock, metalpriceapi.com, goldapi.io, or a pre-normalized
 * JSON URL — resolves to the SAME normalized shape: price per gram in EUR per
 * metal. The `lbma_prices` worker job consumes `NormalizedMetalPrice[]` and
 * owns persistence; providers own only fetching + unit/currency conversion.
 */

export const METAL_KEYS = ['gold', 'silver', 'platinum', 'palladium'] as const;
export type MetalKey = (typeof METAL_KEYS)[number];

/** A fetched, fully-normalized spot price for one metal. */
export interface NormalizedMetalPrice {
  metal: MetalKey;
  /** Decimal string, ≤ 4 dp — matches `metal_prices.price_per_gram_eur NUMERIC(15,4)`. */
  pricePerGramEur: string;
  /** ISO-8601 timestamp the provider reported (or fetch time if absent). */
  fetchedAt: string;
  /** Free-form provider/source label, recorded into `source_payload`. */
  source: string;
}

export interface MetalPriceFetchOptions {
  /** Job-scoped abort signal (timeout / shutdown). */
  signal?: AbortSignal;
}

export interface MetalPriceProvider {
  /** Stable identifier, e.g. `mock`, `metalpriceapi`, `goldapi`, `json_url`. */
  readonly name: string;
  /** Fetch the current spot prices, already normalized to €/g. */
  fetch(opts?: MetalPriceFetchOptions): Promise<NormalizedMetalPrice[]>;
}

/** Injectable `fetch` so adapters are unit-testable without real network. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal | undefined; headers?: Record<string, string> | undefined },
) => Promise<Response>;

/**
 * Default `FetchLike` backed by the global `fetch`. The cast bridges our
 * narrowed init type to the DOM `RequestInit` (structurally compatible at
 * runtime; the cast only satisfies `exactOptionalPropertyTypes`).
 */
export const defaultFetch: FetchLike = (input, init) =>
  fetch(input, init as RequestInit | undefined);
