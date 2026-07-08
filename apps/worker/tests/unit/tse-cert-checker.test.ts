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

describe('runTseCertCheck — happy path (far from expiry)', () => {
  it('updates the row and does NOT alert when expiry is > 30 days out', async () => {
    emitMock.mockClear();
    // SELECT existing → one row, no prior alert tier.
    const { db, execute } = makeDb([[{ id: 'c1', last_alert_tier: null }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(60)),
      now: NOW,
    });

    expect(outcome.status).toBe('CHECKED');
    expect(outcome.daysUntilExpiry).toBe(60);
    expect(outcome.tier).toBeNull();
    expect(outcome.alerted).toBe(false);
    expect(emitMock).not.toHaveBeenCalled();
    // SELECT + UPDATE (no INSERT — row existed).
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe('runTseCertCheck — alert path (enters a tier, never alerted)', () => {
  it('emits alert.tse_cert_expiry with the tier when entering T-7 from null', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[{ id: 'c1', last_alert_tier: null }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(5)), // 5 days → T-7
      now: NOW,
    });

    expect(outcome.alerted).toBe(true);
    expect(outcome.tier).toBe('T-7');
    expect(emitMock).toHaveBeenCalledTimes(1);
    const arg = emitMock.mock.calls[0]?.[1] as {
      eventType: string;
      entityTable: string;
      payload: { tier: string };
    };
    expect(arg.eventType).toBe('alert.tse_cert_expiry');
    expect(arg.entityTable).toBe('tse_clients');
    expect(arg.payload.tier).toBe('T-7');
  });
});

describe('runTseCertCheck — same tier already alerted (no re-spam)', () => {
  it('does NOT re-emit while still inside the same band', async () => {
    emitMock.mockClear();
    // Already alerted at T-7; still 5 days out → still T-7 → no escalation.
    const { db } = makeDb([[{ id: 'c1', last_alert_tier: 'T-7' }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(5)),
      now: NOW,
    });

    expect(outcome.tier).toBe('T-7');
    expect(outcome.alerted).toBe(false);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe('runTseCertCheck — escalation re-alerts', () => {
  it('re-emits when the cert crosses from T-30 into the more urgent T-7', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[{ id: 'c1', last_alert_tier: 'T-30' }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(5)), // 5 days → T-7 (> T-30)
      now: NOW,
    });

    expect(outcome.tier).toBe('T-7');
    expect(outcome.alerted).toBe(true);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('alerts when an already-warned cert finally EXPIRES (escalates past T-1)', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[{ id: 'c1', last_alert_tier: 'T-1' }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(-1)), // already expired
      now: NOW,
    });

    expect(outcome.tier).toBe('expired');
    expect(outcome.alerted).toBe(true);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });
});

describe('runTseCertCheck — certificate renewal resets the ladder (H3)', () => {
  it('re-alerts after renewal even though the ladder was latched at expired', async () => {
    emitMock.mockClear();
    log.info.mockClear();
    // Old cert had expired and we alerted at 'expired'. Operator installs a new
    // cert valid ~20 days out (still inside T-30). The ladder must reset so this
    // fresh warning fires; without the reset 'expired' outranks T-30 and the
    // monitor stays silent for the whole life of the new cert.
    const { db } = makeDb([
      [{ id: 'c1', last_alert_tier: 'expired', cert_valid_to: daysFromNow(-10) }],
    ]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(20)), // renewed → 20 days → T-30
      now: NOW,
    });

    expect(outcome.tier).toBe('T-30');
    expect(outcome.alerted).toBe(true);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      'tse cert checker: certificate renewed, resetting alert ladder',
      expect.objectContaining({ tssId: 'tss-1' }),
    );
  });

  it('renewal to a healthy cert clears the ladder without alerting', async () => {
    emitMock.mockClear();
    log.info.mockClear();
    const { db, execute } = makeDb([
      [{ id: 'c1', last_alert_tier: 'expired', cert_valid_to: daysFromNow(-10) }],
    ]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(365)), // renewed → healthy, > 30 days
      now: NOW,
    });

    expect(outcome.tier).toBeNull();
    expect(outcome.alerted).toBe(false);
    expect(emitMock).not.toHaveBeenCalled();
    // Reset persisted via the renewed branch: SELECT + UPDATE, no INSERT.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith(
      'tse cert checker: certificate renewed, resetting alert ladder',
      expect.objectContaining({ tssId: 'tss-1' }),
    );
  });

  it('does NOT treat an unchanged cert as a renewal (no false reset)', async () => {
    emitMock.mockClear();
    log.info.mockClear();
    // Same validity as recorded, already alerted at T-7, still 5 days out.
    const { db } = makeDb([[{ id: 'c1', last_alert_tier: 'T-7', cert_valid_to: daysFromNow(5) }]]);

    const outcome = await runTseCertCheck({
      db,
      log,
      fiskaly: CONFIGURED,
      client: makeClient(daysFromNow(5)),
      now: NOW,
    });

    expect(outcome.tier).toBe('T-7');
    expect(outcome.alerted).toBe(false); // same band, no re-spam
    expect(emitMock).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalledWith(
      'tse cert checker: certificate renewed, resetting alert ladder',
      expect.anything(),
    );
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
