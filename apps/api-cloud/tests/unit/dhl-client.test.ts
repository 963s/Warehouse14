import { describe, expect, it } from 'vitest';

import {
  type DhlConfig,
  type DhlFetch,
  DhlNotConfiguredError,
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

describe('createDhlLabel without credentials', () => {
  const NO_CREDS = { user: '', signature: '', ekp: '' };

  it('REFUSES, and buys no label', async () => {
    // Diese Datei forderte vorher das Gegenteil: `toMatch(/^\d{20}$/)`, also
    // ausdrücklich eine Nummer im echten DHL-Format. Damit war die Gefahr als
    // Anforderung festgeschrieben. Auf der Produktion ist keine einzige
    // DHL-Variable gesetzt, und die Route setzte den Beleg daraufhin auf
    // SHIPPED: die Kundschaft hätte eine Sendungsnummer bekommen, die
    // nirgendwohin führt.
    await expect(
      createDhlLabel(NO_CREDS, { reference: 'abc-123-def', recipientAddress: 'Musterstr. 1' }),
    ).rejects.toThrow(DhlNotConfiguredError);
  });

  it('says in the refusal that nothing was bought and nothing was marked', async () => {
    // Der Bediener muss wissen, ob DHL bereits belastet hat.
    await expect(
      createDhlLabel(NO_CREDS, { reference: 'r', recipientAddress: 'a' }),
    ).rejects.toThrow(/kein Etikett gekauft/);
  });

  it('makes no HTTP call at all', async () => {
    const calls: string[] = [];
    const spy = (async () => {
      calls.push('called');
      return new Response('{}');
    }) as never;
    await createDhlLabel(NO_CREDS, { reference: 'r', recipientAddress: 'a' }, { fetchImpl: spy })
      .catch(() => undefined);
    expect(calls).toHaveLength(0);
  });

  it('only simulates when a caller asks for it EXPLICITLY, and marks it visibly', async () => {
    const result = await createDhlLabel(
      NO_CREDS,
      { reference: 'abc-123-def', recipientAddress: 'Musterstr. 1' },
      { allowSimulatedLabel: true },
    );
    expect(result.mock).toBe(true);
    // Der eigentliche Schutz: niemals das echte Format.
    expect(result.trackingNumber).toContain('SIMULATION');
    expect(result.trackingNumber).not.toMatch(/^\d{20}$/);
    expect(Buffer.from(result.labelBase64, 'base64').toString('utf8')).toContain('%PDF');
  });

  it('stays deterministic in simulation, so a test run twice matches', async () => {
    const once = await createDhlLabel(NO_CREDS, { reference: 'abc-123-def', recipientAddress: 'x' }, { allowSimulatedLabel: true });
    const again = await createDhlLabel(NO_CREDS, { reference: 'abc-123-def', recipientAddress: 'y' }, { allowSimulatedLabel: true });
    expect(again.trackingNumber).toBe(once.trackingNumber);
  });

  it('NO route enables the simulation', async () => {
    // Wenn jemand später `allowSimulatedLabel` in einer Route setzt, soll
    // dieser Test brechen und die Frage stellen, ob das wirklich gewollt ist.
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../../src/routes/', import.meta.url);
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(new URL(f, dir), 'utf8').includes('allowSimulatedLabel'));
    expect(offenders).toEqual([]);
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
