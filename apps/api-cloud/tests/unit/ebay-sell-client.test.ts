import { describe, expect, it } from 'vitest';

import {
  type EbaySellConfig,
  type EbaySellFetch,
  isEbaySellConfigured,
  publishProductToEbay,
} from '../../src/lib/ebay/sell-client.js';

const CONFIGURED: EbaySellConfig = {
  oauthToken: 'tok-123',
  marketplaceId: 'EBAY_DE',
  baseUrl: 'https://api.sandbox.ebay.com',
};

const PRODUCT = {
  id: '11111111-1111-1111-1111-111111111111',
  sku: 'GM-1',
  name: 'Goldmünze',
  descriptionDe: 'Schöne Münze',
  condition: 'USED_EXCELLENT',
  listPriceEur: '1850.00',
  weightGrams: '31.10',
  photoUrls: ['https://api.warehouse14.de/api/photos/aaa/raw'],
};

function recordingFetch(responders: Array<(url: string, init?: { method?: string }) => Response>): {
  fetchImpl: EbaySellFetch;
  calls: Array<{ url: string; method?: string | undefined; body?: string | undefined }>;
} {
  const calls: Array<{ url: string; method?: string | undefined; body?: string | undefined }> = [];
  let i = 0;
  const fetchImpl: EbaySellFetch = (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body });
    const responder = responders[Math.min(i, responders.length - 1)];
    i += 1;
    return Promise.resolve(responder(url, init));
  };
  return { fetchImpl, calls };
}

describe('isEbaySellConfigured', () => {
  it('is false when the OAuth token is empty', () => {
    expect(isEbaySellConfigured({ ...CONFIGURED, oauthToken: '' })).toBe(false);
    expect(isEbaySellConfigured(CONFIGURED)).toBe(true);
  });
});

describe('publishProductToEbay — not configured (no token)', () => {
  it('returns a clear not-configured result and makes NO HTTP call', async () => {
    const { fetchImpl, calls } = recordingFetch([() => new Response('', { status: 200 })]);
    const result = await publishProductToEbay(
      { ...CONFIGURED, oauthToken: '' },
      PRODUCT,
      {},
      { fetchImpl },
    );
    expect(result.configured).toBe(false);
    expect(result.published).toBe(false);
    expect(result.detail).toMatch(/nicht konfiguriert|not configured/i);
    expect(calls).toHaveLength(0);
  });
});

describe('publishProductToEbay — configured (HTTP mocked)', () => {
  it('runs createOrReplaceInventoryItem → createOffer → publishOffer in order', async () => {
    const { fetchImpl, calls } = recordingFetch([
      // 1. PUT inventory_item/{sku} (eBay returns 204 No Content)
      () => new Response(null, { status: 204 }),
      // 2. POST offer
      () => new Response(JSON.stringify({ offerId: 'OFFER-99' }), { status: 201 }),
      // 3. POST offer/{offerId}/publish
      () => new Response(JSON.stringify({ listingId: 'LIST-77' }), { status: 200 }),
    ]);

    const result = await publishProductToEbay(
      CONFIGURED,
      PRODUCT,
      { merchantLocationKey: 'SCHORNDORF' },
      { fetchImpl },
    );

    expect(result.configured).toBe(true);
    expect(result.published).toBe(true);
    expect(result.offerId).toBe('OFFER-99');
    expect(result.listingId).toBe('LIST-77');

    expect(calls).toHaveLength(3);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toContain('/sell/inventory/v1/inventory_item/GM-1');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.url).toContain('/sell/inventory/v1/offer');
    expect(calls[2]?.method).toBe('POST');
    expect(calls[2]?.url).toContain('/sell/inventory/v1/offer/OFFER-99/publish');
  });

  it('sends the Bearer token + the EBAY_DE marketplace header', async () => {
    const headerSpy: Array<Record<string, string> | undefined> = [];
    const fetchImpl: EbaySellFetch = (_url, init) => {
      headerSpy.push(init?.headers);
      // inventory PUT (204), offer POST (201), publish POST (200)
      const status = headerSpy.length === 1 ? 204 : headerSpy.length === 2 ? 201 : 200;
      const body =
        headerSpy.length === 2
          ? JSON.stringify({ offerId: 'O1' })
          : headerSpy.length === 3
            ? JSON.stringify({ listingId: 'L1' })
            : null;
      return Promise.resolve(new Response(body, { status }));
    };
    await publishProductToEbay(CONFIGURED, PRODUCT, {}, { fetchImpl });
    expect(headerSpy[0]?.Authorization).toBe('Bearer tok-123');
    expect(headerSpy[0]?.['Content-Language']).toBe('de-DE');
    expect(headerSpy[1]?.Authorization).toBe('Bearer tok-123');
  });

  it('throws a clear error when createOffer fails', async () => {
    const { fetchImpl } = recordingFetch([
      () => new Response(null, { status: 204 }),
      () => new Response(JSON.stringify({ errors: [{ message: 'bad' }] }), { status: 400 }),
    ]);
    await expect(publishProductToEbay(CONFIGURED, PRODUCT, {}, { fetchImpl })).rejects.toThrow(
      /createOffer|HTTP 400/,
    );
  });
});
