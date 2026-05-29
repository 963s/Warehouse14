import { describe, expect, it, vi } from 'vitest';

import type { AnyDb } from '@warehouse14/db/client';

// Mock the append-only emit helpers so we can assert the critical ledger event
// fires without a database. Hoisted so the vi.mock factory can reference them.
const { emitMock, emitAuditMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  emitAuditMock: vi.fn(),
}));
vi.mock('@warehouse14/audit', () => ({
  emit: emitMock,
  emitAudit: emitAuditMock,
}));

import {
  DEFAULT_SMURFING_THRESHOLDS,
  type SmurfingThresholds,
  type WindowTxn,
  centsToEur,
  detectSmurfing,
  eurToCents,
  runSmurfingDetection,
} from '../../src/lib/smurfing.js';

const T = DEFAULT_SMURFING_THRESHOLDS;
const at = (iso: string): Date => new Date(iso);
const txn = (eur: string, iso: string): WindowTxn => ({
  totalCents: eurToCents(eur),
  occurredAt: at(iso),
});

describe('eurToCents / centsToEur', () => {
  it('parses NUMERIC(18,2) strings to bigint cents (no float)', () => {
    expect(eurToCents('1999.00')).toBe(199_900n);
    expect(eurToCents('2000.00')).toBe(200_000n);
    expect(eurToCents('0.5')).toBe(50n);
    expect(eurToCents('700')).toBe(70_000n);
    expect(eurToCents('-50.25')).toBe(-5025n);
  });
  it('round-trips back to euro strings', () => {
    expect(centsToEur(199_900n)).toBe('1999.00');
    expect(centsToEur(210_000n)).toBe('2100.00');
    expect(centsToEur(5n)).toBe('0.05');
    expect(centsToEur(-5025n)).toBe('-50.25');
  });
});

describe('detectSmurfing — count rule (near-threshold structuring)', () => {
  it('flags 3 sequential ~€1,999 buys inside the window', () => {
    const v = detectSmurfing({
      incoming: txn('1999.00', '2026-05-29T10:00:00Z'),
      priors: [txn('1999.00', '2026-05-28T10:00:00Z'), txn('1999.00', '2026-05-27T10:00:00Z')],
      thresholds: T,
    });
    expect(v.flagged).toBe(true);
    expect(v.reasons).toContain('NEAR_THRESHOLD_COUNT');
    expect(v.nearThresholdCount).toBe(3);
    expect(v.windowCount).toBe(3);
  });

  it('does NOT flag a single €1,999 buy with no history', () => {
    const v = detectSmurfing({
      incoming: txn('1999.00', '2026-05-29T10:00:00Z'),
      priors: [],
      thresholds: T,
    });
    expect(v.flagged).toBe(false);
    expect(v.reasons).toHaveLength(0);
  });
});

describe('detectSmurfing — aggregate rule (sum crosses €2,000)', () => {
  it('flags sub-limit buys whose windowed sum reaches the €2,000 KYC line', () => {
    const v = detectSmurfing({
      incoming: txn('700.00', '2026-05-29T10:00:00Z'),
      priors: [txn('800.00', '2026-05-28T10:00:00Z'), txn('600.00', '2026-05-27T10:00:00Z')],
      thresholds: T,
    });
    expect(v.flagged).toBe(true);
    expect(v.reasons).toContain('AGGREGATE_CROSSES_KYC_LIMIT');
    expect(v.aggregateCents).toBe(210_000n);
  });

  it('does NOT flag a single over-limit buy (ID already required, not structuring)', () => {
    const v = detectSmurfing({
      incoming: txn('2500.00', '2026-05-29T10:00:00Z'),
      priors: [],
      thresholds: T,
    });
    expect(v.flagged).toBe(false);
    expect(v.maxSingleCents).toBe(250_000n);
  });
});

describe('detectSmurfing — rolling window', () => {
  it('excludes prior buys older than the window from the aggregate', () => {
    const v = detectSmurfing({
      incoming: txn('700.00', '2026-05-29T10:00:00Z'),
      priors: [
        txn('800.00', '2026-05-18T10:00:00Z'), // 11 days prior — outside 7d
        txn('600.00', '2026-05-15T10:00:00Z'), // outside
      ],
      thresholds: T,
    });
    expect(v.windowCount).toBe(1); // only the incoming is in-window
    expect(v.flagged).toBe(false);
  });
});

describe('runSmurfingDetection — emits the critical ledger alert', () => {
  const makeDb = (priors: Array<{ total_eur: string; finalized_at: Date }>): AnyDb =>
    ({ execute: vi.fn().mockResolvedValue(priors) }) as unknown as AnyDb;

  const baseParams = {
    transactionId: '11111111-1111-1111-1111-111111111111',
    customerId: '22222222-2222-2222-2222-222222222222',
    totalEur: '1999.00',
    occurredAt: at('2026-05-29T10:00:00Z'),
    actorUserId: '33333333-3333-3333-3333-333333333333',
    deviceId: '44444444-4444-4444-4444-444444444444',
    ipAddress: '127.0.0.1',
    thresholds: T as SmurfingThresholds,
  };

  it('fires alert.smurfing_detected + audit on sequential near-€2,000 Ankäufe', async () => {
    emitMock.mockClear();
    emitAuditMock.mockClear();
    const db = makeDb([
      { total_eur: '1999.00', finalized_at: at('2026-05-28T10:00:00Z') },
      { total_eur: '1999.00', finalized_at: at('2026-05-27T10:00:00Z') },
    ]);

    const verdict = await runSmurfingDetection(db, { ...baseParams, direction: 'ANKAUF' });

    expect(verdict?.flagged).toBe(true);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const ledgerArg = emitMock.mock.calls[0]?.[1] as {
      eventType: string;
      entityTable: string;
      entityId: string;
    };
    expect(ledgerArg.eventType).toBe('alert.smurfing_detected');
    expect(ledgerArg.entityTable).toBe('transactions');
    expect(ledgerArg.entityId).toBe(baseParams.transactionId);
    expect(emitAuditMock).toHaveBeenCalledTimes(1);
    expect((emitAuditMock.mock.calls[0]?.[1] as { eventType: string }).eventType).toBe(
      'customer.smurfing_flagged',
    );
  });

  it('does NOT emit when the customer is clean (single small buy)', async () => {
    emitMock.mockClear();
    emitAuditMock.mockClear();
    const db = makeDb([]);
    const verdict = await runSmurfingDetection(db, {
      ...baseParams,
      direction: 'ANKAUF',
      totalEur: '300.00',
    });
    expect(verdict?.flagged).toBe(false);
    expect(emitMock).not.toHaveBeenCalled();
    expect(emitAuditMock).not.toHaveBeenCalled();
  });

  it('skips entirely for VERKAUF (V1 scope is ANKAUF)', async () => {
    emitMock.mockClear();
    const db = makeDb([]);
    const verdict = await runSmurfingDetection(db, { ...baseParams, direction: 'VERKAUF' });
    expect(verdict).toBeNull();
    expect(emitMock).not.toHaveBeenCalled();
  });
});
