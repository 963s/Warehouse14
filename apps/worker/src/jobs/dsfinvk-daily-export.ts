/**
 * dsfinvk_daily_export — Day-18 scaffold, Epic-K Fiskaly push.
 *
 * Per business day at 02:00 (after the End-of-Day window):
 *   1. Find yesterday's FINALIZED daily_closing (skip if none).
 *   2. Ensure a `dsfinvk_exports` row covers the day (INSERT GENERATING).
 *   3. Epic K — if Fiskaly credentials are configured, push the closing to the
 *      Fiskaly DSFinV-K cloud (`pushCashPointClosing`). Empty credentials →
 *      log "fiskaly not configured" and continue; a Fiskaly error is logged but
 *      NEVER fails the job (the GENERATING row is the load-bearing record).
 *
 * NOTE on the Fiskaly client: the canonical implementation lives in
 * `apps/api-cloud/src/lib/fiskaly-dsfinvk.ts` (it is unit-tested there and used
 * by the export route). The worker cannot import across the app boundary
 * (per-app `rootDir: ./src`), so this file carries a small, contract-identical
 * mirror — same Basic-auth, 15s AbortController timeout, and fail-safe
 * `{ error }` return. The job accepts a `pushImpl` so tests can inject a stub.
 */

import { sql } from 'drizzle-orm';

import type { JobDefinition } from '../lib/job-runner.js';

export interface FiskalyConfig {
  apiKey: string;
  apiSecret: string;
}

export type CashPointClosing = Record<string, unknown>;
export type PushClosingResult = { exportId: string } | { error: string };

export type FiskalyPushFn = (
  config: FiskalyConfig,
  closing: CashPointClosing,
) => Promise<PushClosingResult>;

const FISKALY_BASE_URL = 'https://dsfinvk.fiskaly.com/api/v1';
const FISKALY_TIMEOUT_MS = 15_000;

export function isFiskalyConfigured(config: FiskalyConfig): boolean {
  return config.apiKey.length > 0 && config.apiSecret.length > 0;
}

/** Contract-identical mirror of the api-cloud client. Never throws. */
const defaultPush: FiskalyPushFn = async (config, closing) => {
  if (!isFiskalyConfigured(config)) return { error: 'fiskaly not configured' };

  const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`, 'utf8').toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FISKALY_TIMEOUT_MS);
  try {
    const res = await fetch(`${FISKALY_BASE_URL}/cash_point_closings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${token}`,
      },
      body: JSON.stringify(closing),
      signal: controller.signal,
    });
    if (!res.ok) return { error: `fiskaly cash_point_closings failed: HTTP ${res.status}` };
    const data = (await res.json()) as { _id?: string; id?: string };
    const exportId = data._id ?? data.id;
    return exportId ? { exportId } : { error: 'fiskaly response missing closing id' };
  } catch (err) {
    return { error: `fiskaly unreachable: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
};

export interface DsfinvkDailyExportJobOptions {
  /** Fiskaly credentials from worker env. Empty → push is skipped. */
  fiskaly: FiskalyConfig;
  /** Injectable push (tests). Defaults to the real fail-safe HTTP client. */
  pushImpl?: FiskalyPushFn;
}

/**
 * Full closing row, used to build the Fiskaly cash-point-closing payload.
 * A `type` (not `interface`) so it satisfies the `Record<string, unknown>`
 * constraint on `db.execute<T>` (interfaces lack an implicit index signature).
 */
type ClosingRow = {
  id: string;
  business_day: string;
  finalized_at: Date;
  verkauf_count: number;
  ankauf_count: number;
  storno_count: number;
  gross_verkauf_eur: string;
  gross_ankauf_eur: string;
  net_verkauf_eur: string;
  net_ankauf_eur: string;
  vat_by_treatment: unknown;
  payments_by_method: unknown;
};

export function dsfinvkDailyExportJob(opts: DsfinvkDailyExportJobOptions): JobDefinition {
  const push = opts.pushImpl ?? defaultPush;

  return {
    name: 'dsfinvk_daily_export',
    schedule: '0 2 * * *', // daily 02:00 (after End-of-Day window)
    timeoutMs: 5 * 60_000,
    async run({ db, log }) {
      // Yesterday's business day (Berlin).
      const yesterday = await db.execute<{ business_day: string }>(sql`
        SELECT (current_date - interval '1 day')::date::text AS business_day`);
      const businessDay = yesterday[0]?.business_day;
      if (!businessDay) {
        log.warn('could not resolve yesterday business day — export skipped');
        return { skipped: true, reason: 'no_business_day' };
      }

      // Was the day actually finalised? Pull the columns we'd push to Fiskaly.
      const closing = await db.execute<ClosingRow>(sql`
        SELECT id, business_day::text AS business_day, finalized_at,
               verkauf_count, ankauf_count, storno_count,
               gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
               vat_by_treatment, payments_by_method
          FROM daily_closings
         WHERE business_day = ${businessDay}::date
           AND state = 'FINALIZED'
         LIMIT 1`);
      const closingRow = closing[0];
      if (!closingRow) {
        log.warn('no FINALIZED daily_closing for yesterday — export skipped', { businessDay });
        return { skipped: true, reason: 'no_finalized_closing', businessDay };
      }

      // Is there already an export covering this day?
      const existing = await db.execute<{ id: string; state: string }>(sql`
        SELECT id, state::text AS state
          FROM dsfinvk_exports
         WHERE period_start = ${businessDay}::date
           AND period_end = ${businessDay}::date
         LIMIT 1`);
      if (existing.length > 0) {
        log.info('export row already exists — no-op', { existing: existing[0] });
        return { skipped: true, reason: 'export_already_exists', existing: existing[0] };
      }

      // requested_by_user_id NOT NULL — automated runs use the Owner.
      const ownerRows = await db.execute<{ id: string }>(sql`
        SELECT id FROM users WHERE is_owner = TRUE AND soft_deleted_at IS NULL LIMIT 1`);
      const owner = ownerRows[0];
      if (!owner) {
        log.warn('no Owner user found — cannot record requested_by_user_id');
        return { skipped: true, reason: 'no_owner_user', businessDay };
      }
      const requestedBy = owner.id;

      const inserted = await db.execute<{ id: string }>(sql`
        INSERT INTO dsfinvk_exports
          (period_start, period_end, state, requested_by_user_id, daily_closing_ids)
        VALUES
          (${businessDay}::date, ${businessDay}::date, 'GENERATING'::dsfinvk_export_state,
           ${requestedBy}, ARRAY[${closingRow.id}::uuid])
        RETURNING id`);
      const exportRow = inserted[0];
      if (!exportRow) throw new Error('dsfinvk_exports INSERT returned no row');
      const exportRowId = exportRow.id;
      log.info('inserted GENERATING dsfinvk_exports row', {
        exportId: exportRowId,
        businessDay,
        dailyClosingId: closingRow.id,
      });

      // ── Epic K — push to Fiskaly DSFinV-K (fail-safe) ──────────────────
      if (!isFiskalyConfigured(opts.fiskaly)) {
        log.info('fiskaly not configured — skipping DSFinV-K push', { businessDay });
        return {
          exportId: exportRowId,
          businessDay,
          dailyClosingId: closingRow.id,
          state: 'GENERATING',
          fiskaly: 'skipped',
        };
      }

      const payload: CashPointClosing = {
        client_id: closingRow.id,
        business_day: closingRow.business_day,
        counts: {
          verkauf: closingRow.verkauf_count,
          ankauf: closingRow.ankauf_count,
          storno: closingRow.storno_count,
        },
        totals: {
          gross_verkauf_eur: closingRow.gross_verkauf_eur,
          gross_ankauf_eur: closingRow.gross_ankauf_eur,
          net_verkauf_eur: closingRow.net_verkauf_eur,
          net_ankauf_eur: closingRow.net_ankauf_eur,
        },
        vat_by_treatment: closingRow.vat_by_treatment,
        payments_by_method: closingRow.payments_by_method,
      };

      const result = await push(opts.fiskaly, payload);
      if ('error' in result) {
        // NEVER fail the job — the GENERATING row stands; ops can retry.
        log.error('fiskaly DSFinV-K push failed — export row left GENERATING', {
          businessDay,
          error: result.error,
        });
        return {
          exportId: exportRowId,
          businessDay,
          dailyClosingId: closingRow.id,
          state: 'GENERATING',
          fiskaly: 'error',
          fiskalyError: result.error,
        };
      }

      log.info('fiskaly DSFinV-K push succeeded', {
        businessDay,
        fiskalyExportId: result.exportId,
      });
      return {
        exportId: exportRowId,
        businessDay,
        dailyClosingId: closingRow.id,
        state: 'GENERATING',
        fiskaly: 'pushed',
        fiskalyExportId: result.exportId,
      };
    },
  };
}
