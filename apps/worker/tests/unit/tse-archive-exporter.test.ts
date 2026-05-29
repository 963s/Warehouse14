import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { AnyDb } from '@warehouse14/db/client';

// Mock the append-only ledger emit so we can assert the critical alert fires
// on failure without a database.
const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));
vi.mock('@warehouse14/audit', () => ({ emit: emitMock }));

import {
  type FiskalyTseConfig,
  type R2Uploader,
  type TseExportClient,
  runTseArchiveExport,
} from '../../src/jobs/tse-archive-exporter.js';

// emit() returns a Promise in production; make the mock thenable so the
// `.catch(...)` guard in the failure path works.
emitMock.mockResolvedValue(undefined);

const ARCHIVE_DATE = '2026-05-28';
const CONFIGURED: FiskalyTseConfig = { apiKey: 'k', apiSecret: 's', tssId: 'tss-1' };
const BYTES = new Uint8Array([1, 2, 3, 4]);
const EXPECTED_SHA = createHash('sha256').update(BYTES).digest('hex');

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** db stub: returns the queued responses in call order, then []. */
function makeDb(responses: unknown[][]): { db: AnyDb; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn();
  for (const r of responses) execute.mockResolvedValueOnce(r);
  execute.mockResolvedValue([]);
  return { db: { execute } as unknown as AnyDb, execute };
}

function makeR2(): R2Uploader & { upload: ReturnType<typeof vi.fn> } {
  return { upload: vi.fn().mockResolvedValue({ key: 'k' }) };
}

function makeClient(overrides: Partial<TseExportClient> = {}): TseExportClient {
  return {
    createExport: vi.fn().mockResolvedValue({ exportId: 'exp-1' }),
    getExportStatus: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
    downloadExport: vi.fn().mockResolvedValue(BYTES),
    ...overrides,
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

describe('runTseArchiveExport — happy path', () => {
  it('exports, hashes, uploads to R2, and marks GENERATED', async () => {
    emitMock.mockClear();
    // SELECT existing → none; INSERT → row id; COUNT → 5; UPDATE → ignored.
    const { db, execute } = makeDb([[], [{ id: 'row-1' }], [{ count: 5 }]]);
    const client = makeClient();
    const r2 = makeR2();

    const outcome = await runTseArchiveExport({
      db,
      log,
      fiskaly: CONFIGURED,
      exportClient: client,
      r2,
      archiveDate: ARCHIVE_DATE,
      sleep: noSleep,
    });

    expect(outcome.status).toBe('GENERATED');
    expect(outcome.sha256).toBe(EXPECTED_SHA);
    expect(outcome.fileR2Key).toBe('tse-archives/tss-1/2026-05-28.tar');
    expect(outcome.transactionCount).toBe(5);
    expect(client.createExport).toHaveBeenCalledWith(CONFIGURED, {
      startDate: ARCHIVE_DATE,
      endDate: ARCHIVE_DATE,
    });
    expect(r2.upload).toHaveBeenCalledWith(
      'tse-archives/tss-1/2026-05-28.tar',
      BYTES,
      'application/x-tar',
    );
    // SELECT + INSERT + COUNT + UPDATE = 4 db round-trips.
    expect(execute).toHaveBeenCalledTimes(4);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('skips when the day is already GENERATED', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[{ id: 'row-1', status: 'GENERATED' }]]);
    const client = makeClient();

    const outcome = await runTseArchiveExport({
      db,
      log,
      fiskaly: CONFIGURED,
      exportClient: client,
      r2: makeR2(),
      archiveDate: ARCHIVE_DATE,
      sleep: noSleep,
    });

    expect(outcome.status).toBe('SKIPPED');
    expect(client.createExport).not.toHaveBeenCalled();
  });
});

describe('runTseArchiveExport — credentials gate', () => {
  it('records FAILED("not_configured") and does NOT alert when TSS id is empty', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[], [{ id: 'row-1' }]]); // SELECT, INSERT, then markFailed UPDATE
    const client = makeClient();

    const outcome = await runTseArchiveExport({
      db,
      log,
      fiskaly: { apiKey: 'k', apiSecret: 's', tssId: '' },
      exportClient: client,
      r2: makeR2(),
      archiveDate: ARCHIVE_DATE,
      sleep: noSleep,
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.reason).toBe('not_configured');
    expect(client.createExport).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe('runTseArchiveExport — failure paths emit the critical alert', () => {
  it('FAILS on poll timeout and emits alert.tse_critical_failure', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[], [{ id: 'row-1' }]]);
    const client = makeClient({
      getExportStatus: vi.fn().mockResolvedValue({ status: 'WORKING' }), // never completes
    });

    const outcome = await runTseArchiveExport({
      db,
      log,
      fiskaly: CONFIGURED,
      exportClient: client,
      r2: makeR2(),
      archiveDate: ARCHIVE_DATE,
      pollOptions: { maxAttempts: 3, intervalMs: 1 },
      sleep: noSleep,
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.reason).toMatch(/timed out/);
    expect(client.getExportStatus).toHaveBeenCalledTimes(3);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const arg = emitMock.mock.calls[0]?.[1] as { eventType: string; entityTable: string };
    expect(arg.eventType).toBe('alert.tse_critical_failure');
    expect(arg.entityTable).toBe('tse_daily_archives');
  });

  it('FAILS when the export enters an ERROR state and emits the alert', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[], [{ id: 'row-1' }]]);
    const client = makeClient({
      getExportStatus: vi.fn().mockResolvedValue({ status: 'ERROR' }),
    });

    const outcome = await runTseArchiveExport({
      db,
      log,
      fiskaly: CONFIGURED,
      exportClient: client,
      r2: makeR2(),
      archiveDate: ARCHIVE_DATE,
      pollOptions: { maxAttempts: 5, intervalMs: 1 },
      sleep: noSleep,
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.reason).toMatch(/ERROR state/);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('FAILS and alerts when the R2 upload throws', async () => {
    emitMock.mockClear();
    const { db } = makeDb([[], [{ id: 'row-1' }]]);
    const r2: R2Uploader = { upload: vi.fn().mockRejectedValue(new Error('R2 down')) };

    const outcome = await runTseArchiveExport({
      db,
      log,
      fiskaly: CONFIGURED,
      exportClient: makeClient(),
      r2,
      archiveDate: ARCHIVE_DATE,
      sleep: noSleep,
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.reason).toMatch(/R2 down/);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });
});
