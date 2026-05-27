/**
 * sessions_cleanup — deletes expired sessions older than 7 days.
 *
 * The `sessions` table has full DELETE granted to warehouse14_worker
 * (migration 0017). We keep expired rows for 7 days post-expiry so the
 * operator can investigate "who was logged in?" forensics; beyond that
 * they're noise.
 */

import { sql } from 'drizzle-orm';

import type { JobDefinition } from '../lib/job-runner.js';
import { sessions } from '@warehouse14/db/schema';

export const sessionsCleanupJob: JobDefinition = {
  name: 'sessions_cleanup',
  schedule: '15 * * * *', // every hour at :15
  timeoutMs: 60_000,
  async run({ db, log }) {
    const result = await db
      .delete(sessions)
      .where(sql`${sessions.expiresAt} < now() - interval '7 days'`)
      .returning({ id: sessions.id });
    const rowsDeleted = result.length;
    if (rowsDeleted > 0) log.info('deleted expired sessions', { rowsDeleted });
    return { rowsDeleted };
  },
};
