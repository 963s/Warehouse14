/**
 * Auth session companion routes (Day 5 — Operational Foundations, memory.md #76).
 *
 *   GET  /api/auth/session   — current actor + step-up freshness, or 401
 *   POST /api/auth/sign-out  — destroy the current PIN session
 *
 * These complete the auth surface that the Tauri client needs for cold-start
 * restore + clean sign-out. They live in their own route file (NOT inside
 * auth-pin.ts) because they target the SESSION lifecycle, not the PIN
 * lifecycle. The schemas the client consumes are exported alongside.
 */

import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, sessions } from '@warehouse14/db/schema';

import { UnauthorizedError, requireAuth } from '../lib/auth-policy.js';

// ────────────────────────────────────────────────────────────────────────
// Response schemas
// ────────────────────────────────────────────────────────────────────────

const SessionActor = Type.Object({
  id: Type.String({ format: 'uuid' }),
  role: Type.Union([Type.Literal('ADMIN'), Type.Literal('CASHIER'), Type.Literal('READONLY')]),
  isOwner: Type.Boolean(),
});

const SessionResponse = Type.Object({
  ok: Type.Literal(true),
  actor: SessionActor,
  /** Server time when the current PIN step-up was last refreshed (or null). */
  lastPinStepUpAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** When this session cookie expires. */
  expiresAt: Type.String({ format: 'date-time' }),
});

const SignOutResponse = Type.Object({
  ok: Type.Literal(true),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

// ────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────

const authSessionRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/auth/session
  //
  // Trivial probe — the auth preHandler already populated req.actor /
  // req.session for any valid cookie. We just echo a stable shape; the
  // client uses it for cold-start restore. Returns 401 when there is no
  // session (the standard requireAuth path).
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/auth/session',
    {
      schema: {
        tags: ['auth'],
        summary: 'Return the current PIN session (cold-start restore).',
        response: { 200: SessionResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      return {
        ok: true as const,
        actor: {
          id: req.actor.id,
          role: req.actor.role,
          isOwner: req.actor.isOwner,
        },
        lastPinStepUpAt: req.session.lastPinStepUpAt
          ? req.session.lastPinStepUpAt.toISOString()
          : null,
        expiresAt: req.session.sessionExpiresAt.toISOString(),
      };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/sign-out
  //
  // Deletes the row from `sessions` + clears the cookie. Idempotent:
  // calling it without a session returns 401 (no harm done). Writes an
  // `auth.sign_out` audit row inside the same transaction as the delete.
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/sign-out',
    {
      schema: {
        tags: ['auth'],
        summary: 'Destroy the current PIN session.',
        response: { 200: SignOutResponse, 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!req.session || !req.actor) {
        throw new UnauthorizedError('No active session to sign out.');
      }
      const sessionId = req.session.sessionId;
      const actorId = req.actor.id;

      await app.db.transaction(async (tx) => {
        await tx.delete(sessions).where(eq(sessions.id, sessionId));
        await tx.insert(auditLog).values({
          eventType: 'auth.sign_out',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: { sessionId },
        });
      });

      // Clear the cookie. `clearCookie` mirrors the path + secure flags so
      // the browser actually overwrites the existing cookie.
      reply.clearCookie('warehouse14.session', {
        path: '/',
        httpOnly: true,
        secure: req.protocol === 'https',
        sameSite: 'lax',
      });

      return { ok: true as const };
    },
  );
};

export default authSessionRoutes;
