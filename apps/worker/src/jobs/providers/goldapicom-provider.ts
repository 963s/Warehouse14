/**
 * GoldApiComProvider — free, KEY-LESS spot feed.
 *
 *   metals: GET https://api.gold-api.com/price/{XAU|XAG|XPT|XPD}  → { price (USD/oz), updatedAt }
 *   fx:     GET https://open.er-api.com/v6/latest/USD             → { rates: { EUR } }  (USD→EUR)
 *
 * Metals are quoted in USD per troy ounce; the FX rate is EUR per 1 USD. So:
 *   €/oz = usdPerOz × (EUR per USD)   →   €/g = perOunceToPerGram(€/oz)
 *
 * Replaces the stooq feed (stooq gated its key-less CSV API → permanent 404).
 * Both upstreams are key-less and quota-friendly. A genuine FX outage throws
 * (so the no-show-style consecutive-failure budget still alerts on a real dead
 * feed); a single unavailable metal is skipped, not fatal.
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

const METALS_BASE = 'https://api.gold-api.com';
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const SYMBOL_BY_METAL: Record<MetalKey, string> = {
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
  palladium: 'XPD',
};

export interface GoldApiComProviderOptions {
  metalsBaseUrl?: string;
  fxUrl?: string;
  fetchImpl?: FetchLike;
}

export class GoldApiComProvider implements MetalPriceProvider {
  public readonly name = 'gold_api_com';
  private readonly metalsBaseUrl: string;
  private readonly fxUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor(opts: GoldApiComProviderOptions = {}) {
    this.metalsBaseUrl = (opts.metalsBaseUrl ?? METALS_BASE).replace(/\/+$/, '');
    this.fxUrl = opts.fxUrl ?? FX_URL;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  public async fetch(opts: MetalPriceFetchOptions = {}): Promise<NormalizedMetalPrice[]> {
    // 1. USD→EUR (mandatory; metals are USD-quoted).
    const fxRes = await this.fetchImpl(this.fxUrl, { signal: opts.signal });
    if (!fxRes.ok) {
      throw new Error(`gold-api fx fetch HTTP ${fxRes.status}`);
    }
    const fx = (await fxRes.json()) as { result?: string; rates?: Record<string, number> };
    const usdToEur = fx.rates?.EUR;
    if (typeof usdToEur !== 'number' || !Number.isFinite(usdToEur) || usdToEur <= 0) {
      throw new Error(`gold-api: missing or invalid USD→EUR rate ("${String(usdToEur)}")`);
    }

    // 2. Each metal (a single dead symbol is skipped, not fatal).
    const out: NormalizedMetalPrice[] = [];
    for (const metal of Object.keys(SYMBOL_BY_METAL) as MetalKey[]) {
      const res = await this.fetchImpl(`${this.metalsBaseUrl}/price/${SYMBOL_BY_METAL[metal]}`, {
        signal: opts.signal,
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { price?: number | string; updatedAt?: string };
      const usdPerOz = Number(j.price);
      if (!Number.isFinite(usdPerOz) || usdPerOz <= 0) continue;
      out.push({
        metal,
        pricePerGramEur: perOunceToPerGram(usdPerOz * usdToEur),
        fetchedAt: typeof j.updatedAt === 'string' ? j.updatedAt : new Date().toISOString(),
        source: 'gold-api.com',
      });
    }
    return out;
  }
}
