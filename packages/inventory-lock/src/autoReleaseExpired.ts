/**
 * Auto-release every RESERVED row whose reservation_expires_at < now().
 *
 * Run as a worker job every ~60 seconds (apps/worker). Idempotent — running
 * twice in the same minute releases nothing on the second pass.
 *
 * Returns the IDs that were released so the caller can emit a ledger event /
 * SSE notification per row.
 */

import type { AnyDb } from '@warehouse14/db/client';
import { sql } from 'drizzle-orm';

export async function autoReleaseExpired(db: AnyDb): Promise<string[]> {
  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    UPDATE products
       SET status                 = 'AVAILABLE',
           reserved_by_channel    = NULL,
           reserved_by_session_id = NULL,
           reserved_by_user_id    = NULL,
           reserved_at            = NULL,
           reservation_expires_at = NULL
     WHERE status                 = 'RESERVED'
       AND reservation_expires_at IS NOT NULL
       AND reservation_expires_at < now()
   RETURNING id
  `);

  return result.map((r) => r.id);
}
