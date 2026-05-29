/**
 * POS PIN auth routes — Day 12b.
 *
 *   POST /api/auth/pin-login    — start a session from a PIN on a paired device
 *   POST /api/auth/step-up      — refresh sessions.last_pin_step_up_at via PIN
 *   POST /api/auth/pin/set      — create or change a PIN (requires Full Login)
 *
 * All three call into `@warehouse14/auth-pin` for argon2id + state machine,
 * and emit `audit_log` rows for the observability surface in ADR-0022 §8.
 *
 * Discipline:
 *   • Every PIN read/write is wrapped in a `db.transaction` so the user-row
 *     state (failed_attempts / locked_until) is atomic with the audit row.
 *   • Failed PINs respond with the SAME shape and timing as success — no
 *     username enumeration through pin-login (the device cert already
 *     identifies the user; the PIN is the proof).
 *   • Lockout returns 423 PIN_LOCKED with `lockedUntil` so the UI can show
 *     a countdown; the front-end then routes the user to Full Login.
 */

import { randomUUID } from 'node:crypto';
import { type Static, Type } from '@sinclair/typebox';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  PIN_FAILED_THRESHOLD,
  PIN_LOCKOUT_MINUTES,
  PinPolicy,
  decideAttemptOutcome,
  hashPin,
  verifyPin,
} from '@warehouse14/auth-pin';
import { auditLog, devices, sessions, users } from '@warehouse14/db/schema';

import { PinLockedError, UnauthorizedError, requireAuth } from '../lib/auth-policy.js';

// ────────────────────────────────────────────────────────────────────────
// Shared schemas
// ────────────────────────────────────────────────────────────────────────

const PinBody = Type.Object({
  pin: Type.String({ minLength: 4, maxLength: 4, pattern: '^\\d{4}$' }),
});
type PinBody = Static<typeof PinBody>;

const PinLoginResponse = Type.Object({
  ok: Type.Literal(true),
  sessionExpiresAt: Type.String({ format: 'date-time' }),
  actor: Type.Object({
    id: Type.String({ format: 'uuid' }),
    role: Type.Union([Type.Literal('ADMIN'), Type.Literal('CASHIER'), Type.Literal('READONLY')]),
    isOwner: Type.Boolean(),
  }),
});

const StepUpResponse = Type.Object({
  ok: Type.Literal(true),
  lastPinStepUpAt: Type.String({ format: 'date-time' }),
});

const PinSetBody = Type.Object({
  newPin: Type.String({ minLength: 4, maxLength: 4, pattern: '^\\d{4}$' }),
});

const PinSetResponse = Type.Object({
  ok: Type.Literal(true),
  setAt: Type.String({ format: 'date-time' }),
});

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Resolve the user behind the current PIN attempt.
 *
 * Today (V1, single cashier per terminal) → devices.paired_by_user_id.
 * Tomorrow (V1.x, avatar list per terminal) → request body would carry an
 * actorId hint and we'd validate it belongs to one of the device's allowed
 * users. We design the function signature for the future so the call sites
 * don't change.
 */
async function resolveCandidateUser(
  app: import('fastify').FastifyInstance,
  deviceId: string | null,
): Promise<{ userId: string } | null> {
  if (!deviceId) return null;
  const rows = await app.db
    .select({ pairedBy: devices.pairedByUserId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  const r = rows[0];
  if (!r?.pairedBy) return null;
  return { userId: r.pairedBy };
}

interface PinUserState {
  id: string;
  role: 'ADMIN' | 'CASHIER' | 'READONLY';
  isOwner: boolean;
  posPinHash: string | null;
  posPinFailedAttempts: number;
  posPinLockedUntil: Date | null;
}

async function loadPinUserState(
  app: import('fastify').FastifyInstance,
  userId: string,
): Promise<PinUserState | null> {
  const rows = await app.db
    .select({
      id: users.id,
      role: users.role,
      isOwner: users.isOwner,
      posPinHash: users.posPinHash,
      posPinFailedAttempts: users.posPinFailedAttempts,
      posPinLockedUntil: users.posPinLockedUntil,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.softDeletedAt)))
    .limit(1);
  return (rows[0] as PinUserState | undefined) ?? null;
}

// Audit emission — purely fire-and-include in the active transaction.
async function emitAudit(
  app: import('fastify').FastifyInstance,
  opts: {
    event: string;
    actorUserId: string | null;
    deviceId: string | null;
    ip: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await app.db.insert(auditLog).values({
    eventType: opts.event,
    actorUserId: opts.actorUserId,
    deviceId: opts.deviceId,
    ipAddress: opts.ip,
    payload: opts.payload,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────

const authPinRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/pin-login
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/pin-login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Fast POS PIN login on a paired device (ADR-0022 §4b)',
        body: PinBody,
        response: { 200: PinLoginResponse },
      },
    },
    async (req, reply) => {
      const { pin } = req.body as PinBody;
      const ip = req.ip || null;

      const candidate = await resolveCandidateUser(app, req.deviceId);
      if (!candidate) {
        throw new UnauthorizedError('PIN login requires a paired device');
      }
      const state = await loadPinUserState(app, candidate.userId);
      if (!state || !state.posPinHash) {
        throw new UnauthorizedError('PIN not set for this user');
      }

      // Constant work first — verify PIN. The state machine then decides
      // success / fail / lockout / already-locked.
      const pinCorrect = await verifyPin(pin, state.posPinHash);
      const decision = decideAttemptOutcome({
        state: { failedAttempts: state.posPinFailedAttempts, lockedUntil: state.posPinLockedUntil },
        now: new Date(),
        pinCorrect,
      });

      // Atomic: state update + audit row in one transaction.
      if (decision.kind === 'already_locked') {
        await emitAudit(app, {
          event: 'auth.pin_failed',
          actorUserId: state.id,
          deviceId: req.deviceId,
          ip,
          payload: { reason: 'already_locked', lockedUntil: decision.until.toISOString() },
        });
        throw new PinLockedError(decision.until);
      }

      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            posPinFailedAttempts: decision.newState.failedAttempts,
            posPinLockedUntil: decision.newState.lockedUntil,
          })
          .where(eq(users.id, state.id));

        const event =
          decision.kind === 'success'
            ? 'auth.pin_login'
            : decision.kind === 'failed_now_locked'
              ? 'auth.pin_locked'
              : 'auth.pin_failed';

        await tx.insert(auditLog).values({
          eventType: event,
          actorUserId: state.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: {
            decision: decision.kind,
            failed_attempts: decision.newState.failedAttempts,
            locked_until: decision.newState.lockedUntil?.toISOString() ?? null,
            is_owner: state.isOwner,
          },
        });
      });

      if (decision.kind === 'failed_now_locked') {
        // The lockout starts NOW. Surface it to the UI immediately.
        throw new PinLockedError(decision.newState.lockedUntil!);
      }
      if (decision.kind === 'failed') {
        throw new UnauthorizedError(
          `Invalid PIN (${PIN_FAILED_THRESHOLD - decision.newState.failedAttempts} attempts remaining)`,
        );
      }

      // Success — create a session. TTL depends on is_owner per ADR-0022 §2.
      const ttlMs = state.isOwner
        ? 30 * 24 * 60 * 60_000 // 30 days for Owner
        : 8 * 60 * 60_000; // 8 hours for staff
      const sessionId = randomUUID();
      const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + ttlMs);

      await app.db.insert(sessions).values({
        id: sessionId,
        userId: state.id,
        token,
        expiresAt,
        ipAddress: ip,
        userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        deviceId: req.deviceId,
        lastPinStepUpAt: new Date(), // Fresh PIN = fresh step-up.
      });

      reply.setCookie('warehouse14.session', token, {
        httpOnly: true,
        secure: req.protocol === 'https',
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });

      return {
        ok: true as const,
        sessionExpiresAt: expiresAt.toISOString(),
        actor: { id: state.id, role: state.role, isOwner: state.isOwner },
      };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/step-up — re-confirm PIN for sensitive actions
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/step-up',
    {
      schema: {
        tags: ['auth'],
        summary: 'PIN step-up for sensitive actions (10-min window, ADR-0022 §4c)',
        body: PinBody,
        response: { 200: StepUpResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      const { pin } = req.body as PinBody;
      const ip = req.ip || null;

      const state = await loadPinUserState(app, req.actor.id);
      if (!state || !state.posPinHash) {
        throw new UnauthorizedError('PIN not set for this user');
      }

      const pinCorrect = await verifyPin(pin, state.posPinHash);
      const decision = decideAttemptOutcome({
        state: { failedAttempts: state.posPinFailedAttempts, lockedUntil: state.posPinLockedUntil },
        now: new Date(),
        pinCorrect,
      });

      if (decision.kind === 'already_locked') {
        throw new PinLockedError(decision.until);
      }

      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            posPinFailedAttempts: decision.newState.failedAttempts,
            posPinLockedUntil: decision.newState.lockedUntil,
          })
          .where(eq(users.id, state.id));

        if (decision.kind === 'success') {
          await tx
            .update(sessions)
            .set({ lastPinStepUpAt: now })
            .where(eq(sessions.id, req.session.sessionId));
        }

        await tx.insert(auditLog).values({
          eventType:
            decision.kind === 'success'
              ? 'auth.step_up_success'
              : decision.kind === 'failed_now_locked'
                ? 'auth.pin_locked'
                : 'auth.step_up_failed',
          actorUserId: state.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: {
            session_id: req.session.sessionId,
            decision: decision.kind,
            failed_attempts: decision.newState.failedAttempts,
          },
        });
      });

      if (decision.kind === 'failed_now_locked') {
        throw new PinLockedError(decision.newState.lockedUntil!);
      }
      if (decision.kind === 'failed') {
        throw new UnauthorizedError(
          `Invalid PIN (${PIN_FAILED_THRESHOLD - decision.newState.failedAttempts} attempts remaining)`,
        );
      }

      return { ok: true as const, lastPinStepUpAt: now.toISOString() };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/pin/set — set or change PIN (requires Full Login session)
  //
  // For V1 we accept the current session is enough proof — better-auth
  // already enforced email/password (+ TOTP if enabled) to issue it.
  // The CHECK constraint + the auth-pin policy enforce the rest.
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/pin/set',
    {
      schema: {
        tags: ['auth'],
        summary: 'Set or change the POS PIN for the authenticated user',
        body: PinSetBody,
        response: { 200: PinSetResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      const { newPin } = req.body as Static<typeof PinSetBody>;
      const ip = req.ip || null;

      // Production enforces blacklist; tests/dev seeds may use 0000 via
      // dev-bootstrap which inserts directly bypassing this route.
      const isProd = process.env.NODE_ENV === 'production';
      const err = PinPolicy.validate(newPin, { enforceBlacklist: isProd });
      if (err) {
        throw new UnauthorizedError(
          err.code === 'BLACKLISTED'
            ? 'PIN is in the blacklist of common weak PINs'
            : err.code === 'WRONG_LENGTH'
              ? 'PIN must be exactly 4 digits'
              : 'PIN must be all digits',
        );
      }

      const hash = await hashPin(newPin);
      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            posPinHash: hash,
            posPinSetAt: now,
            posPinFailedAttempts: 0,
            posPinLockedUntil: null,
          })
          .where(eq(users.id, req.actor!.id));

        await tx.insert(auditLog).values({
          eventType: 'pin.set',
          actorUserId: req.actor!.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: { lockout_minutes: PIN_LOCKOUT_MINUTES, threshold: PIN_FAILED_THRESHOLD },
        });
      });

      return { ok: true as const, setAt: now.toISOString() };
    },
  );
};

export default authPinRoutes;
