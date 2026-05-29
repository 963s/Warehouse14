/**
 * Actor model — who is making this request, at the API tier.
 *
 * Decoupled from better-auth's `user` object because:
 *   • we add `isOwner` (the Day-12a flag with its own access semantics)
 *   • we add `lastPinStepUpAt` (Day-12a step-up bookkeeping on `sessions`)
 *   • we expose only the columns the route layer needs — no PII, no email.
 */

import { and, eq, isNull } from 'drizzle-orm';

import type { AppDb } from '@warehouse14/db/client';
import { sessions, users } from '@warehouse14/db/schema';

export type ActorRole = 'ADMIN' | 'CASHIER' | 'READONLY';

export interface Actor {
  id: string;
  role: ActorRole;
  isOwner: boolean;
  preferredLanguage: 'de' | 'en' | 'ar';
}

export interface ActorWithSession {
  actor: Actor;
  sessionId: string;
  /**
   * Most-recent PIN step-up timestamp on THIS session, or null if the user
   * has never stepped up on this session. Compared against the step-up
   * window in `requireStepUp()`.
   */
  lastPinStepUpAt: Date | null;
  sessionExpiresAt: Date;
}

/**
 * Load the actor + session bundle by session id.
 *
 * Skips soft-deleted users so a tombstoned account cannot reactivate by
 * presenting an old cookie. Returns null on miss; caller treats as 401.
 */
export async function loadActorBySession(
  db: AppDb,
  sessionId: string,
): Promise<ActorWithSession | null> {
  const rows = await db
    .select({
      userId: users.id,
      role: users.role,
      isOwner: users.isOwner,
      preferredLanguage: users.preferredLanguage,
      sessionId: sessions.id,
      lastPinStepUpAt: sessions.lastPinStepUpAt,
      sessionExpiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), isNull(users.softDeletedAt)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    actor: {
      id: r.userId,
      role: r.role as ActorRole,
      isOwner: r.isOwner,
      preferredLanguage: r.preferredLanguage as 'de' | 'en' | 'ar',
    },
    sessionId: r.sessionId,
    lastPinStepUpAt: r.lastPinStepUpAt,
    sessionExpiresAt: r.sessionExpiresAt,
  };
}
