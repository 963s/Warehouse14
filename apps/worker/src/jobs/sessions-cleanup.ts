/**
 * sessions_cleanup — deletes expired sessions older than 7 days.
 *
 * Two tables, one policy. Both `sessions` (staff) and `shopper_sessions`
 * (customers) grant full DELETE to warehouse14_worker (migrations 0017 and
 * 0018 — the latter provisioned the grant for exactly this "expired-session
 * sweeper", which until now was never built, so customer sessions grew without
 * bound). We keep expired rows for 7 days post-expiry so the operator can
 * investigate "who was signed in?" forensics; beyond that they're noise.
 *
 * A soft-revoked session (revoked_at set at sign-out, 0106) keeps its original
 * expiry, so it is swept on the same schedule — the trail survives exactly as
 * long as a naturally expired one, then goes.
 */

import { sql } from 'drizzle-orm';

import { sessions, shopperSessions } from '@warehouse14/db/schema';
import type { JobDefinition } from '../lib/job-runner.js';

export const sessionsCleanupJob: JobDefinition = {
  name: 'sessions_cleanup',
  schedule: '15 * * * *', // every hour at :15
  timeoutMs: 60_000,
  async run({ db, log }) {
    const staff = await db
      .delete(sessions)
      .where(sql`${sessions.expiresAt} < now() - interval '7 days'`)
      .returning({ id: sessions.id });

    const shopper = await db
      .delete(shopperSessions)
      .where(sql`${shopperSessions.expiresAt} < now() - interval '7 days'`)
      .returning({ id: shopperSessions.id });

    const rowsDeleted = staff.length + shopper.length;
    if (rowsDeleted > 0) {
      log.info('deleted expired sessions', {
        rowsDeleted,
        staff: staff.length,
        shopper: shopper.length,
      });
    }
    return { rowsDeleted };
  },
};
