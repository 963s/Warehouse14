/**
 * Phase-2 P2.6 — readQueue validates each persisted offline TSE entry.
 *
 * The offline queue is replayed to the fiscal API, so a corrupt entry must be
 * dropped here, not handed to the replay worker. `amountCents` is integer cents.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readQueue } from './tse-service.js';

const KEY = 'warehouse14.tse-queue.v1';

function stubLocalStorage(store: Map<string, string>): void {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
}

const valid = {
  intentionId: 'int-1',
  receiptLocator: 'RCP-1',
  amountCents: 1990,
  paymentKind: 'Bar',
  failedAt: '2026-06-16T10:00:00.000Z',
  reason: 'offline',
};

describe('tse-service readQueue validation', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    stubLocalStorage(store);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drops a corrupt entry (string amountCents) and keeps the valid ones', () => {
    store.set(
      KEY,
      JSON.stringify([valid, { ...valid, intentionId: 'int-2', amountCents: '2000' }]),
    );
    const out = readQueue();
    expect(out).toHaveLength(1);
    expect(out[0]?.intentionId).toBe('int-1');
  });

  it('returns [] for non-array JSON', () => {
    store.set(KEY, JSON.stringify({ not: 'an array' }));
    expect(readQueue()).toEqual([]);
  });

  it('returns [] for unparseable JSON', () => {
    store.set(KEY, '{');
    expect(readQueue()).toEqual([]);
  });
});
