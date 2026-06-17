/**
 * gdpr_cleanup — daily GDPR data-minimization sweep (Phase 1.5 #I-4 + #I-5).
 *
 *   Task A (#I-4): anonymize `audit_log.ip_address` on non-fiscal events older
 *     than 180 days (GDPR Art. 5(1)(c)). IPv4 → last octet zeroed; IPv6 → last
 *     80 bits zeroed. `ledger_events` IPs are untouched (fiscal record). The
 *     masking runs as a single native PostgreSQL UPDATE (set_masklen); the pure
 *     `anonymizeIp` helper below is the exported, unit-tested mirror of that SQL.
 *
 *   Task B (#I-5): purge KYC documents past `retention_until`. NO row is ever
 *     deleted (GwG evidence discipline) — the photo is removed from R2 and the
 *     PII columns are NULLed, leaving an audit shell stamped with who/when. A
 *     redacted `customer.kyc_purged` audit entry records each purge.
 *
 * The DB handle and the R2 deleter are injected so `runGdprCleanup` is unit
 * testable without a database or S3.
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { sql as drizzleSql } from 'drizzle-orm';

import { emitAudit } from '@warehouse14/audit';
import type { AnyDb } from '@warehouse14/db/client';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

// ────────────────────────────────────────────────────────────────────────
// Pure IP anonymization — mirror of the Task A native SQL (set_masklen).
// ────────────────────────────────────────────────────────────────────────

function anonymizeIpv4(ip: string): string {
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

/** Expand an IPv6 address to 8 leading-zero-stripped hextets. */
function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  let groups: string[];
  if (tail === undefined) {
    groups = headParts; // no '::' — already 8 groups
  } else {
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    groups = [
      ...headParts,
      ...Array.from({ length: Math.max(0, missing) }, () => '0'),
      ...tailParts,
    ];
  }
  return groups.map((g) => (g === '' ? '0' : Number.parseInt(g, 16).toString(16)));
}

/** Compress 8 hextets to canonical IPv6 (RFC 5952 longest-zero-run `::`). */
function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === '0') {
      if (curStart < 0) {
        curStart = i;
        curLen = 1;
      } else {
        curLen += 1;
      }
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return groups.join(':');
  const before = groups.slice(0, bestStart).join(':');
  const after = groups.slice(bestStart + bestLen).join(':');
  return `${before}::${after}`;
}

function anonymizeIpv6(ip: string): string {
  const groups = expandIpv6(ip);
  if (groups.length !== 8) return ip;
  // Keep the first 48 bits (3 hextets); zero the remaining 80 bits.
  const masked = [groups[0] ?? '0', groups[1] ?? '0', groups[2] ?? '0', '0', '0', '0', '0', '0'];
  return compressIpv6(masked);
}

/**
 * Anonymize an IP for GDPR minimization. IPv4 → last octet 0; IPv6 → last 80
 * bits 0. Idempotent (masking an already-masked IP returns it unchanged).
 */
export function anonymizeIp(ip: string): string {
  if (ip.includes(':')) return anonymizeIpv6(ip);
  if (ip.includes('.')) return anonymizeIpv4(ip);
  return ip;
}

// ────────────────────────────────────────────────────────────────────────
// Injected KYC image deleter — the SINGLE chokepoint for removing the local
// AES-256-GCM-encrypted `.enc` file (migration 0074 moved KYC images off the
// never-configured R2 to local encrypted storage). Any future on-demand
// right-to-erasure endpoint MUST go through a deleter like this so it can't
// forget the file. The path sharding MIRRORS apps/api-cloud/src/lib/kyc-store.ts
// (copied, not imported across the app boundary).
// ────────────────────────────────────────────────────────────────────────

export type KycImageDeleter = (storageKey: string) => Promise<void>;

/**
 * Delete the encrypted KYC file for a storage key. `force: true` makes a missing
 * file a SUCCESS (idempotent), but EACCES/EIO/etc. RETHROW so the purge fails +
 * retries — never strand a LIVE expired ID by flipping the row to a shell while
 * the encrypted bytes survive on disk. Layout MUST match kyc-store.ts:
 *   <KYC_PHOTOS_DIR>/<first-2-hex>/<storageKey>.enc
 */
export function createLocalKycDeleter(kycPhotosDir: string): KycImageDeleter {
  return async (storageKey: string) => {
    if (!kycPhotosDir) return; // doc-store-only deployment — nothing on disk
    const shard = (storageKey.slice(0, 2) || 'xx').toLowerCase();
    await rm(join(kycPhotosDir, shard, `${storageKey}.enc`), { force: true });
  };
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────

export interface GdprCleanupDeps {
  db: AnyDb;
  log: JobContext['log'];
  kycDelete: KycImageDeleter;
  /** Age (days) past which audit_log IPs are minimized. Default 180. */
  ipRetentionDays?: number;
}

export interface GdprCleanupSummary {
  ipAnonymized: number;
  kycPurged: number;
  kycErrors: number;
  kycReason?: 'none_expired' | 'no_owner';
}

// A `type` (not `interface`) so it satisfies the `Record<string, unknown>`
// constraint on `db.execute<T>` (interfaces lack an implicit index signature).
type ExpiredKycRow = {
  id: string;
  customer_id: string;
  document_photo_storage_key: string | null;
};

const IP_MASK_CASE = drizzleSql`CASE
      WHEN family(ip_address) = 4 THEN host(network(set_masklen(ip_address, 24)))::inet
      ELSE host(network(set_masklen(ip_address, 48)))::inet
    END`;

async function anonymizeOldAuditIps(db: AnyDb, retentionDays: number): Promise<number> {
  // Native masking; only touch rows that actually change (idempotent re-runs).
  const rows = await db.execute<{ id: string }>(drizzleSql`
    UPDATE audit_log
       SET ip_address = ${IP_MASK_CASE}
     WHERE ip_address IS NOT NULL
       AND created_at < now() - (${retentionDays} || ' days')::interval
       AND ip_address IS DISTINCT FROM ${IP_MASK_CASE}
    RETURNING id`);
  return rows.length;
}

async function purgeExpiredKyc(
  db: AnyDb,
  log: JobContext['log'],
  kycDelete: KycImageDeleter,
): Promise<{ purged: number; errors: number; reason?: 'none_expired' | 'no_owner' }> {
  const expired = await db.execute<ExpiredKycRow>(drizzleSql`
    SELECT id, customer_id, document_photo_storage_key
      FROM kyc_documents
     WHERE retention_until < now()::date
       AND purged_at IS NULL`);
  if (expired.length === 0) {
    return { purged: 0, errors: 0, reason: 'none_expired' };
  }

  // The Owner is the system purge actor (purged_by_user_id NOT NULL is required).
  const ownerRows = await db.execute<{ id: string }>(drizzleSql`
    SELECT id FROM users WHERE is_owner = TRUE AND soft_deleted_at IS NULL LIMIT 1`);
  const ownerId = ownerRows[0]?.id;
  if (!ownerId) {
    log.warn('gdpr: no Owner user — cannot stamp KYC purges, skipping', {
      expiredCount: expired.length,
    });
    return { purged: 0, errors: 0, reason: 'no_owner' };
  }

  let purged = 0;
  let errors = 0;
  for (const doc of expired) {
    try {
      // 1. Delete the encrypted file FIRST — if this fails we leave the row LIVE
      //    so the next run retries (the bytes must be gone before we mark purged).
      if (doc.document_photo_storage_key) {
        await kycDelete(doc.document_photo_storage_key);
      }
      // 2 + 3. Flip the row to a purged shell (PII nulled, purge stamped). The
      //    size_bytes is nulled too so the KYC store-usage SUM stays accurate.
      await db.execute(drizzleSql`
        UPDATE kyc_documents
           SET purged_at = now(),
               purged_by_user_id = ${ownerId}::uuid,
               document_number_encrypted = NULL,
               document_photo_storage_key = NULL,
               document_photo_sha256 = NULL,
               document_photo_size_bytes = NULL,
               updated_at = now()
         WHERE id = ${doc.id}::uuid`);
      // 4. Redacted audit trail — NO PII (UUIDs + reason only).
      await emitAudit(db, {
        eventType: 'customer.kyc_purged',
        actorUserId: ownerId,
        payload: {
          kycDocumentId: doc.id,
          customerId: doc.customer_id,
          reason: 'retention_expired',
        },
      });
      purged += 1;
    } catch (err) {
      errors += 1;
      log.error('gdpr: failed to purge KYC document — left LIVE for retry', {
        kycDocumentId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { purged, errors };
}

export async function runGdprCleanup(deps: GdprCleanupDeps): Promise<GdprCleanupSummary> {
  const { db, log, kycDelete } = deps;
  const ipRetentionDays = deps.ipRetentionDays ?? 180;

  // Task A — audit_log IP minimization.
  const ipAnonymized = await anonymizeOldAuditIps(db, ipRetentionDays);
  log.info('gdpr: audit_log IPs minimized', { ipAnonymized, ipRetentionDays });

  // Task B — KYC document purge.
  const kyc = await purgeExpiredKyc(db, log, kycDelete);
  log.info('gdpr: KYC purge complete', kyc);

  const summary: GdprCleanupSummary = {
    ipAnonymized,
    kycPurged: kyc.purged,
    kycErrors: kyc.errors,
    ...(kyc.reason ? { kycReason: kyc.reason } : {}),
  };
  return summary;
}

// ────────────────────────────────────────────────────────────────────────
// Job factory
// ────────────────────────────────────────────────────────────────────────

export interface GdprCleanupJobOptions {
  /** Local KYC store root (worker mounts the SAME volume as the API). */
  kycPhotosDir: string;
  /** Injectable deleter (tests); defaults to the local-file deleter. */
  kycDelete?: KycImageDeleter;
  ipRetentionDays?: number;
}

export function gdprCleanupJob(opts: GdprCleanupJobOptions): JobDefinition {
  const kycDelete = opts.kycDelete ?? createLocalKycDeleter(opts.kycPhotosDir);
  return {
    name: 'gdpr_cleanup',
    schedule: '0 4 * * *', // daily 04:00
    timeoutMs: 10 * 60_000,
    async run({ db, log }) {
      const summary = await runGdprCleanup({
        db,
        log,
        kycDelete,
        ...(opts.ipRetentionDays !== undefined ? { ipRetentionDays: opts.ipRetentionDays } : {}),
      });
      return { ...summary };
    },
  };
}
