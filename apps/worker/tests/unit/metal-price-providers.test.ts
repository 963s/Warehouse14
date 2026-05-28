import { describe, expect, it } from 'vitest';

import {
  type FetchLike,
  GoldApiProvider,
  JsonUrlProvider,
  MetalPriceApiProvider,
  MockProvider,
  TROY_OUNCE_GRAMS,
  createMetalPriceProvider,
  perOunceToPerGram,
} from '../../src/jobs/providers/index.js';

/** Build a FetchLike that returns a canned JSON body, capturing the call. */
function jsonFetch(
  body: unknown,
  status = 200,
): { fetchImpl: FetchLike; calls: Array<{ url: string; headers?: Record<string, string> }> } {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, headers: init?.headers });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetchImpl, calls };
}

describe('convert helpers', () => {
  it('perOunceToPerGram divides by the troy-ounce gram count', () => {
    // 3110.34768 €/oz ÷ 31.1034768 g/oz = exactly 100 €/g.
    expect(perOunceToPerGram(100 * TROY_OUNCE_GRAMS)).toBe('100.0000');
  });

  it('rejects non-positive ounce prices', () => {
    expect(() => perOunceToPerGram(0)).toThrow();
    expect(() => perOunceToPerGram(-5)).toThrow();
  });
});

describe('MockProvider', () => {
  it('is deterministic for a fixed seed and returns all four metals as 4dp strings', async () => {
    const a = await new MockProvider({ seed: 42, now: () => 1_700_000_000_000 }).fetch();
    const b = await new MockProvider({ seed: 42, now: () => 1_700_000_000_000 }).fetch();
    expect(a).toEqual(b);
    expect(a.map((p) => p.metal).sort()).toEqual(['gold', 'palladium', 'platinum', 'silver']);
    for (const p of a) {
      expect(p.source).toBe('mock');
      expect(p.pricePerGramEur).toMatch(/^\d+\.\d{4}$/);
      expect(Number(p.pricePerGramEur)).toBeGreaterThan(0);
    }
  });

  it('keeps each price within the jitter band of its base', async () => {
    const base = { gold: 60, silver: 1, platinum: 30, palladium: 40 };
    const prices = await new MockProvider({ seed: 7, jitter: 0.005, basePerGramEur: base }).fetch();
    for (const p of prices) {
      const b = base[p.metal];
      const v = Number(p.pricePerGramEur);
      expect(v).toBeGreaterThanOrEqual(b * 0.995 - 1e-6);
      expect(v).toBeLessThanOrEqual(b * 1.005 + 1e-6);
    }
  });
});

describe('JsonUrlProvider', () => {
  it('passes per-gram EUR values straight through, palladium optional', async () => {
    const { fetchImpl } = jsonFetch({
      goldEur: '62.30',
      silverEur: '0.75',
      platinumEur: 28.15,
      source: 'proxy',
    });
    const prices = await new JsonUrlProvider({ url: 'http://x', fetchImpl }).fetch();
    expect(prices).toHaveLength(3); // no palladium provided
    expect(prices.find((p) => p.metal === 'gold')?.pricePerGramEur).toBe('62.3000');
    expect(prices.every((p) => p.source === 'proxy')).toBe(true);
  });

  it('throws on non-ok and on non-numeric prices', async () => {
    const bad = jsonFetch({}, 503);
    await expect(
      new JsonUrlProvider({ url: 'http://x', fetchImpl: bad.fetchImpl }).fetch(),
    ).rejects.toThrow(/HTTP 503/);

    const nan = jsonFetch({ goldEur: 'abc', silverEur: '1', platinumEur: '1' });
    await expect(
      new JsonUrlProvider({ url: 'http://x', fetchImpl: nan.fetchImpl }).fetch(),
    ).rejects.toThrow(/non-positive/);
  });
});

describe('MetalPriceApiProvider', () => {
  it('inverts units_per_base rates and converts oz→g', async () => {
    // rate chosen so 1/rate = 3110.34768 €/oz → 100.0000 €/g.
    const rate = 1 / (100 * TROY_OUNCE_GRAMS);
    const { fetchImpl, calls } = jsonFetch({
      success: true,
      base: 'EUR',
      rates: { XAU: rate, XAG: rate, XPT: rate, XPD: rate },
    });
    const prices = await new MetalPriceApiProvider({ apiKey: 'k', fetchImpl }).fetch();
    expect(prices.find((p) => p.metal === 'gold')?.pricePerGramEur).toBe('100.0000');
    expect(prices.every((p) => p.source === 'metalpriceapi')).toBe(true);
    expect(calls[0]?.url).toContain('base=EUR');
    expect(calls[0]?.url).toContain('XAU');
  });

  it('throws on success:false', async () => {
    const { fetchImpl } = jsonFetch({ success: false, error: { message: 'bad key' } });
    await expect(new MetalPriceApiProvider({ apiKey: 'k', fetchImpl }).fetch()).rejects.toThrow(
      /error response/,
    );
  });

  it('requires an api key', () => {
    expect(() => new MetalPriceApiProvider({ apiKey: '' })).toThrow(/API_KEY/);
  });
});

describe('GoldApiProvider', () => {
  it('uses price_gram_24k directly and sends the access-token header per metal', async () => {
    const { fetchImpl, calls } = jsonFetch({ price_gram_24k: 62.3456, timestamp: 1_700_000_000 });
    const prices = await new GoldApiProvider({ apiKey: 'secret', fetchImpl }).fetch();
    expect(prices).toHaveLength(4);
    expect(prices[0]?.pricePerGramEur).toBe('62.3456');
    expect(prices.every((p) => p.source === 'goldapi')).toBe(true);
    expect(calls).toHaveLength(4); // one request per metal
    expect(calls[0]?.headers?.['x-access-token']).toBe('secret');
  });

  it('falls back to per-ounce price when price_gram_24k is absent', async () => {
    const { fetchImpl } = jsonFetch({ price: 100 * TROY_OUNCE_GRAMS });
    const prices = await new GoldApiProvider({ apiKey: 'k', fetchImpl }).fetch();
    expect(prices[0]?.pricePerGramEur).toBe('100.0000');
  });
});

describe('createMetalPriceProvider factory', () => {
  it('selects providers by kind and disables under-configured ones', () => {
    expect(createMetalPriceProvider({ provider: 'disabled' })).toBeNull();
    expect(createMetalPriceProvider({ provider: 'mock' })).toBeInstanceOf(MockProvider);
    expect(createMetalPriceProvider({ provider: 'json_url' })).toBeNull();
    expect(createMetalPriceProvider({ provider: 'json_url', jsonUrl: 'http://x' })).toBeInstanceOf(
      JsonUrlProvider,
    );
    expect(createMetalPriceProvider({ provider: 'metalpriceapi' })).toBeNull();
    expect(createMetalPriceProvider({ provider: 'metalpriceapi', apiKey: 'k' })).toBeInstanceOf(
      MetalPriceApiProvider,
    );
    expect(createMetalPriceProvider({ provider: 'goldapi' })).toBeNull();
    expect(createMetalPriceProvider({ provider: 'goldapi', apiKey: 'k' })).toBeInstanceOf(
      GoldApiProvider,
    );
  });
});
