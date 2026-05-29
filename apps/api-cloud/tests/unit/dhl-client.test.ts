import { describe, expect, it } from 'vitest';

import {
  type DhlConfig,
  type DhlFetch,
  createDhlLabel,
  isDhlConfigured,
} from '../../src/lib/dhl-client.js';

const CONFIGURED: DhlConfig = { user: 'u', signature: 'sig', ekp: '1234567890' };

function jsonFetch(
  body: unknown,
  status = 200,
): {
  fetchImpl: DhlFetch;
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
  const fetchImpl: DhlFetch = (url, init) => {
    calls.push({ url, headers: init?.headers, body: init?.body });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetchImpl, calls };
}

describe('isDhlConfigured', () => {
  it('requires user + signature + ekp', () => {
    expect(isDhlConfigured(CONFIGURED)).toBe(true);
    expect(isDhlConfigured({ user: '', signature: 'x', ekp: 'y' })).toBe(false);
    expect(isDhlConfigured({ user: 'x', signature: '', ekp: 'y' })).toBe(false);
  });
});

describe('createDhlLabel — mock mode (no credentials)', () => {
  it('returns a deterministic tracking number + a valid base64 PDF, no HTTP call', async () => {
    const result = await createDhlLabel(
      { user: '', signature: '', ekp: '' },
      { reference: 'abc-123-def', recipientAddress: 'Musterstr. 1, 73614 Schorndorf' },
    );
    expect(result.mock).toBe(true);
    expect(result.trackingNumber).toMatch(/^\d{20}$/);
    // Same reference → same tracking number (deterministic).
    const again = await createDhlLabel(
      { user: '', signature: '', ekp: '' },
      {
        reference: 'abc-123-def',
        recipientAddress: 'x',
      },
    );
    expect(again.trackingNumber).toBe(result.trackingNumber);
    // Label decodes to a PDF.
    expect(Buffer.from(result.labelBase64, 'base64').toString('utf8')).toContain('%PDF');
  });
});

describe('createDhlLabel — configured (HTTP mocked)', () => {
  it('POSTs to /orders with basic auth and parses shipmentNo + label', async () => {
    const { fetchImpl, calls } = jsonFetch({
      items: [{ shipmentNo: '00340434999988887777', label: { b64: 'JVBERi0xLjQK' } }],
    });
    const result = await createDhlLabel(
      CONFIGURED,
      { reference: 'tx-1', recipientAddress: 'addr' },
      { fetchImpl },
    );
    expect(result.mock).toBe(false);
    expect(result.trackingNumber).toBe('00340434999988887777');
    expect(result.labelBase64).toBe('JVBERi0xLjQK');
    expect(calls[0]?.url).toContain('/orders');
    expect(calls[0]?.headers?.Authorization).toMatch(/^Basic /);
  });

  it('does not leak the recipient address into logs (address only in request body)', async () => {
    const { fetchImpl, calls } = jsonFetch({
      items: [{ shipmentNo: '1', label: { b64: 'x' } }],
    });
    await createDhlLabel(
      CONFIGURED,
      { reference: 't', recipientAddress: 'SECRET-ADDR' },
      { fetchImpl },
    );
    // The address is in the request body we send, never in headers/url.
    expect(calls[0]?.url).not.toContain('SECRET-ADDR');
    expect(JSON.stringify(calls[0]?.headers)).not.toContain('SECRET-ADDR');
  });

  it('throws on a non-ok response', async () => {
    const { fetchImpl } = jsonFetch({}, 422);
    await expect(
      createDhlLabel(CONFIGURED, { reference: 't', recipientAddress: 'a' }, { fetchImpl }),
    ).rejects.toThrow(/HTTP 422/);
  });

  it('throws when the response is missing shipmentNo / label', async () => {
    const { fetchImpl } = jsonFetch({ items: [{}] });
    await expect(
      createDhlLabel(CONFIGURED, { reference: 't', recipientAddress: 'a' }, { fetchImpl }),
    ).rejects.toThrow(/missing/);
  });
});
