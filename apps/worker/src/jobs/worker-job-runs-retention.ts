/**
 * worker_job_runs_retention — prunes the operational job-run log.
 *
 * `worker_job_runs` records every tick of every worker job (~8,100 rows/day).
 * It carries NO legal-retention requirement (it is telemetry, not a fiscal
 * record), yet nothing pruned it, so by 2026-07 it was 83% of the whole
 * database and growing ~1.4 GB/year forever. This job caps it.
 *
 * Retention windows (never touches a RUNNING row — a job could still be in
 * flight):
 *   • SUCCESS / SKIPPED  → kept 30 days, then pruned (the common, boring case).
 *   • FAILED / TIMEOUT   → kept 180 days (forensic value; far rarer).
 *
 * DELETE on this one non-fiscal table is granted to warehouse14_worker in
 * migration 0081. The worker still cannot DELETE any fiscal/audit row.
 */

import { sql } from 'drizzle-orm';

import { workerJobRuns } from '@warehouse14/db/schema';
import type { JobDefinition } from '../lib/job-runner.js';

/** Days to keep boring (SUCCESS/SKIPPED) vs failing (FAILED/TIMEOUT) runs. */
export const SUCCESS_RETENTION_DAYS = 30;
export const FAILURE_RETENTION_DAYS = 180;

export const workerJobRunsRetentionJob: JobDefinition = {
  name: 'worker_job_runs_retention',
  schedule: '30 3 * * *', // nightly at 03:30, off the busy path
  timeoutMs: 120_000,
  async run({ db, log }) {
    const result = await db
      .delete(workerJobRuns)
      .where(
        sql`
          (${workerJobRuns.status} IN ('SUCCESS', 'SKIPPED')
             AND ${workerJobRuns.startedAt} < now() - (${SUCCESS_RETENTION_DAYS} || ' days')::interval)
          OR
          (${workerJobRuns.status} IN ('FAILED', 'TIMEOUT')
             AND ${workerJobRuns.startedAt} < now() - (${FAILURE_RETENTION_DAYS} || ' days')::interval)
        `,
      )
      .returning({ id: workerJobRuns.id });
    const rowsDeleted = result.length;
    if (rowsDeleted > 0) log.info('pruned worker_job_runs', { rowsDeleted });
    return { rowsDeleted };
  },
};
