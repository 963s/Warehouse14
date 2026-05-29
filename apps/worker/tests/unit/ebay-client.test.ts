import { describe, expect, it } from 'vitest';

import { type EbayFetch, endEbayListing } from '../../src/lib/ebay-client.js';

function xmlFetch(
  body: string,
  status = 200,
): {
  fetchImpl: EbayFetch;
  calls: Array<{
    url: string;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  }>;
} {
  const calls: Array<{
    url: string;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  }> = [];
  const fetchImpl: EbayFetch = (url, init) => {
    calls.push({ url, headers: init?.headers, body: init?.body });
    return Promise.resolve(new Response(body, { status, headers: { 'content-type': 'text/xml' } }));
  };
  return { fetchImpl, calls };
}

describe('endEbayListing', () => {
  it('returns a mock success when no token is configured (no HTTP call)', async () => {
    const result = await endEbayListing('', 'SKU-1');
    expect(result).toEqual({ ended: true, mock: true, detail: expect.stringContaining('mock') });
  });

  it('calls EndItem with the token + item ref and parses a Success Ack', async () => {
    const { fetchImpl, calls } = xmlFetch('<EndItemResponse><Ack>Success</Ack></EndItemResponse>');
    const result = await endEbayListing('tok-123', 'ITEM-42', { fetchImpl });
    expect(result.ended).toBe(true);
    expect(result.mock).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers?.['X-EBAY-API-CALL-NAME']).toBe('EndItem');
    expect(calls[0]?.headers?.['X-EBAY-API-IAF-TOKEN']).toBe('tok-123');
    expect(calls[0]?.body).toContain('ITEM-42');
  });

  it('accepts a Warning Ack', async () => {
    const { fetchImpl } = xmlFetch('<EndItemResponse><Ack>Warning</Ack></EndItemResponse>');
    await expect(endEbayListing('t', 'x', { fetchImpl })).resolves.toMatchObject({ ended: true });
  });

  it('throws on an HTTP error', async () => {
    const { fetchImpl } = xmlFetch('error', 500);
    await expect(endEbayListing('t', 'x', { fetchImpl })).rejects.toThrow(/HTTP 500/);
  });

  it('throws on a Failure Ack', async () => {
    const { fetchImpl } = xmlFetch('<EndItemResponse><Ack>Failure</Ack></EndItemResponse>');
    await expect(endEbayListing('t', 'x', { fetchImpl })).rejects.toThrow(/non-success/);
  });
});
