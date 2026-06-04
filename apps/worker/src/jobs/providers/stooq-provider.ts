/**
 * StooqProvider — free, key-less spot feed via stooq.com.
 *
 *   GET {baseUrl}/q/l/?s=xauusd,xagusd,xptusd,xpdusd,eurusd&f=sd2t2ohlcv&h&e=csv
 *   → one CSV row per symbol: Symbol,Date,Time,Open,High,Low,Close,Volume
 *
 * Metals are quoted in USD per troy ounce; EURUSD is USD per 1 EUR. So:
 *   €/oz = usdPerOz / eurusd   →   €/g = perOunceToPerGram(€/oz)
 *
 * No API key and no per-request quota → it can poll often without 403s (the
 * goldapi free tier exhausts within hours). Quotes are intraday but slightly
 * delayed; for a precious-metals shop that is a faithful "live" feed. A symbol
 * that returns N/D (market closed / unavailable) is skipped rather than failing
 * the whole fetch.
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
  gold: 'XAUUSD',
  silver: 'XAGUSD',
  platinum: 'XPTUSD',
  palladium: 'XPDUSD',
};
const FX_SYMBOL = 'EURUSD';

export interface StooqProviderOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class StooqProvider implements MetalPriceProvider {
  public readonly name = 'stooq';
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor(opts: StooqProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://stooq.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  public async fetch(opts: MetalPriceFetchOptions = {}): Promise<NormalizedMetalPrice[]> {
    // stooq's light CSV returns one row per request, so each symbol is fetched
    // on its own (no key, no quota — five small requests are cheap).
    const fx = await this.fetchSymbol(FX_SYMBOL, opts.signal);
    const eurusd = fx ? Number.parseFloat(fx.close) : Number.NaN;
    if (!Number.isFinite(eurusd) || eurusd <= 0) {
      throw new Error(`stooq: missing or invalid EURUSD rate ("${fx?.close ?? 'N/D'}")`);
    }

    const out: NormalizedMetalPrice[] = [];
    for (const metal of Object.keys(SYMBOL_BY_METAL) as MetalKey[]) {
      const row = await this.fetchSymbol(SYMBOL_BY_METAL[metal], opts.signal);
      if (!row) continue;
      const usdPerOz = Number.parseFloat(row.close);
      if (!Number.isFinite(usdPerOz) || usdPerOz <= 0) continue; // N/D → skip this metal
      out.push({
        metal,
        pricePerGramEur: perOunceToPerGram(usdPerOz / eurusd),
        fetchedAt: isoFrom(row.date, row.time),
        source: 'stooq.com',
      });
    }
    return out;
  }

  private async fetchSymbol(symbol: string, signal?: AbortSignal): Promise<CsvRow | null> {
    const url = `${this.baseUrl}/q/l/?s=${symbol.toLowerCase()}&f=sd2t2ohlcv&h&e=csv`;
    const res = await this.fetchImpl(url, { signal });
    if (!res.ok) {
      throw new Error(`stooq ${symbol} fetch HTTP ${res.status}`);
    }
    return parseRow(await res.text());
  }
}

interface CsvRow {
  symbol: string;
  date: string;
  time: string;
  close: string;
}

/** Parse a single-symbol stooq CSV (header + one data row) into a CsvRow. */
function parseRow(csv: string): CsvRow | null {
  const lines = csv.trim().split(/\r?\n/);
  // Columns: Symbol,Date,Time,Open,High,Low,Close,Volume
  const cols = (lines[1] ?? '').split(',');
  if (cols.length < 7) return null;
  const symbol = (cols[0] ?? '').trim().toUpperCase();
  if (symbol.length === 0) return null;
  return {
    symbol,
    date: (cols[1] ?? '').trim(),
    time: (cols[2] ?? '').trim(),
    close: (cols[6] ?? '').trim(),
  };
}

/** Build an ISO timestamp from stooq's date + time, falling back to now. */
function isoFrom(date: string, time: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const t = /^\d{2}:\d{2}:\d{2}$/.test(time) ? time : '00:00:00';
    const d = new Date(`${date}T${t}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}
