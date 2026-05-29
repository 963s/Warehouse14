/**
 * tse_archive_exporter — KassenSichV §10 daily TSE archive (Phase 1.5 #I-2).
 *
 * Daily at 03:00: export the previous calendar day's complete set of TSE
 * transactions from the Fiskaly TSS as a §10-compliant TAR, hash it, store it in
 * Cloudflare R2, and record the evidence in `tse_daily_archives`.
 *
 * Lifecycle: ensure a GENERATING row for the day → (if credentials present)
 * create the Fiskaly export → poll until COMPLETED (bounded retries + timeout) →
 * download → SHA-256 → upload to R2 → flip the row to GENERATED with the
 * evidence + the day's signed-transaction count. Any failure flips the row to
 * FAILED, records the message, and emits the critical `alert.tse_critical_failure`
 * ledger event (append-only emit trigger / DND-bypass per memory.md #45).
 *
 * The Fiskaly export client and the R2 uploader are injected so the orchestrator
 * is unit-testable (happy path + poll timeout + failure) without network or S3.
 */

import { createHash } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sql as drizzleSql } from 'drizzle-orm';

import { emit } from '@warehouse14/audit';
import type { AnyDb } from '@warehouse14/db/client';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

// ────────────────────────────────────────────────────────────────────────
// Config + injected client interfaces
// ────────────────────────────────────────────────────────────────────────

export interface FiskalyTseConfig {
  apiKey: string;
  apiSecret: string;
  tssId: string;
}

export function isFiskalyTseConfigured(config: FiskalyTseConfig): boolean {
  return config.apiKey.length > 0 && config.apiSecret.length > 0 && config.tssId.length > 0;
}

/** Normalized export lifecycle state. */
export type ExportStatus = 'PENDING' | 'WORKING' | 'COMPLETED' | 'ERROR';

/** The Fiskaly TSS export surface this job depends on (injectable for tests). */
export interface TseExportClient {
  createExport(
    config: FiskalyTseConfig,
    range: { startDate: string; endDate: string },
  ): Promise<{ exportId: string }>;
  getExportStatus(config: FiskalyTseConfig, exportId: string): Promise<{ status: ExportStatus }>;
  downloadExport(config: FiskalyTseConfig, exportId: string): Promise<Uint8Array>;
}

/** Minimal byte uploader (R2 / S3-compatible). */
export interface R2Uploader {
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string }>;
}

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PollOptions {
  maxAttempts: number;
  intervalMs: number;
}

const DEFAULT_POLL: PollOptions = { maxAttempts: 30, intervalMs: 5_000 };

// ────────────────────────────────────────────────────────────────────────
// Orchestrator (pure control-flow; all I/O injected)
// ────────────────────────────────────────────────────────────────────────

export interface TseArchiveExportDeps {
  db: AnyDb;
  log: JobContext['log'];
  fiskaly: FiskalyTseConfig;
  exportClient: TseExportClient;
  r2: R2Uploader;
  /** Target calendar day, `YYYY-MM-DD`. */
  archiveDate: string;
  pollOptions?: PollOptions;
  /** Injectable wait (tests pass a no-op so the poll loop never really sleeps). */
  sleep?: (ms: number) => Promise<void>;
}

export interface TseArchiveExportOutcome {
  status: 'GENERATED' | 'FAILED' | 'SKIPPED';
  archiveDate: string;
  reason?: string;
  sha256?: string;
  fileR2Key?: string;
  transactionCount?: number;
}

async function markFailed(db: AnyDb, rowId: string, message: string): Promise<void> {
  await db.execute(drizzleSql`
    UPDATE tse_daily_archives
       SET status = 'FAILED', error_message = ${message}, completed_at = now()
     WHERE id = ${rowId}::uuid`);
}

async function countSignedTransactions(db: AnyDb, archiveDate: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(drizzleSql`
    SELECT COUNT(*)::int AS count
      FROM tse_transactions
     WHERE state = 'FINISHED'
       AND berlin_business_day(signed_at) = ${archiveDate}::date`);
  return rows[0]?.count ?? 0;
}

async function pollUntilComplete(
  client: TseExportClient,
  config: FiskalyTseConfig,
  exportId: string,
  poll: PollOptions,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= poll.maxAttempts; attempt += 1) {
    const { status } = await client.getExportStatus(config, exportId);
    if (status === 'COMPLETED') return;
    if (status === 'ERROR') {
      throw new Error(`fiskaly export ${exportId} entered ERROR state`);
    }
    if (attempt < poll.maxAttempts) await sleep(poll.intervalMs);
  }
  throw new Error(`fiskaly export ${exportId} timed out after ${poll.maxAttempts} poll attempts`);
}

export async function runTseArchiveExport(
  deps: TseArchiveExportDeps,
): Promise<TseArchiveExportOutcome> {
  const { db, log, fiskaly, exportClient, r2, archiveDate } = deps;
  const poll = deps.pollOptions ?? DEFAULT_POLL;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // 1 + 2. Ensure exactly one archive row for the day.
  const existing = await db.execute<{ id: string; status: string }>(drizzleSql`
    SELECT id, status::text AS status
      FROM tse_daily_archives
     WHERE archive_date = ${archiveDate}::date
     LIMIT 1`);
  const existingRow = existing[0];
  let rowId: string;
  if (existingRow) {
    if (existingRow.status === 'GENERATED') {
      log.info('tse archive already generated — skipping', { archiveDate });
      return { status: 'SKIPPED', archiveDate, reason: 'already_generated' };
    }
    rowId = existingRow.id; // retry a prior GENERATING/FAILED row.
  } else {
    const inserted = await db.execute<{ id: string }>(drizzleSql`
      INSERT INTO tse_daily_archives (archive_date, status)
      VALUES (${archiveDate}::date, 'GENERATING')
      RETURNING id`);
    const insertedRow = inserted[0];
    if (!insertedRow) throw new Error('tse_daily_archives INSERT returned no row');
    rowId = insertedRow.id;
  }

  // 3. Credentials gate — not a TSE failure, so no critical alert; just FAILED.
  if (!isFiskalyTseConfigured(fiskaly)) {
    const message = 'fiskaly not configured (FISKALY_API_KEY/FISKALY_API_SECRET/FISKALY_TSS_ID)';
    log.warn(message, { archiveDate });
    await markFailed(db, rowId, message);
    return { status: 'FAILED', archiveDate, reason: 'not_configured' };
  }

  try {
    // 4. Request the §10 export for the single-day range.
    const { exportId } = await exportClient.createExport(fiskaly, {
      startDate: archiveDate,
      endDate: archiveDate,
    });
    // 5. Poll until COMPLETED (bounded retries + timeout).
    await pollUntilComplete(exportClient, fiskaly, exportId, poll, sleep);
    // 6. Download the TAR bytes.
    const bytes = await exportClient.downloadExport(fiskaly, exportId);
    // 7. SHA-256 of the archive bytes.
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // 8. Upload to R2.
    const fileR2Key = `tse-archives/${fiskaly.tssId}/${archiveDate}.tar`;
    await r2.upload(fileR2Key, bytes, 'application/x-tar');
    // 9. Count the day's signed transactions + flip to GENERATED.
    const transactionCount = await countSignedTransactions(db, archiveDate);
    await db.execute(drizzleSql`
      UPDATE tse_daily_archives
         SET status = 'GENERATED',
             file_r2_key = ${fileR2Key},
             sha256 = ${sha256},
             transaction_count = ${transactionCount},
             error_message = NULL,
             completed_at = now()
       WHERE id = ${rowId}::uuid`);
    log.info('tse archive generated', { archiveDate, fileR2Key, sha256, transactionCount });
    return { status: 'GENERATED', archiveDate, sha256, fileR2Key, transactionCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('tse archive export failed', { archiveDate, error: message });
    await markFailed(db, rowId, message);
    // 10. Critical ledger alert (append-only emit; DND-bypass per memory.md #45).
    await emit(db, {
      eventType: 'alert.tse_critical_failure',
      entityTable: 'tse_daily_archives',
      entityId: rowId,
      payload: { archiveDate, error: message, stage: 'daily_export' },
    }).catch((emitErr: unknown) => {
      log.error('failed to emit tse_critical_failure alert', {
        archiveDate,
        error: emitErr instanceof Error ? emitErr.message : String(emitErr),
      });
    });
    return { status: 'FAILED', archiveDate, reason: message };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Default production clients (HTTP / S3) — replaced by mocks in tests.
// ────────────────────────────────────────────────────────────────────────

const FISKALY_TSE_BASE_URL = 'https://kassensichv.fiskaly.com/api/v2';
const HTTP_TIMEOUT_MS = 30_000;

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fiskalyAuth(config: FiskalyTseConfig): Promise<string> {
  const res = await httpFetch(`${FISKALY_TSE_BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: config.apiKey, api_secret: config.apiSecret }),
  });
  if (!res.ok) throw new Error(`fiskaly auth failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('fiskaly auth response missing access_token');
  return data.access_token;
}

function normalizeExportState(raw: string): ExportStatus {
  const s = raw.toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  if (s === 'ERROR' || s === 'FAILED' || s === 'CANCELLED') return 'ERROR';
  if (s === 'PENDING') return 'PENDING';
  return 'WORKING';
}

/** Real Fiskaly SIGN DE V2 TSS export client. Throws on any non-ok response. */
export function createDefaultExportClient(): TseExportClient {
  return {
    async createExport(config, range) {
      const token = await fiskalyAuth(config);
      const res = await httpFetch(`${FISKALY_TSE_BASE_URL}/tss/${config.tssId}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ start_date: range.startDate, end_date: range.endDate }),
      });
      if (!res.ok) throw new Error(`fiskaly create export failed: HTTP ${res.status}`);
      const data = (await res.json()) as { _id?: string; id?: string };
      const exportId = data._id ?? data.id;
      if (!exportId) throw new Error('fiskaly create export response missing id');
      return { exportId };
    },
    async getExportStatus(config, exportId) {
      const token = await fiskalyAuth(config);
      const res = await httpFetch(
        `${FISKALY_TSE_BASE_URL}/tss/${config.tssId}/exports/${exportId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`fiskaly export status failed: HTTP ${res.status}`);
      const data = (await res.json()) as { state?: string; status?: string };
      return { status: normalizeExportState(data.state ?? data.status ?? 'WORKING') };
    },
    async downloadExport(config, exportId) {
      const token = await fiskalyAuth(config);
      const res = await httpFetch(
        `${FISKALY_TSE_BASE_URL}/tss/${config.tssId}/exports/${exportId}/file`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`fiskaly export download failed: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** R2 (S3-compatible) byte uploader — mirrors apps/api-cloud/src/lib/r2.ts. */
export function createR2Uploader(config: R2Config): R2Uploader {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    async upload(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return { key };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Job factory
// ────────────────────────────────────────────────────────────────────────

export interface TseArchiveExporterJobOptions {
  fiskaly: FiskalyTseConfig;
  r2Config: R2Config;
  /** Injectable clients (tests); default to the real HTTP/S3 implementations. */
  exportClient?: TseExportClient;
  r2?: R2Uploader;
  pollOptions?: PollOptions;
}

export function tseArchiveExporterJob(opts: TseArchiveExporterJobOptions): JobDefinition {
  const exportClient = opts.exportClient ?? createDefaultExportClient();
  const r2 = opts.r2 ?? createR2Uploader(opts.r2Config);

  return {
    name: 'tse_archive_exporter',
    schedule: '0 3 * * *', // daily 03:00 (after End-of-Day + dsfinvk_daily_export)
    timeoutMs: 10 * 60_000,
    async run({ db, log }) {
      // Previous calendar day (Berlin), as YYYY-MM-DD.
      const dayRows = await db.execute<{ d: string }>(drizzleSql`
        SELECT (current_date - interval '1 day')::date::text AS d`);
      const archiveDate = dayRows[0]?.d;
      if (!archiveDate) {
        log.warn('could not resolve archive date — skipping');
        return { skipped: true, reason: 'no_archive_date' };
      }

      const outcome = await runTseArchiveExport({
        db,
        log,
        fiskaly: opts.fiskaly,
        exportClient,
        r2,
        archiveDate,
        ...(opts.pollOptions ? { pollOptions: opts.pollOptions } : {}),
      });
      return { ...outcome };
    },
  };
}
