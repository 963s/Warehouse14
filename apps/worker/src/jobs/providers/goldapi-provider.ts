/**
 * GoldApiProvider — goldapi.io adapter.
 *
 *   GET {baseUrl}/api/{SYMBOL}/EUR   header: x-access-token: KEY
 *   → { price, price_gram_24k, timestamp, metal, currency, … }
 *
 * goldapi already returns a per-gram 24k (pure) price in the requested
 * currency, so we use `price_gram_24k` directly — no oz→g conversion needed.
 * One request per metal (the free tier is per-symbol).
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

const SYMBOL_BY_METAL: Record<MetalKey, string> = {
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
  palladium: 'XPD',
};

interface GoldApiResponse {
  price?: number;
  price_gram_24k?: number;
  timestamp?: number;
}

export interface GoldApiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class GoldApiProvider implements MetalPriceProvider {
  public readonly name = 'goldapi';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor(opts: GoldApiProviderOptions) {
    if (!opts.apiKey) {
      throw new Error('GoldApiProvider requires METAL_PRICE_API_KEY');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://www.goldapi.io').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  public async fetch(opts: MetalPriceFetchOptions = {}): Promise<NormalizedMetalPrice[]> {
    const out: NormalizedMetalPrice[] = [];

    for (const metal of ['gold', 'silver', 'platinum', 'palladium'] as const) {
      const url = `${this.baseUrl}/api/${SYMBOL_BY_METAL[metal]}/EUR`;
      const res = await this.fetchImpl(url, {
        signal: opts.signal,
        headers: { 'x-access-token': this.apiKey, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`goldapi ${metal} fetch HTTP ${res.status}`);
      }
      const body = (await res.json()) as GoldApiResponse;

      // Prefer the ready-made per-gram 24k value; fall back to per-oz price.
      let perGram: number | undefined;
      if (typeof body.price_gram_24k === 'number' && body.price_gram_24k > 0) {
        perGram = body.price_gram_24k;
      } else if (typeof body.price === 'number' && body.price > 0) {
        perGram = body.price / 31.1034768;
      }
      if (perGram === undefined || !Number.isFinite(perGram)) {
        throw new Error(`goldapi ${metal}: response missing a usable price`);
      }

      out.push({
        metal,
        pricePerGramEur: toDecimalString(perGram, 4),
        fetchedAt: body.timestamp
          ? new Date(body.timestamp * 1000).toISOString()
          : new Date().toISOString(),
        source: 'goldapi',
      });
    }

    return out;
  }
}
