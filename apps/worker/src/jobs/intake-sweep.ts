/**
 * intake_sweep — drives the AI Intake Pipeline on the PG-native cron runner
 * (the no-Redis substitute for BullMQ, ADR-0015 §5).
 *
 * Each tick:
 *   1. closes expired grouping windows (RECEIVED + grouping_closes_at < now()
 *      → GROUPED);
 *   2. processes a bounded batch of GROUPED sessions via processIntakeSession.
 *
 * The runner's per-job advisory lock gives at-most-once execution across worker
 * instances, so two daemons never process the same session concurrently.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import { type VisionClient, createMockVisionClient } from '@warehouse14/ai-gateway';

import { processIntakeSession } from '../lib/intake-processor.js';
import type { JobDefinition } from '../lib/job-runner.js';

const MAX_SESSIONS_PER_TICK = 10;

export interface IntakeSweepDeps {
  /**
   * Vision transport. Defaults to the deterministic mock — production injects
   * the real OpenAI/Photoroom-backed client once credentials are wired.
   */
  vision?: VisionClient;
}

export function intakeSweepJob(deps: IntakeSweepDeps = {}): JobDefinition {
  const vision = deps.vision ?? createMockVisionClient();
  return {
    name: 'intake_sweep',
    schedule: '* * * * *', // every minute
    timeoutMs: 120_000,
    run: async (ctx) => {
      // 1. Close expired grouping windows.
      const closed = (await ctx.db.execute<{ id: string }>(drizzleSql`
        UPDATE intake_sessions
        SET status = 'GROUPED'
        WHERE status = 'RECEIVED' AND grouping_closes_at < now()
        RETURNING id::text AS id
      `)) as unknown as Array<{ id: string }>;

      // 2. Process a bounded batch of GROUPED sessions.
      const grouped = (await ctx.db.execute<{ id: string }>(drizzleSql`
        SELECT id::text AS id FROM intake_sessions
        WHERE status = 'GROUPED'
        ORDER BY started_at ASC
        LIMIT ${MAX_SESSIONS_PER_TICK}
      `)) as unknown as Array<{ id: string }>;

      for (const s of grouped) {
        if (ctx.signal.aborted) break;
        await processIntakeSession(ctx.db, vision, s.id, ctx.log);
      }

      return { windowsClosed: closed.length, sessionsProcessed: grouped.length };
    },
  };
}
