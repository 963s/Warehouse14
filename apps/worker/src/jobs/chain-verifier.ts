/**
 * chain_verifier — runs `verify_ledger_chain()` daily.
 *
 * The SQL function walks the entire ledger from row 1 to N, recomputing each
 * hash, and returns rows for every detected break. Empty result = chain intact.
 *
 * If ANY break is detected this job emits `alert.hash_chain_verification_failed`
 * — one of the 7 critical events from memory.md #45 that the Bridge UX
 * Attention Router stacks on top of everything until acknowledged.
 *
 * Performance: O(n) walk; at single-shop volume (~tens-of-thousands of
 * events) this runs sub-second. For longer horizons a daily checkpoint
 * anchor lives in `daily_closings.ledger_anchor_id/hash` (ADR-0008 §Known
 * limits #2) — verification can stop at the most recent anchor.
 */

import { emit } from '@warehouse14/audit';
import { sql } from 'drizzle-orm';
import type { JobDefinition } from '../lib/job-runner.js';

export const chainVerifierJob: JobDefinition = {
  name: 'chain_verifier',
  schedule: '0 5 * * *', // daily 05:00
  timeoutMs: 10 * 60_000,
  async run({ db, log }) {
    const breaks = await db.execute<{
      break_at_id: string;
      reason: string;
      expected_hash: Buffer;
      actual_hash: Buffer;
    }>(sql`SELECT * FROM verify_ledger_chain()`);

    if (breaks.length === 0) {
      log.info('chain intact');
      return { breaks: 0 };
    }

    const first = breaks[0]!;
    log.error('CHAIN BREAK DETECTED', { breakAtId: first.break_at_id, reason: first.reason });

    await emit(db, {
      eventType: 'alert.hash_chain_verification_failed',
      entityTable: 'ledger_events',
      entityId: '00000000-0000-0000-0000-000000000000',
      payload: {
        breakCount: breaks.length,
        firstBreakAtId: first.break_at_id,
        firstReason: first.reason,
      },
    });

    return { breaks: breaks.length, firstBreakAtId: first.break_at_id };
  },
};
