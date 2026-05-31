/**
 * tse_cert_checker — TSE/TSS certificate-expiry monitor (KassenSichV, #I-1).
 *
 * Daily, the job queries the Fiskaly SIGN DE V2 API for the configured TSS's
 * certificate validity, records it in `tse_clients`, and — when the certificate
 * is within 30 days of expiry — emits the critical `alert.tse_cert_expiry`
 * ledger event (an expired TSE certificate invalidates the register's legality).
 *
 * The alert is throttled: at most one per 24h via the `alert_sent_at` stamp, so
 * the operator isn't spammed every day for the whole final month.
 *
 * The Fiskaly client is injected so `runTseCertCheck` is unit-testable without
 * the network; the job is fail-safe (an unconfigured TSS or an API error logs
 * and the run reports a skip/failure — it never crashes the worker).
 */

import { sql as drizzleSql } from 'drizzle-orm';

import { emit } from '@warehouse14/audit';
import type { AnyDb } from '@warehouse14/db/client';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

// ────────────────────────────────────────────────────────────────────────
// Config + injected client
// ────────────────────────────────────────────────────────────────────────

export interface FiskalyTseConfig {
  apiKey: string;
  apiSecret: string;
  tssId: string;
}

export function isFiskalyTseConfigured(config: FiskalyTseConfig): boolean {
  return config.apiKey.length > 0 && config.apiSecret.length > 0 && config.tssId.length > 0;
}

export interface TssCertInfo {
  /** Certificate validity end. */
  certValidTo: Date;
  /** Human label for the TSS (falls back to the tssId). */
  description: string;
}

/** The slice of the Fiskaly TSS API the checker depends on (injectable). */
export interface FiskalyTseClient {
  getTssInfo(config: FiskalyTseConfig, tssId: string): Promise<TssCertInfo>;
}

export interface TseCertCheckOptions {
  /** Days-to-expiry at/below which an alert fires. Default 30. */
  thresholdDays?: number;
  /** Hours between repeated alerts for the same TSS. Default 24. */
  cooldownHours?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_THRESHOLD_DAYS = 30;
const DEFAULT_COOLDOWN_HOURS = 24;

// ────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────

export interface TseCertCheckDeps extends TseCertCheckOptions {
  db: AnyDb;
  log: JobContext['log'];
  fiskaly: FiskalyTseConfig;
  client: FiskalyTseClient;
  /** Injectable clock (tests). Defaults to `new Date()`. */
  now?: Date;
}

export interface TseCertCheckOutcome {
  status: 'CHECKED' | 'SKIPPED' | 'FAILED';
  tssId: string;
  certValidTo?: string;
  daysUntilExpiry?: number;
  alerted?: boolean;
  reason?: string;
}

// A `type` (not `interface`) so it satisfies the `Record<string, unknown>`
// constraint on `db.execute<T>` (interfaces lack an implicit index signature).
type TseClientLookupRow = {
  id: string;
  alert_sent_at: Date | null;
};

export async function runTseCertCheck(deps: TseCertCheckDeps): Promise<TseCertCheckOutcome> {
  const { db, log, fiskaly, client } = deps;
  const now = deps.now ?? new Date();
  const thresholdDays = deps.thresholdDays ?? DEFAULT_THRESHOLD_DAYS;
  const cooldownMs = (deps.cooldownHours ?? DEFAULT_COOLDOWN_HOURS) * HOUR_MS;
  const tssId = fiskaly.tssId;

  if (!isFiskalyTseConfigured(fiskaly)) {
    log.warn('tse cert checker: fiskaly not configured — skipping', { tssId });
    return { status: 'SKIPPED', tssId: tssId || '(unset)', reason: 'not_configured' };
  }

  let info: TssCertInfo;
  try {
    info = await client.getTssInfo(fiskaly, tssId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('tse cert checker: Fiskaly TSS lookup failed', { tssId, error: message });
    return { status: 'FAILED', tssId, reason: message };
  }

  const certValidToIso = info.certValidTo.toISOString();
  const nowIso = now.toISOString();
  const daysUntilExpiry = Math.floor((info.certValidTo.getTime() - now.getTime()) / DAY_MS);

  // Upsert the row for this TSS.
  const existing = await db.execute<TseClientLookupRow>(drizzleSql`
    SELECT id, alert_sent_at FROM tse_clients WHERE tss_id = ${tssId} LIMIT 1`);
  const existingRow = existing[0];

  let rowId: string;
  let lastAlert: Date | null;
  if (existingRow) {
    rowId = existingRow.id;
    lastAlert = existingRow.alert_sent_at;
  } else {
    const inserted = await db.execute<{ id: string }>(drizzleSql`
      INSERT INTO tse_clients (tss_id, description, cert_valid_to, last_checked)
      VALUES (${tssId}, ${info.description}, ${certValidToIso}::timestamptz, ${nowIso}::timestamptz)
      RETURNING id`);
    const insertedRow = inserted[0];
    if (!insertedRow) throw new Error('tse_clients INSERT returned no row');
    rowId = insertedRow.id;
    lastAlert = null;
  }

  // Decide whether to alert: within threshold AND outside the cooldown window.
  const withinThreshold = daysUntilExpiry <= thresholdDays;
  const cooldownElapsed = lastAlert === null || now.getTime() - lastAlert.getTime() >= cooldownMs;
  const alerted = withinThreshold && cooldownElapsed;

  // Refresh the row (+ stamp alert_sent_at when we alert).
  if (alerted) {
    await db.execute(drizzleSql`
      UPDATE tse_clients
         SET description = ${info.description},
             cert_valid_to = ${certValidToIso}::timestamptz,
             last_checked = ${nowIso}::timestamptz,
             alert_sent_at = ${nowIso}::timestamptz
       WHERE id = ${rowId}::uuid`);
  } else {
    await db.execute(drizzleSql`
      UPDATE tse_clients
         SET description = ${info.description},
             cert_valid_to = ${certValidToIso}::timestamptz,
             last_checked = ${nowIso}::timestamptz
       WHERE id = ${rowId}::uuid`);
  }

  if (alerted) {
    // Critical ledger alert (append-only emit; DND-bypass per memory.md #45).
    await emit(db, {
      eventType: 'alert.tse_cert_expiry',
      entityTable: 'tse_clients',
      entityId: rowId,
      payload: { tssId, certValidTo: certValidToIso, daysUntilExpiry, thresholdDays },
    });
    log.error('tse cert checker: certificate near expiry — alert emitted', {
      tssId,
      daysUntilExpiry,
      certValidTo: certValidToIso,
    });
  } else {
    log.info('tse cert checker: certificate checked', {
      tssId,
      daysUntilExpiry,
      withinThreshold,
      alertThrottled: withinThreshold && !cooldownElapsed,
    });
  }

  return { status: 'CHECKED', tssId, certValidTo: certValidToIso, daysUntilExpiry, alerted };
}

// ────────────────────────────────────────────────────────────────────────
// Default production client (HTTP) — replaced by a mock in tests.
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

/** Parse the certificate-expiry field from a Fiskaly TSS response. */
function parseCertValidTo(data: {
  certificate_expiration_date?: string | number;
  certificate_valid_until?: string | number;
  certificate?: { valid_to?: string | number; not_after?: string | number };
}): Date {
  const raw =
    data.certificate_expiration_date ??
    data.certificate_valid_until ??
    data.certificate?.valid_to ??
    data.certificate?.not_after;
  if (raw === undefined || raw === null) {
    throw new Error('fiskaly TSS response missing certificate expiry');
  }
  // Fiskaly may return an ISO string or a unix-seconds integer.
  const date = typeof raw === 'number' ? new Date(raw * 1000) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error('fiskaly TSS certificate expiry not parseable');
  }
  return date;
}

/** Real Fiskaly SIGN DE V2 TSS metadata client. Throws on any non-ok response. */
export function createDefaultTseClient(): FiskalyTseClient {
  return {
    async getTssInfo(config, tssId) {
      const token = await fiskalyAuth(config);
      const res = await httpFetch(`${FISKALY_TSE_BASE_URL}/tss/${tssId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`fiskaly TSS lookup failed: HTTP ${res.status}`);
      const data = (await res.json()) as {
        certificate_expiration_date?: string | number;
        certificate_valid_until?: string | number;
        certificate?: { valid_to?: string | number; not_after?: string | number };
        description?: string;
        metadata?: { description?: string };
      };
      return {
        certValidTo: parseCertValidTo(data),
        description: data.metadata?.description ?? data.description ?? tssId,
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Job factory
// ────────────────────────────────────────────────────────────────────────

export interface TseCertCheckerJobOptions extends TseCertCheckOptions {
  fiskaly: FiskalyTseConfig;
  /** Injectable client (tests); defaults to the real HTTP client. */
  client?: FiskalyTseClient;
}

export function tseCertCheckerJob(opts: TseCertCheckerJobOptions): JobDefinition {
  const client = opts.client ?? createDefaultTseClient();
  return {
    name: 'tse_cert_checker',
    schedule: '0 5 * * *', // daily 05:00 (after archive 03:00 + gdpr 04:00)
    timeoutMs: 60_000,
    async run({ db, log }) {
      const outcome = await runTseCertCheck({
        db,
        log,
        fiskaly: opts.fiskaly,
        client,
        ...(opts.thresholdDays !== undefined ? { thresholdDays: opts.thresholdDays } : {}),
        ...(opts.cooldownHours !== undefined ? { cooldownHours: opts.cooldownHours } : {}),
      });
      return { ...outcome };
    },
  };
}
