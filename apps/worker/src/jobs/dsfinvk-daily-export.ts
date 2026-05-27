/**
 * dsfinvk_daily_export — SCAFFOLD job (Day 18).
 *
 * V1 responsibility:
 *   1. Find yesterday's FINALIZED daily_closing (if any).
 *   2. If we have no `dsfinvk_exports` row covering that day → INSERT one
 *      in state GENERATING. Real builder lives in `@warehouse14/dsfinvk`
 *      package (Phase 1).
 *   3. Audit-log the scaffold attempt so ops can verify the cron fired.
 *
 * The actual CSV generation per BMF DSFinV-K v2.0 spec is a substantial
 * undertaking and intentionally split — this job's job (sic) is the timing
 * + state-machine kick-off. When the package lands, this job switches from
 * "insert + log" to "insert + invoke + upload + flip to GENERATED".
 *
 * NEVER throw if the closing isn't found — that's the operator's fault
 * (they didn't run End-of-Day). Log + return { skipped }.
 */

import { sql } from 'drizzle-orm';

import type { JobDefinition } from '../lib/job-runner.js';

export const dsfinvkDailyExportJob: JobDefinition = {
  name: 'dsfinvk_daily_export',
  schedule: '0 2 * * *', // daily 02:00 (after End-of-Day window)
  timeoutMs: 5 * 60_000,
  async run({ db, log }) {
    // Yesterday's business day (Berlin).
    const yesterday = await db.execute<{ business_day: string }>(sql`
      SELECT (current_date - interval '1 day')::date::text AS business_day`);
    const businessDay = yesterday[0]!.business_day;

    // Was the day actually finalised?
    const closing = await db.execute<{ id: string; finalized_at: Date }>(sql`
      SELECT id, finalized_at
        FROM daily_closings
       WHERE business_day = ${businessDay}::date
         AND state = 'FINALIZED'
       LIMIT 1`);
    if (closing.length === 0) {
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

    // V1 SCAFFOLD: insert GENERATING. We require requested_by_user_id NOT NULL.
    // For automated worker runs, use the "system" user — find the Owner.
    const ownerRows = await db.execute<{ id: string }>(sql`
      SELECT id FROM users WHERE is_owner = TRUE AND soft_deleted_at IS NULL LIMIT 1`);
    if (ownerRows.length === 0) {
      log.warn('no Owner user found — cannot record requested_by_user_id');
      return { skipped: true, reason: 'no_owner_user', businessDay };
    }
    const requestedBy = ownerRows[0]!.id;

    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO dsfinvk_exports
        (period_start, period_end, state, requested_by_user_id, daily_closing_ids)
      VALUES
        (${businessDay}::date, ${businessDay}::date, 'GENERATING'::dsfinvk_export_state,
         ${requestedBy}, ARRAY[${closing[0]!.id}::uuid])
      RETURNING id`);

    log.info('inserted GENERATING dsfinvk_exports row (V1 scaffold)', {
      exportId: inserted[0]!.id, businessDay, dailyClosingId: closing[0]!.id,
    });
    return { exportId: inserted[0]!.id, businessDay, dailyClosingId: closing[0]!.id, state: 'GENERATING' };
  },
};
