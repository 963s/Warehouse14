import { describe, expect, it } from 'vitest';

import { EbayNotConfiguredError, type EbayFetch, endEbayListing } from '../../src/lib/ebay-client.js';

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
  it('REFUSES without a token, and never claims the listing was ended', async () => {
    // Diese Datei forderte vorher `{ ended: true, mock: true }`, also die
    // Meldung „beendet", ohne eBay je gefragt zu haben. Der Abgleich schrieb
    // daraufhin ONLINE → BEENDET. Das Inserat blieb online, das Stück galt im
    // Haus als vom Markt, und weil jedes Stück ein Einzelstück ist, konnte es
    // ein zweites Mal verkauft werden.
    await expect(endEbayListing('', 'SKU-1')).rejects.toThrow(EbayNotConfiguredError);
  });

  it('says in the refusal that the listing is still online', async () => {
    await expect(endEbayListing('', 'SKU-1')).rejects.toThrow(/weiterhin online/);
  });

  it('makes no HTTP call without a token', async () => {
    const { fetchImpl, calls } = xmlFetch('<EndItemResponse><Ack>Success</Ack></EndItemResponse>');
    await endEbayListing('', 'SKU-1', { fetchImpl }).catch(() => undefined);
    expect(calls).toHaveLength(0);
  });

  it('offers no way to simulate an ended listing', async () => {
    // Anders als beim Versandetikett gibt es hier bewusst KEIN Übungs-Flag.
    // Ein Etikett kann man drucken und wegwerfen; ein Inserat ist entweder vom
    // Markt oder nicht, und eine Simulation davon wäre schlicht eine Lüge über
    // den Zustand einer fremden Plattform.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/lib/ebay-client.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/allowSimulated|mock:\s*true/);
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
