/**
 * anomaly_watchdog — z-score check on today's cash sales count vs trailing 30d.
 *
 * Reads `system_settings.anomaly.sigma_threshold` (default 3.0, ADMIN-tunable
 * via Bridge per memory.md #46). When today's count is more than σ standard
 * deviations from the trailing 30-day mean, emit `alert.anomaly_detected`.
 *
 * V1 signal: CASH-only transactions per business day. Future signals
 * (per-method, per-staff, average ticket size, …) extend the same shape.
 */

import { sql } from 'drizzle-orm';

import type { JobDefinition } from '../lib/job-runner.js';
import { emit } from '@warehouse14/audit';
import type { AppDb } from '@warehouse14/db/client';

export const anomalyWatchdogJob: JobDefinition = {
  name: 'anomaly_watchdog',
  schedule: '*/5 * * * *', // every 5 min
  timeoutMs: 30_000,
  async run({ db, log }) {
    const sigmaRows = await db.execute<{ sigma: string }>(sql`
      SELECT (value::text)::numeric AS sigma
        FROM system_settings
       WHERE key = 'anomaly.sigma_threshold'`);
    const sigma = sigmaRows[0]?.sigma != null ? parseFloat(sigmaRows[0].sigma) : 3.0;

    // Daily CASH sales counts over the trailing 30 days.
    const rows = await db.execute<{ business_day: string; cash_count: string }>(sql`
      SELECT berlin_business_day(t.finalized_at)::text AS business_day,
             COUNT(*)::text AS cash_count
        FROM transactions t
        JOIN transaction_payments p ON p.transaction_id = t.id
       WHERE p.payment_method = 'CASH'
         AND t.storno_of_transaction_id IS NULL
         AND berlin_business_day(t.finalized_at) >= (current_date - interval '30 days')
       GROUP BY berlin_business_day(t.finalized_at)
       ORDER BY berlin_business_day(t.finalized_at)`);

    if (rows.length < 7) {
      // Not enough history to compute a meaningful z-score yet.
      return { skipped: true, reason: 'insufficient_history', dayCount: rows.length };
    }

    const todayISO = new Date().toISOString().slice(0, 10);
    const todayRow = rows.find((r) => r.business_day === todayISO);
    const todayCount = todayRow ? parseInt(todayRow.cash_count, 10) : 0;

    const historicalCounts = rows
      .filter((r) => r.business_day !== todayISO)
      .map((r) => parseInt(r.cash_count, 10));

    const mean = historicalCounts.reduce((acc, n) => acc + n, 0) / historicalCounts.length;
    const variance =
      historicalCounts.reduce((acc, n) => acc + (n - mean) ** 2, 0) /
      historicalCounts.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) {
      return { skipped: true, reason: 'zero_stddev', mean, todayCount };
    }
    const zScore = Math.abs((todayCount - mean) / stddev);

    log.debug('z-score computed', { todayCount, mean, stddev, zScore, sigmaThreshold: sigma });

    if (zScore <= sigma) {
      return { alert: false, todayCount, mean, stddev, zScore };
    }

    await emit(db as unknown as AppDb, {
      eventType: 'alert.anomaly_detected',
      entityTable: 'system_settings',
      entityId: '00000000-0000-0000-0000-000000000000',
      payload: {
        signal: 'cash_sales_count_daily',
        todayCount,
        mean,
        stddev,
        zScore,
        sigmaThreshold: sigma,
        businessDay: todayISO,
      },
    });

    return { alert: true, todayCount, mean, stddev, zScore };
  },
};
