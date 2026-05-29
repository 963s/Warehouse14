import { describe, expect, it } from 'vitest';

import {
  type FiskalyConfig,
  type FiskalyFetch,
  isFiskalyConfigured,
  isFiskalyError,
  pushCashPointClosing,
  triggerExport,
} from '../../src/lib/fiskaly-dsfinvk.js';

const CONFIGURED: FiskalyConfig = { apiKey: 'key', apiSecret: 'secret' };

function jsonFetch(
  body: unknown,
  status = 200,
): {
  fetchImpl: FiskalyFetch;
  calls: Array<{ url: string; headers?: Record<string, string>; body?: string }>;
} {
  const calls: Array<{ url: string; headers?: Record<string, string>; body?: string }> = [];
  const fetchImpl: FiskalyFetch = (url, init) => {
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

describe('isFiskalyConfigured', () => {
  it('requires both key and secret', () => {
    expect(isFiskalyConfigured(CONFIGURED)).toBe(true);
    expect(isFiskalyConfigured({ apiKey: '', apiSecret: 's' })).toBe(false);
    expect(isFiskalyConfigured({ apiKey: 'k', apiSecret: '' })).toBe(false);
  });
});

describe('pushCashPointClosing — unconfigured', () => {
  it('skips the HTTP call and returns { error } when credentials are empty', async () => {
    const { fetchImpl, calls } = jsonFetch({});
    const result = await pushCashPointClosing(
      { apiKey: '', apiSecret: '' },
      { business_day: '2026-05-29' },
      { fetchImpl },
    );
    expect(isFiskalyError(result)).toBe(true);
    expect(result).toEqual({ error: 'fiskaly not configured' });
    expect(calls.length).toBe(0);
  });
});

describe('pushCashPointClosing — configured (HTTP mocked)', () => {
  it('POSTs with Basic auth and returns the export id', async () => {
    const { fetchImpl, calls } = jsonFetch({ _id: 'cpc_123' });
    const result = await pushCashPointClosing(
      CONFIGURED,
      { business_day: '2026-05-29' },
      { fetchImpl },
    );
    expect(result).toEqual({ exportId: 'cpc_123' });
    expect(calls[0]?.url).toContain('/cash_point_closings');
    expect(calls[0]?.headers?.Authorization).toMatch(/^Basic /);
  });

  it('returns { error } on a non-2xx (fail-safe, never throws)', async () => {
    const { fetchImpl } = jsonFetch({}, 500);
    const result = await pushCashPointClosing(CONFIGURED, {}, { fetchImpl });
    expect(isFiskalyError(result)).toBe(true);
  });

  it('returns { error } on a network failure (never throws)', async () => {
    const fetchImpl: FiskalyFetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const result = await pushCashPointClosing(CONFIGURED, {}, { fetchImpl });
    expect(isFiskalyError(result)).toBe(true);
    expect((result as { error: string }).error).toContain('unreachable');
  });
});

describe('triggerExport', () => {
  it('skips and returns { error } when unconfigured', async () => {
    const { fetchImpl, calls } = jsonFetch({});
    const result = await triggerExport({ apiKey: '', apiSecret: '' }, 'cpc_1', { fetchImpl });
    expect(result).toEqual({ error: 'fiskaly not configured' });
    expect(calls.length).toBe(0);
  });

  it('POSTs to /exports and returns the download url', async () => {
    const { fetchImpl, calls } = jsonFetch({ download_url: 'https://dl.fiskaly.com/x.zip' });
    const result = await triggerExport(CONFIGURED, 'cpc_1', { fetchImpl });
    expect(result).toEqual({ downloadUrl: 'https://dl.fiskaly.com/x.zip' });
    expect(calls[0]?.url).toContain('/exports');
  });
});
