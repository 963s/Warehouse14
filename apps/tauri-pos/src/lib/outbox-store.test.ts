/**
 * Phase 6.1 — the Compliance-Inbox half of the offline outbox store.
 *
 * These tests run the store's REAL SQL (and the REAL `0001_outbox.sql` migration
 * DDL) against a genuine in-memory SQLite via `node:sqlite` — not a fake that
 * re-implements the semantics. The safety-critical property proven here is that
 * `discardConflict` / `retryConflict` are scoped to `status='conflict'` and can
 * therefore NEVER mutate a pending, in-flight, succeeded or fiscal row.
 *
 * The only shim maps tauri-plugin-sql's `execute`/`select` + `$N` placeholders
 * onto node:sqlite's `run`/`all` + `?` placeholders. Every `$N` in these methods
 * appears once, in ascending order, so `$N → ?` positional substitution is exact.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

import type { OutboxRecord } from '@warehouse14/api-client';

import { TauriSqlOutboxStore } from './outbox-store.js';

const MIGRATION_URL = new URL('../../src-tauri/migrations/0001_outbox.sql', import.meta.url);

/** A tauri-plugin-sql-shaped adapter backed by a real node:sqlite database. */
function makeFakeDb(): { execute: unknown; select: unknown } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(MIGRATION_URL, 'utf8')); // the REAL migration
  const toQ = (sql: string): string => sql.replace(/\$\d+/g, '?');
  return {
    async execute(sql: string, params: unknown[] = []) {
      sqlite.prepare(toQ(sql)).run(...(params as never[]));
      return { rowsAffected: 1, lastInsertId: 0 };
    },
    async select(sql: string, params: unknown[] = []) {
      return sqlite.prepare(toQ(sql)).all(...(params as never[]));
    },
  };
}

const h = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeDb> | null }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => h.current } }));

function rec(key: string): OutboxRecord {
  return {
    idempotencyKey: key,
    traceId: `trace-${key}`,
    method: 'POST',
    path: '/api/transactions/finalize',
    url: 'https://api.warehouse14.de/api/transactions/finalize',
    headers: {},
    body: { key },
    enqueuedAt: 1_700_000_000_000,
    gobdRelevant: true,
    callerSuppliedKey: true,
    deviceId: 'device-1',
  };
}

describe('TauriSqlOutboxStore — Compliance Inbox', () => {
  let store: TauriSqlOutboxStore;

  beforeEach(() => {
    h.current = makeFakeDb();
    store = new TauriSqlOutboxStore();
  });
  afterEach(() => {
    h.current = null;
    vi.clearAllMocks();
  });

  it('lists only conflict rows, oldest-first (FIFO)', async () => {
    await store.enqueue(rec('a'));
    await store.enqueue(rec('b'));
    await store.enqueue(rec('c'));
    // c and a diverge; b stays pending. (order of marking is not enqueue order)
    await store.markConflict('c', { message: 'later', serverCode: 'CONFLICT' });
    await store.markConflict('a', { message: 'earlier', serverCode: 'ALREADY_FINALIZED' });

    const conflicts = await store.listConflicts();
    expect(conflicts.map((c) => c.idempotencyKey)).toEqual(['a', 'c']); // monotonic_seq order
    expect(conflicts[0]?.serverCode).toBe('ALREADY_FINALIZED');
    expect(conflicts[0]?.gobdRelevant).toBe(true);
    expect((await store.getStats()).conflict).toBe(2);
    expect((await store.getStats()).pending).toBe(1);
  });

  it('discardConflict closes the conflict without touching the pending rows', async () => {
    await store.enqueue(rec('a'));
    await store.enqueue(rec('b'));
    await store.markConflict('b', { message: 'divergence', serverCode: 'CONFLICT' });

    await store.discardConflict('b');

    expect(await store.listConflicts()).toEqual([]);
    expect((await store.getStats()).conflict).toBe(0);
    // a is untouched — still pending, still drainable.
    expect((await store.listPending()).map((r) => r.idempotencyKey)).toEqual(['a']);
    // b is terminally closed — NOT resurrected as pending.
    expect((await store.getStats()).pending).toBe(1);
  });

  it('retryConflict re-queues the conflict as pending at its original position', async () => {
    await store.enqueue(rec('a'));
    await store.markConflict('a', { message: 'transient?', serverCode: 'CONFLICT' });
    expect((await store.getStats()).pending).toBe(0);

    await store.retryConflict('a');

    expect(await store.listConflicts()).toEqual([]);
    expect((await store.listPending()).map((r) => r.idempotencyKey)).toEqual(['a']);
  });

  it('SAFETY: discard/retry are no-ops on a non-conflict row', async () => {
    await store.enqueue(rec('a')); // pending
    await store.enqueue(rec('done'));
    await store.markSucceeded('done', { ok: true });

    // Neither resolve action may mutate a pending or succeeded row.
    await store.discardConflict('a');
    await store.retryConflict('a');
    await store.discardConflict('done');
    await store.retryConflict('done');

    expect((await store.listPending()).map((r) => r.idempotencyKey)).toEqual(['a']); // a untouched
    expect((await store.getStats()).pending).toBe(1); // 'done' not resurrected
    expect((await store.getStats()).conflict).toBe(0);
  });
});
