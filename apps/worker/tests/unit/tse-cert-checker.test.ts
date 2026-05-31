import { describe, expect, it, vi } from 'vitest';

import type { AnyDb } from '@warehouse14/db/client';

// Mock the append-only ledger emit so we can assert the alert without a DB.
const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));
vi.mock('@warehouse14/audit', () => ({ emit: emitMock }));
emitMock.mockResolvedValue(undefined);

import {
  type FiskalyTseClient,
  type FiskalyTseConfig,
  runTseCertCheck,
} from '../../src/jobs/tse-cert-checker.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const CONFIGURED: FiskalyTseConfig = { apiKey: 'k', apiSecret: 's', tssId: 'tss-1' };

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** db stub: returns the queued responses in call order, then []. */
function makeDb(responses: unknown[][]): { db: AnyDb; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn();
  for (const r of responses) execute.mockResolvedValueOnce(r);
  execute.mockResolvedValue([]);
  return { db: { execute } as unknown as AnyDb, execute };
}

/** Fiskaly client mock returning a fixed certificate expiry. */
function makeClient(certValidTo: Date): FiskalyTseClient {
  return { getTssInfo: vi.fn().mockResolvedValue({ certValidTo, description: 'POS TSS' }) };
}

const daysFromNow = (d: number): Date => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe('runTseCertCheck — happy path (far from expiry)', () => {
  it('updates the row and does NOT alert when expiry is > 30 days out', async () => {
    emitMock.mockClear();
    // SELECT existing → one row, no prior alert.
    const { db, execute } = makeDb([[{ id: 'c1', alert_sent_at: null }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(60)),
      now: NOW,
    });

    expect(outcome.status).toBe('CHECKED');
    expect(outcome.daysUntilExpiry).toBe(60);
    expect(outcome.alerted).toBe(false);
    expect(emitMock).not.toHaveBeenCalled();
    // SELECT + UPDATE (no INSERT — row existed).
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe('runTseCertCheck — alert path (near expiry, never alerted)', () => {
  it('emits alert.tse_cert_expiry and stamps alert_sent_at', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[{ id: 'c1', alert_sent_at: null }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(10)),
      now: NOW,
    });

    expect(outcome.alerted).toBe(true);
    expect(outcome.daysUntilExpiry).toBe(10);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const arg = emitMock.mock.calls[0]?.[1] as { eventType: string; entityTable: string };
    expect(arg.eventType).toBe('alert.tse_cert_expiry');
    expect(arg.entityTable).toBe('tse_clients');
  });
});

describe('runTseCertCheck — alert throttling (alerted 12h ago)', () => {
  it('does NOT re-emit within the 24h cooldown', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[{ id: 'c1', alert_sent_at: hoursAgo(12) }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(10)),
      now: NOW,
    });

    expect(outcome.alerted).toBe(false);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe('runTseCertCheck — cooldown reset (alerted 25h ago)', () => {
  it('re-emits the alert once the 24h cooldown has elapsed', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[{ id: 'c1', alert_sent_at: hoursAgo(25) }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(10)),
      now: NOW,
    });

    expect(outcome.alerted).toBe(true);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });
});

describe('runTseCertCheck — edge cases', () => {
  it('inserts a fresh row when the TSS is seen for the first time, then alerts if near', async () => {
    emitMock.mockClear();
    // SELECT → none; INSERT → new id; UPDATE follows.
    const { db, execute } = makeDb([[], [{ id: 'new-1' }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(5)),
      now: NOW,
    });

    expect(outcome.alerted).toBe(true);
    expect(emitMock).toHaveBeenCalledTimes(1);
    // SELECT + INSERT + UPDATE.
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('skips when Fiskaly is not configured (no TSS id)', async () => {
    emitMock.mockClear();
    const { db, execute } = makeDb([]);
    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: { apiKey: 'k', apiSecret: 's', tssId: '' },
      client: makeClient(daysFromNow(5)),
      now: NOW,
    });
    expect(outcome.status).toBe('SKIPPED');
    expect(execute).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('reports FAILED when the Fiskaly lookup throws (never crashes)', async () => {
    emitMock.mockClear();
    const { db } = makeDb([]);
    const client: FiskalyTseClient = {
      getTssInfo: vi.fn().mockRejectedValue(new Error('fiskaly down')),
    };
    const outcome = await runTseCertCheck({ db, log, fiskaly: CONFIGURED, client, now: NOW });
    expect(outcome.status).toBe('FAILED');
    expect(outcome.reason).toMatch(/fiskaly down/);
    expect(emitMock).not.toHaveBeenCalled();
  });
});
