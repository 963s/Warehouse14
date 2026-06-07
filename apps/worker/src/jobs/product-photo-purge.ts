/**
 * product_photo_purge — keeps server photo storage small.
 *
 * Product photos are TEMPORARY media (ADR-0005 / memory): the shop keeps a
 * SKU's photos only until the item leaves inventory. Once a product is SOLD or
 * ARCHIVED (`products.archived_at IS NOT NULL`) — or once a photo has sat
 * UNASSIGNED (orphan, `product_id IS NULL`) longer than the retention window —
 * its files can be removed and the `product_photos` row deleted. Photos are
 * media, NOT fiscal records, so the row deletion is safe (the inventory audit
 * trail on `products` is never touched).
 *
 * SAFETY — never delete photos of live inventory. A photo is purge-eligible
 * iff EXACTLY ONE of:
 *   • its product is SOLD, OR
 *   • its product is ARCHIVED (archived_at IS NOT NULL), OR
 *   • its product row is gone (dangling product_id — product deleted), OR
 *   • it is an ORPHAN (product_id IS NULL) older than `orphanRetentionDays`.
 * Photos whose product is DRAFT / AVAILABLE / RESERVED are NEVER touched, and
 * orphans younger than the retention window are left alone (still in workflow).
 *
 * Storage layout (mirrors the api-cloud local store): files live under
 * `PHOTOS_DIR` named `<photoId>.webp` (full) + `<photoId>_thumb.webp` (thumb).
 * The job stats each file for its byte size, unlinks it (ENOENT tolerated —
 * idempotent re-runs), then DELETEs the row inside a transaction. Files are
 * removed BEFORE the row so a crash mid-purge leaves the row LIVE for the next
 * run to retry — bytes never leak behind a deleted row.
 *
 * The result payload reports `bytesFreed` (+ a human `mbFreed`) per run.
 *
 * Cadence + retention are env-driven (PHOTO_PURGE_*). The PHOTOS_DIR + the
 * filesystem deleter/stat are injected so the selection + accounting logic is
 * unit-testable without a database or a disk.
 */

import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { sql as drizzleSql } from 'drizzle-orm';

import type { AnyDb } from '@warehouse14/db/client';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

// ────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested) — selection eligibility + filename derivation.
// ────────────────────────────────────────────────────────────────────────

/** Product lifecycle states whose photos may be purged. */
const PURGEABLE_PRODUCT_STATUSES = new Set(['SOLD']);
/** Product lifecycle states whose photos must NEVER be purged. */
export const PROTECTED_PRODUCT_STATUSES = ['DRAFT', 'AVAILABLE', 'RESERVED'] as const;

/**
 * The selection projection: one row per candidate photo, carrying just the
 * facts the pure predicate needs. `productStatus`/`productArchivedAt` are NULL
 * when the photo is an orphan OR its product row no longer exists.
 */
export interface PhotoPurgeCandidate {
  id: string;
  productId: string | null;
  /** products.status, or NULL if orphan / product deleted. */
  productStatus: string | null;
  /** TRUE when the product row exists (so we can tell orphan from dangling). */
  productExists: boolean;
  /** products.archived_at, or NULL. */
  productArchivedAt: Date | null;
  /** product_photos.created_at — used for the orphan retention window. */
  createdAt: Date;
}

/**
 * Decide whether a candidate photo is purge-eligible. PURE — no I/O.
 *
 * @param now            evaluation instant (injected for deterministic tests)
 * @param orphanRetentionDays  age past which a NULL-product orphan is purgeable
 */
export function isPurgeEligible(
  c: PhotoPurgeCandidate,
  now: Date,
  orphanRetentionDays: number,
): boolean {
  // 1. Product is SOLD → purge.
  if (
    c.productExists &&
    c.productStatus !== null &&
    PURGEABLE_PRODUCT_STATUSES.has(c.productStatus)
  ) {
    return true;
  }
  // 2. Product is ARCHIVED → purge.
  if (c.productExists && c.productArchivedAt !== null) {
    return true;
  }
  // 3. Dangling product_id (product row deleted) → purge.
  if (c.productId !== null && !c.productExists) {
    return true;
  }
  // 4. Orphan (no product) older than the retention window → purge.
  if (c.productId === null && !c.productExists) {
    const ageMs = now.getTime() - c.createdAt.getTime();
    const cutoffMs = orphanRetentionDays * 24 * 60 * 60 * 1000;
    return ageMs >= cutoffMs;
  }
  // Anything else (DRAFT / AVAILABLE / RESERVED, or a young orphan) → keep.
  return false;
}

/**
 * Derive the on-disk filenames for a photo id. The local store keeps a full
 * `<id>.webp` and a thumbnail `<id>_thumb.webp`.
 */
export function photoFilenames(photoId: string): readonly string[] {
  return [`${photoId}.webp`, `${photoId}_thumb.webp`];
}

// ────────────────────────────────────────────────────────────────────────
// Injected filesystem boundary (so the orchestrator is testable disk-free).
// ────────────────────────────────────────────────────────────────────────

export interface PhotoFileStore {
  /** Absolute size in bytes, or null if the file is absent. Never throws on ENOENT. */
  sizeOf(filename: string): Promise<number | null>;
  /** Remove the file. Resolves even if the file is already gone (ENOENT). */
  remove(filename: string): Promise<void>;
}

/**
 * Resolve the on-disk path for a `<id>.webp` / `<id>_thumb.webp` filename,
 * applying the SAME two-char id-prefix sharding the api-cloud local store uses
 * when it writes (`<PHOTOS_DIR>/<ab>/<id>.webp`). The shard is the first two
 * chars of the filename (= the id prefix), lower-cased.
 */
function shardedPath(photosDir: string, filename: string): string {
  const shard = (filename.slice(0, 2) || 'xx').toLowerCase();
  return join(photosDir, shard, filename);
}

/** Default store backed by `node:fs/promises`, rooted at `photosDir` (sharded). */
export function createPhotoFileStore(photosDir: string): PhotoFileStore {
  return {
    async sizeOf(filename) {
      try {
        const s = await stat(shardedPath(photosDir, filename));
        return s.size;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(filename) {
      try {
        await unlink(shardedPath(photosDir, filename));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────

export interface ProductPhotoPurgeDeps {
  db: AnyDb;
  log: JobContext['log'];
  files: PhotoFileStore;
  /** Age (days) past which an unassigned orphan photo is purgeable. */
  orphanRetentionDays: number;
  /** Max photos processed per run — bounds tx time; the rest rolls to next run. */
  batchLimit: number;
  /** Injected clock (tests). Defaults to `new Date()`. */
  now?: Date;
}

export interface ProductPhotoPurgeSummary {
  /** Photos whose files+row were removed this run. */
  photosPurged: number;
  /** Total bytes reclaimed from PHOTOS_DIR this run. */
  bytesFreed: number;
  /** Convenience: bytesFreed rounded to whole MiB (2 dp). */
  mbFreed: number;
  /** Files that couldn't be removed (non-ENOENT errors) — row left LIVE for retry. */
  fileErrors: number;
}

// `type` (not interface) so it satisfies db.execute<T>'s Record<string, unknown> constraint.
type CandidateRow = {
  id: string;
  product_id: string | null;
  product_status: string | null;
  product_exists: boolean;
  product_archived_at: Date | string | null;
  created_at: Date | string;
};

function toCandidate(r: CandidateRow): PhotoPurgeCandidate {
  return {
    id: r.id,
    productId: r.product_id,
    productStatus: r.product_status,
    productExists: r.product_exists,
    productArchivedAt: r.product_archived_at == null ? null : new Date(r.product_archived_at),
    createdAt: new Date(r.created_at),
  };
}

export async function runProductPhotoPurge(
  deps: ProductPhotoPurgeDeps,
): Promise<ProductPhotoPurgeSummary> {
  const { db, log, files, orphanRetentionDays, batchLimit } = deps;
  const now = deps.now ?? new Date();

  // Pull a bounded batch of candidate photos. We push the SOLD/ARCHIVED/dangling
  // predicate into SQL (cheap, index-friendly) and re-confirm with the pure
  // predicate in JS so the orphan-age cut uses the injected clock consistently.
  // LEFT JOIN so dangling product_ids (deleted products) surface with NULLs.
  const orphanCutoff = new Date(now.getTime() - orphanRetentionDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute<CandidateRow>(drizzleSql`
    SELECT  pp.id                              AS id,
            pp.product_id                      AS product_id,
            p.status::text                     AS product_status,
            (p.id IS NOT NULL)                 AS product_exists,
            p.archived_at                      AS product_archived_at,
            pp.created_at                      AS created_at
      FROM  product_photos pp
      LEFT JOIN products p ON p.id = pp.product_id
     WHERE  -- product SOLD
            p.status = 'SOLD'
            -- product ARCHIVED
        OR  p.archived_at IS NOT NULL
            -- dangling product_id (product row deleted)
        OR  (pp.product_id IS NOT NULL AND p.id IS NULL)
            -- aged orphan (never assigned to a product)
        OR  (pp.product_id IS NULL AND pp.created_at < ${orphanCutoff})
     ORDER BY pp.created_at ASC
     LIMIT ${batchLimit}
  `);

  if (rows.length === 0) {
    return { photosPurged: 0, bytesFreed: 0, mbFreed: 0, fileErrors: 0 };
  }

  let photosPurged = 0;
  let bytesFreed = 0;
  let fileErrors = 0;

  for (const raw of rows) {
    const candidate = toCandidate(raw);
    // Defence in depth: re-confirm with the pure predicate. The SQL filter and
    // this predicate must agree; this guards live inventory even if the query
    // is ever broadened by mistake.
    if (!isPurgeEligible(candidate, now, orphanRetentionDays)) {
      continue;
    }

    try {
      // 1. Size + remove the files FIRST. If a removal fails (non-ENOENT), we
      //    abort THIS photo and leave the row LIVE so the next run retries —
      //    bytes must be gone before the row disappears (no orphaned files).
      let freedThisPhoto = 0;
      for (const filename of photoFilenames(candidate.id)) {
        const size = await files.sizeOf(filename);
        await files.remove(filename);
        if (size != null) freedThisPhoto += size;
      }

      // 2. Delete the row inside a tx, re-checking eligibility under a row lock
      //    so a concurrent re-assign (orphan → product) or status change can't
      //    race us into deleting a now-live photo.
      const deleted = await db.transaction(async (tx) => {
        const guard = await tx.execute<CandidateRow>(drizzleSql`
          SELECT  pp.id                  AS id,
                  pp.product_id          AS product_id,
                  p.status::text         AS product_status,
                  (p.id IS NOT NULL)     AS product_exists,
                  p.archived_at          AS product_archived_at,
                  pp.created_at          AS created_at
            FROM  product_photos pp
            LEFT JOIN products p ON p.id = pp.product_id
           WHERE  pp.id = ${candidate.id}
             FOR UPDATE OF pp
        `);
        const fresh = guard[0];
        if (!fresh || !isPurgeEligible(toCandidate(fresh), now, orphanRetentionDays)) {
          return false;
        }
        await tx.execute(drizzleSql`DELETE FROM product_photos WHERE id = ${candidate.id}`);
        return true;
      });

      if (deleted) {
        photosPurged += 1;
        bytesFreed += freedThisPhoto;
      } else {
        log.debug('photo_purge: photo became ineligible under lock — skipped', {
          photoId: candidate.id,
        });
      }
    } catch (err) {
      fileErrors += 1;
      log.error('photo_purge: failed to purge photo — left LIVE for retry', {
        photoId: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: ProductPhotoPurgeSummary = {
    photosPurged,
    bytesFreed,
    mbFreed: Math.round((bytesFreed / (1024 * 1024)) * 100) / 100,
    fileErrors,
  };
  log.info('photo_purge: run complete', { ...summary });
  return summary;
}

// ────────────────────────────────────────────────────────────────────────
// Job factory
// ────────────────────────────────────────────────────────────────────────

export interface ProductPhotoPurgeJobOptions {
  /** Filesystem root for the photo store (PHOTOS_DIR). Empty → job is a no-op. */
  photosDir: string;
  /** Cron schedule. */
  schedule: string;
  /** Orphan (unassigned) photo retention in days. */
  orphanRetentionDays: number;
  /** Max photos per run. */
  batchLimit: number;
  /** Injectable store (tests); defaults to the real fs store. */
  files?: PhotoFileStore;
}

export function productPhotoPurgeJob(opts: ProductPhotoPurgeJobOptions): JobDefinition {
  const files = opts.files ?? (opts.photosDir ? createPhotoFileStore(opts.photosDir) : null);
  return {
    name: 'product_photo_purge',
    schedule: opts.schedule,
    timeoutMs: 10 * 60_000,
    async run({ db, log }) {
      if (!files) {
        // No PHOTOS_DIR configured (e.g. cloud-only R2 deployment) — nothing to
        // do on local disk. Records SUCCESS with an empty result.
        log.info('photo_purge: PHOTOS_DIR not configured — skipping');
        return {
          photosPurged: 0,
          bytesFreed: 0,
          mbFreed: 0,
          fileErrors: 0,
          skipped: 'no_photos_dir',
        };
      }
      const summary = await runProductPhotoPurge({
        db,
        log,
        files,
        orphanRetentionDays: opts.orphanRetentionDays,
        batchLimit: opts.batchLimit,
      });
      return { ...summary };
    },
  };
}
