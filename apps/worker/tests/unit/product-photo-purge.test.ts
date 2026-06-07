import { describe, expect, it, vi } from 'vitest';

import type { AnyDb } from '@warehouse14/db/client';

import {
  type PhotoFileStore,
  type PhotoPurgeCandidate,
  isPurgeEligible,
  photoFilenames,
  runProductPhotoPurge,
} from '../../src/jobs/product-photo-purge.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const NOW = new Date('2026-06-08T00:00:00Z');

function candidate(over: Partial<PhotoPurgeCandidate>): PhotoPurgeCandidate {
  return {
    id: 'p1',
    productId: 'prod1',
    productStatus: 'AVAILABLE',
    productExists: true,
    productArchivedAt: null,
    createdAt: NOW,
    ...over,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Pure selection logic
// ────────────────────────────────────────────────────────────────────────

describe('isPurgeEligible — which photos may be purged', () => {
  it('purges a SOLD product photo', () => {
    expect(isPurgeEligible(candidate({ productStatus: 'SOLD' }), NOW, 30)).toBe(true);
  });

  it('purges an ARCHIVED product photo (archived_at set)', () => {
    expect(
      isPurgeEligible(
        candidate({ productStatus: 'SOLD', productArchivedAt: new Date('2026-01-01') }),
        NOW,
        30,
      ),
    ).toBe(true);
    // archived even while AVAILABLE-shaped status would still purge:
    expect(
      isPurgeEligible(
        candidate({ productStatus: 'AVAILABLE', productArchivedAt: new Date('2026-01-01') }),
        NOW,
        30,
      ),
    ).toBe(true);
  });

  it('purges a photo whose product row is gone (dangling product_id)', () => {
    expect(
      isPurgeEligible(
        candidate({ productId: 'gone', productExists: false, productStatus: null }),
        NOW,
        30,
      ),
    ).toBe(true);
  });

  it('NEVER purges DRAFT / AVAILABLE / RESERVED product photos', () => {
    for (const status of ['DRAFT', 'AVAILABLE', 'RESERVED']) {
      expect(isPurgeEligible(candidate({ productStatus: status }), NOW, 30)).toBe(false);
    }
  });

  it('purges an orphan (NULL product) older than the retention window', () => {
    const old = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(
      isPurgeEligible(
        candidate({ productId: null, productExists: false, productStatus: null, createdAt: old }),
        NOW,
        30,
      ),
    ).toBe(true);
  });

  it('keeps a young orphan (within the retention window)', () => {
    const recent = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
    expect(
      isPurgeEligible(
        candidate({
          productId: null,
          productExists: false,
          productStatus: null,
          createdAt: recent,
        }),
        NOW,
        30,
      ),
    ).toBe(false);
  });
});

describe('photoFilenames — local store layout', () => {
  it('derives <id>.webp + <id>_thumb.webp', () => {
    expect(photoFilenames('abc-123')).toEqual(['abc-123.webp', 'abc-123_thumb.webp']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Orchestrator — bytes-freed accounting + tx delete
// ────────────────────────────────────────────────────────────────────────

/** A db double: first execute() = candidate SELECT; transaction() runs guard + delete. */
function makeDb(candidates: Record<string, unknown>[]): AnyDb {
  const execute = vi.fn().mockResolvedValueOnce(candidates);
  // Inside the tx: guard SELECT returns the row (still eligible), then DELETE.
  const txExecute = vi.fn().mockImplementation((arg: unknown) => {
    void arg;
    // Return the matching candidate for the guard SELECT; [] otherwise is fine
    // because the DELETE result isn't inspected.
    return Promise.resolve(candidates);
  });
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ execute: txExecute }),
  );
  return { execute, transaction } as unknown as AnyDb;
}

describe('runProductPhotoPurge — accounting', () => {
  it('sums freed bytes, deletes files+row, reports mbFreed', async () => {
    const soldRow = {
      id: 'ph1',
      product_id: 'prod1',
      product_status: 'SOLD',
      product_exists: true,
      product_archived_at: null,
      created_at: NOW.toISOString(),
    };
    const db = makeDb([soldRow]);

    const removed: string[] = [];
    const files: PhotoFileStore = {
      // 1 MiB full + 0.5 MiB thumb.
      sizeOf: vi.fn(async (f: string) => (f.endsWith('_thumb.webp') ? 512 * 1024 : 1024 * 1024)),
      remove: vi.fn(async (f: string) => {
        removed.push(f);
      }),
    };

    const summary = await runProductPhotoPurge({
      db,
      log,
      files,
      orphanRetentionDays: 30,
      batchLimit: 500,
      now: NOW,
    });

    expect(summary.photosPurged).toBe(1);
    expect(summary.bytesFreed).toBe(1024 * 1024 + 512 * 1024);
    expect(summary.mbFreed).toBe(1.5);
    expect(summary.fileErrors).toBe(0);
    expect(removed).toEqual(['ph1.webp', 'ph1_thumb.webp']);
  });

  it('counts a missing file as 0 bytes (ENOENT tolerated)', async () => {
    const row = {
      id: 'ph2',
      product_id: 'prod2',
      product_status: 'SOLD',
      product_exists: true,
      product_archived_at: null,
      created_at: NOW.toISOString(),
    };
    const db = makeDb([row]);
    const files: PhotoFileStore = {
      sizeOf: vi.fn(async () => null), // both files already gone
      remove: vi.fn(async () => {}),
    };

    const summary = await runProductPhotoPurge({
      db,
      log,
      files,
      orphanRetentionDays: 30,
      batchLimit: 500,
      now: NOW,
    });

    expect(summary.photosPurged).toBe(1);
    expect(summary.bytesFreed).toBe(0);
    expect(summary.fileErrors).toBe(0);
  });

  it('leaves the row LIVE (file error) when removal throws', async () => {
    const row = {
      id: 'ph3',
      product_id: 'prod3',
      product_status: 'SOLD',
      product_exists: true,
      product_archived_at: null,
      created_at: NOW.toISOString(),
    };
    const db = makeDb([row]);
    const txSpy = (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction;
    const files: PhotoFileStore = {
      sizeOf: vi.fn(async () => 1024),
      remove: vi.fn(async () => {
        throw new Error('EACCES');
      }),
    };

    const summary = await runProductPhotoPurge({
      db,
      log,
      files,
      orphanRetentionDays: 30,
      batchLimit: 500,
      now: NOW,
    });

    expect(summary.photosPurged).toBe(0);
    expect(summary.bytesFreed).toBe(0);
    expect(summary.fileErrors).toBe(1);
    // Row deletion tx must NOT run when file removal failed.
    expect(txSpy).not.toHaveBeenCalled();
  });

  it('returns an empty summary when nothing is eligible', async () => {
    const db = makeDb([]);
    const files: PhotoFileStore = { sizeOf: vi.fn(), remove: vi.fn() };
    const summary = await runProductPhotoPurge({
      db,
      log,
      files,
      orphanRetentionDays: 30,
      batchLimit: 500,
      now: NOW,
    });
    expect(summary).toEqual({ photosPurged: 0, bytesFreed: 0, mbFreed: 0, fileErrors: 0 });
    expect(files.remove).not.toHaveBeenCalled();
  });
});
