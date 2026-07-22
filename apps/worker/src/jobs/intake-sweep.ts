/**
 * intake_sweep — drives the AI Intake Pipeline on the PG-native cron runner
 * (the no-Redis substitute for BullMQ, ADR-0015 §5).
 *
 * Each tick:
 *   1. closes expired grouping windows (RECEIVED + grouping_closes_at < now()
 *      → GROUPED);
 *   2. processes a bounded batch of GROUPED sessions via processIntakeSession,
 *      ABER nur, wenn eine echte Bilderkennung hinterlegt ist. Ohne sie bleiben
 *      die Sitzungen GROUPED und warten, statt aus einer Testhilfe heraus
 *      geschätzt zu werden. Siehe `IntakeSweepDeps.vision`.
 *
 * The runner's per-job advisory lock gives at-most-once execution across worker
 * instances, so two daemons never process the same session concurrently.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import type { VisionClient } from '@warehouse14/ai-gateway';

import { processIntakeSession } from '../lib/intake-processor.js';
import type { JobDefinition } from '../lib/job-runner.js';

const MAX_SESSIONS_PER_TICK = 10;

export interface IntakeSweepDeps {
  /**
   * Die Bilderkennung. OHNE sie wird NICHT verarbeitet.
   *
   * Vorher stand hier als Voreinstellung der Doppelgänger aus dem ai-gateway,
   * und der antwortet auf JEDES Foto mit denselben Angaben: 585er Gold,
   * 3,2 Gramm fein, Zustand gut. Diese Angaben laufen weiter in
   * `estimateDraftPrices` und werden dort mit dem echten Goldpreis zu einem
   * vorgeschlagenen ANKAUFSPREIS. Am Tresen liest sich das wie eine Messung
   * an genau diesem Stück, ist aber eine feste Zahl aus einer Testhilfe.
   *
   * Auf der Produktion ist kein `ANTHROPIC_API_KEY` gesetzt. Ausgelöst hat es
   * nichts, weil noch keine einzige Sitzung angelegt wurde; scharf war es.
   */
  vision?: VisionClient;
}

export function intakeSweepJob(deps: IntakeSweepDeps = {}): JobDefinition {
  const vision = deps.vision;
  return {
    name: 'intake_sweep',
    schedule: '* * * * *', // every minute
    timeoutMs: 120_000,
    run: async (ctx) => {
      // 0. Reclaim sessions stuck in PROCESSING. A worker crash/abort between
      //    the PROCESSING flip and the terminal flip would otherwise strand a
      //    session forever (the batch below only picks GROUPED). Back to GROUPED
      //    for a retry; the 10-minute floor is well above the 120 s tick timeout
      //    so a session actively being processed is never reclaimed. Mirrors the
      //    cart-/reservation-sweeper expiry pattern.
      const reclaimed = (await ctx.db.execute<{ id: string }>(drizzleSql`
        UPDATE intake_sessions
        SET status = 'GROUPED', processing_started_at = NULL
        WHERE status = 'PROCESSING' AND processing_started_at < now() - interval '10 minutes'
        RETURNING id::text AS id
      `)) as unknown as Array<{ id: string }>;

      // 1. Close expired grouping windows.
      const closed = (await ctx.db.execute<{ id: string }>(drizzleSql`
        UPDATE intake_sessions
        SET status = 'GROUPED'
        WHERE status = 'RECEIVED' AND grouping_closes_at < now()
        RETURNING id::text AS id
      `)) as unknown as Array<{ id: string }>;

      // 2. Ohne Bilderkennung wird hier Schluss gemacht. Die beiden Schritte
      //    oben sind reine Zeitarbeit an eigenen Zeilen und bleiben richtig;
      //    das Beurteilen eines fremden Schmuckstücks ist es nicht. Die
      //    Sitzungen bleiben GROUPED und werden nachgeholt, sobald ein
      //    Zugang hinterlegt ist. Nichts geht verloren.
      if (!vision) {
        const wartend = (await ctx.db.execute<{ n: string }>(drizzleSql`
          SELECT count(*)::text AS n FROM intake_sessions WHERE status = 'GROUPED'
        `)) as unknown as Array<{ n: string }>;
        const n = Number(wartend[0]?.n ?? 0);
        if (n > 0) {
          ctx.log.warn(
            'intake_sweep: keine Bilderkennung hinterlegt — es wird nichts geschätzt und ' +
              'kein Ankaufspreis vorgeschlagen; diese Sitzungen warten',
            { wartend: n },
          );
        }
        return {
          stuckReclaimed: reclaimed.length,
          windowsClosed: closed.length,
          sessionsProcessed: 0,
          wartendOhneBilderkennung: n,
        };
      }

      // 3. Process a bounded batch of GROUPED sessions.
      const grouped = (await ctx.db.execute<{ id: string }>(drizzleSql`
        SELECT id::text AS id FROM intake_sessions
        WHERE status = 'GROUPED'
        ORDER BY started_at ASC
        LIMIT ${MAX_SESSIONS_PER_TICK}
      `)) as unknown as Array<{ id: string }>;

      for (const s of grouped) {
        if (ctx.signal.aborted) break;
        await processIntakeSession(ctx.db, vision, s.id, ctx.log, ctx.signal);
      }

      return {
        stuckReclaimed: reclaimed.length,
        windowsClosed: closed.length,
        sessionsProcessed: grouped.length,
      };
    },
  };
}
