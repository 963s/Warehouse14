/**
 * JsonUrlProvider — back-compat with the original `LBMA_PRICES_URL` contract:
 * an endpoint already returning per-gram EUR prices in the custom shape
 *
 *   { goldEur, silverEur, platinumEur, palladiumEur?, fetchedAt?, source? }
 *
 * No conversion — the values are already €/g. Useful for an internal proxy or
 * a fixture server. gold/silver/platinum are required; palladium optional.
 */

import { toDecimalString } from './convert.js';
import {
  type FetchLike,
  type MetalKey,
  type MetalPriceFetchOptions,
  type MetalPriceProvider,
  type NormalizedMetalPrice,
  defaultFetch,
} from './types.js';

interface JsonUrlResponse {
  goldEur?: string | number;
  silverEur?: string | number;
  platinumEur?: string | number;
  palladiumEur?: string | number;
  fetchedAt?: string;
  source?: string;
}

const FIELD_BY_METAL: Record<MetalKey, keyof JsonUrlResponse> = {
  gold: 'goldEur',
  silver: 'silverEur',
  platinum: 'platinumEur',
  palladium: 'palladiumEur',
};

export interface JsonUrlProviderOptions {
  url: string;
  fetchImpl?: FetchLike;
}

export class JsonUrlProvider implements MetalPriceProvider {
  public readonly name = 'json_url';
  private readonly url: string;
  private readonly fetchImpl: FetchLike;

  public constructor(opts: JsonUrlProviderOptions) {
    this.url = opts.url;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  public async fetch(opts: MetalPriceFetchOptions = {}): Promise<NormalizedMetalPrice[]> {
    const res = await this.fetchImpl(this.url, { signal: opts.signal });
    if (!res.ok) {
      throw new Error(`json_url fetch HTTP ${res.status}`);
    }
    const body = (await res.json()) as JsonUrlResponse;
    const fetchedAt = body.fetchedAt ?? new Date().toISOString();
    const source = body.source ?? 'json_url';

    const out: NormalizedMetalPrice[] = [];
    for (const metal of ['gold', 'silver', 'platinum', 'palladium'] as const) {
      const raw = body[FIELD_BY_METAL[metal]];
      if (raw === undefined || raw === null || raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) {
        throw new Error(`json_url ${metal}: non-positive/non-numeric price '${String(raw)}'`);
      }
      out.push({ metal, pricePerGramEur: toDecimalString(num, 4), fetchedAt, source });
    }

    if (out.length === 0) {
      throw new Error('json_url response carried no usable metal prices');
    }
    return out;
  }
}
