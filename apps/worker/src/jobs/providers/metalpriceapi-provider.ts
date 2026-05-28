/**
 * MetalPriceApiProvider — metalpriceapi.com adapter.
 *
 *   GET {baseUrl}/v1/latest?api_key=KEY&base=EUR&currencies=XAU,XAG,XPT,XPD
 *   → { success, base: "EUR", rates: { XAU, XAG, XPT, XPD } }
 *
 * Rate convention (default `units_per_base`): a metal rate is "how many troy
 * ounces of the metal equal 1 EUR", so €/oz = 1 / rate, then €/g = €/oz ÷ 31.1.
 * Some plans return the inverse (€ per ounce directly) — set
 * `rateConvention: 'base_per_unit'` for that.
 */

import { perOunceToPerGram } from './convert.js';
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

interface MetalPriceApiResponse {
  success?: boolean;
  base?: string;
  rates?: Record<string, number>;
  error?: unknown;
}

export interface MetalPriceApiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** How to read a rate value. Default `units_per_base` (€/oz = 1 / rate). */
  rateConvention?: 'units_per_base' | 'base_per_unit';
  fetchImpl?: FetchLike;
}

export class MetalPriceApiProvider implements MetalPriceProvider {
  public readonly name = 'metalpriceapi';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly rateConvention: 'units_per_base' | 'base_per_unit';
  private readonly fetchImpl: FetchLike;

  public constructor(opts: MetalPriceApiProviderOptions) {
    if (!opts.apiKey) {
      throw new Error('MetalPriceApiProvider requires METAL_PRICE_API_KEY');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.metalpriceapi.com').replace(/\/+$/, '');
    this.rateConvention = opts.rateConvention ?? 'units_per_base';
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  public async fetch(opts: MetalPriceFetchOptions = {}): Promise<NormalizedMetalPrice[]> {
    const currencies = Object.values(SYMBOL_BY_METAL).join(',');
    const url = `${this.baseUrl}/v1/latest?api_key=${encodeURIComponent(this.apiKey)}&base=EUR&currencies=${currencies}`;

    const res = await this.fetchImpl(url, { signal: opts.signal });
    if (!res.ok) {
      throw new Error(`metalpriceapi fetch HTTP ${res.status}`);
    }
    const body = (await res.json()) as MetalPriceApiResponse;
    if (body.success === false || !body.rates) {
      throw new Error(`metalpriceapi error response: ${JSON.stringify(body.error ?? body)}`);
    }

    const fetchedAt = new Date().toISOString();
    const out: NormalizedMetalPrice[] = [];
    for (const metal of ['gold', 'silver', 'platinum', 'palladium'] as const) {
      const rate = body.rates[SYMBOL_BY_METAL[metal]];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue;
      const eurPerOunce = this.rateConvention === 'units_per_base' ? 1 / rate : rate;
      out.push({
        metal,
        pricePerGramEur: perOunceToPerGram(eurPerOunce, 4),
        fetchedAt,
        source: 'metalpriceapi',
      });
    }

    if (out.length === 0) {
      throw new Error('metalpriceapi response carried no usable metal rates');
    }
    return out;
  }
}
