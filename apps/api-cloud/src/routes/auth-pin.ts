/**
 * POS PIN auth routes — Day 12b + Duress PIN (Decision #37).
 *
 *   POST /api/auth/pin-login       — start a session from a PIN on a paired device
 *   POST /api/auth/step-up         — refresh sessions.last_pin_step_up_at via PIN
 *   POST /api/auth/pin/set         — create or change the POS PIN (requires Full Login)
 *   POST /api/auth/duress-pin/set  — set the duress PIN (requires auth; distinct from POS PIN)
 *
 * All call into `@warehouse14/auth-pin` for argon2id + the lockout state machine,
 * and emit `audit_log` rows for the observability surface in ADR-0022 §8.
 *
 * Duress discipline (Decision #37):
 *   • Login/step-up verify the PIN against BOTH the POS hash and the duress hash
 *     (constant work — a dummy hash is verified when no duress PIN is set, so the
 *     perceived latency is identical). A match against EITHER counts as correct,
 *     so a duress login NEVER ticks the lockout counter and gives no branch/timing
 *     hint to a coercing attacker.
 *   • A duress match logs in normally, then fires a SILENT alarm in the background
 *     (audit_log + `alert.duress` ledger event + optional webhook) — the response
 *     to the operator is byte-for-byte identical to a normal login.
 */

import { randomUUID } from 'node:crypto';
import { type Static, Type } from '@sinclair/typebox';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { emit } from '@warehouse14/audit';
import {
  PIN_FAILED_THRESHOLD,
  PIN_LOCKOUT_MINUTES,
  PinPolicy,
  decideAttemptOutcome,
  hashPin,
  verifyPin,
} from '@warehouse14/auth-pin';
import { auditLog, devices, sessions, users } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { PinLockedError, UnauthorizedError, requireAuth } from '../lib/auth-policy.js';
import { type PinMatch, classifyPinAttempt } from '../lib/duress.js';

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

async function resolveCandidateUser(
  app: FastifyInstance,
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
  duressPinHash: string | null;
  posPinFailedAttempts: number;
  posPinLockedUntil: Date | null;
}

async function loadPinUserState(
  app: FastifyInstance,
  userId: string,
): Promise<PinUserState | null> {
  const rows = await app.db
    .select({
      id: users.id,
      role: users.role,
      isOwner: users.isOwner,
      posPinHash: users.posPinHash,
      duressPinHash: users.duressPinHash,
      posPinFailedAttempts: users.posPinFailedAttempts,
      posPinLockedUntil: users.posPinLockedUntil,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.softDeletedAt)))
    .limit(1);
  return (rows[0] as PinUserState | undefined) ?? null;
}

// Audit emission — include in the active transaction (or autocommit).
async function emitAudit(
  app: FastifyInstance,
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

/**
 * Memoized dummy hash so login verifies TWO hashes even when the user has no
 * duress PIN — keeping the perceived latency identical (Decision #37).
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPin('0000');
  return dummyHashPromise;
}

/** Verify the entered PIN against BOTH hashes (constant two-verify work). */
async function verifyPinPair(
  pin: string,
  posHash: string,
  duressHash: string | null,
): Promise<PinMatch> {
  const duressTarget = duressHash ?? (await getDummyHash());
  const [matchesPos, duressVerify] = await Promise.all([
    verifyPin(pin, posHash),
    verifyPin(pin, duressTarget),
  ]);
  return { matchesPos, matchesDuress: duressHash !== null && duressVerify };
}

/**
 * Fire the silent alarm in the BACKGROUND — never blocks or fails the login.
 * Three best-effort legs, each independently guarded: audit_log row →
 * `alert.duress` ledger event (broadcasts to the SSE feed) → optional webhook.
 */
function triggerSilentAlarm(
  app: FastifyInstance,
  webhookUrl: string,
  ctx: {
    userId: string;
    deviceId: string | null;
    ip: string | null;
    sessionId: string;
    route: 'pin-login' | 'step-up';
  },
): void {
  void (async () => {
    const at = new Date().toISOString();
    try {
      await app.db.insert(auditLog).values({
        eventType: 'security.duress_login_alert',
        actorUserId: ctx.userId,
        deviceId: ctx.deviceId,
        ipAddress: ctx.ip,
        payload: { route: ctx.route, session_id: ctx.sessionId, at },
      });
    } catch (err) {
      app.log.error({ err }, 'duress alarm: audit_log insert failed');
    }
    try {
      await emit(app.db, {
        eventType: 'alert.duress',
        entityTable: 'users',
        entityId: ctx.userId,
        actorUserId: ctx.userId,
        deviceId: ctx.deviceId,
        ipAddress: ctx.ip,
        payload: { route: ctx.route, at },
      });
    } catch (err) {
      app.log.error({ err }, 'duress alarm: ledger emit failed');
    }
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'duress', userId: ctx.userId, route: ctx.route, at }),
        });
      } catch (err) {
        app.log.error({ err }, 'duress alarm: webhook POST failed');
      }
    }
  })();
}

// ────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────

const authPinRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const duressWebhookUrl = opts.env.DURESS_ALARM_WEBHOOK_URL;

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

      // Verify against BOTH hashes (constant work), then classify.
      const match = await verifyPinPair(pin, state.posPinHash, state.duressPinHash);
      const { pinCorrect, isDuress } = classifyPinAttempt(match);
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
        // biome-ignore lint/style/noNonNullAssertion: failed_now_locked always carries a lockedUntil.
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

      // The desktop apps run in a Tauri webview (origin `tauri.localhost`),
      // which is a DIFFERENT site from api.warehouse14.de — so the session
      // cookie must be SameSite=None (+Secure) or the browser drops it on
      // every cross-site data fetch and the whole app reads as empty. In prod
      // the public edge is HTTPS (Cloudflare), even though the internal hop to
      // the container is plain http, so force Secure there.
      {
        const crossSite = process.env.NODE_ENV === 'production';
        reply.setCookie('warehouse14.session', token, {
          httpOnly: true,
          secure: crossSite ? true : req.protocol === 'https',
          sameSite: crossSite ? 'none' : 'lax',
          path: '/',
          expires: expiresAt,
        });
      }

      // Duress: log in normally, then fire the silent alarm in the background.
      if (isDuress) {
        triggerSilentAlarm(app, duressWebhookUrl, {
          userId: state.id,
          deviceId: req.deviceId,
          ip,
          sessionId,
          route: 'pin-login',
        });
      }

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

      const match = await verifyPinPair(pin, state.posPinHash, state.duressPinHash);
      const { pinCorrect, isDuress } = classifyPinAttempt(match);
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
        // biome-ignore lint/style/noNonNullAssertion: failed_now_locked always carries a lockedUntil.
        throw new PinLockedError(decision.newState.lockedUntil!);
      }
      if (decision.kind === 'failed') {
        throw new UnauthorizedError(
          `Invalid PIN (${PIN_FAILED_THRESHOLD - decision.newState.failedAttempts} attempts remaining)`,
        );
      }

      // Duress at step-up: refresh the window normally, then alarm in background.
      if (isDuress) {
        triggerSilentAlarm(app, duressWebhookUrl, {
          userId: state.id,
          deviceId: req.deviceId,
          ip,
          sessionId: req.session.sessionId,
          route: 'step-up',
        });
      }

      return { ok: true as const, lastPinStepUpAt: now.toISOString() };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/pin/set — set or change the POS PIN (requires Full Login)
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
          .where(eq(users.id, req.actor.id));

        await tx.insert(auditLog).values({
          eventType: 'pin.set',
          actorUserId: req.actor.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: { lockout_minutes: PIN_LOCKOUT_MINUTES, threshold: PIN_FAILED_THRESHOLD },
        });
      });

      return { ok: true as const, setAt: now.toISOString() };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/duress-pin/set — register/rotate the duress PIN
  //
  // Requires a valid session. The new PIN must pass the policy (blacklist in
  // prod) AND differ from the user's current POS PIN — verified in-app since
  // argon2id salts every hash (the DB CHECK only catches a literal hash copy).
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/duress-pin/set',
    {
      schema: {
        tags: ['auth'],
        summary: 'Set or rotate the duress PIN (must differ from the POS PIN)',
        body: PinSetBody,
        response: { 200: PinSetResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      const { newPin } = req.body as Static<typeof PinSetBody>;
      const ip = req.ip || null;

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

      const state = await loadPinUserState(app, req.actor.id);
      if (!state || !state.posPinHash) {
        throw new UnauthorizedError('Set a POS PIN before registering a duress PIN');
      }

      // Distinctness: the duress PIN must not equal the POS PIN.
      const sameAsPos = await verifyPin(newPin, state.posPinHash);
      if (sameAsPos) {
        throw new UnauthorizedError('Duress PIN must differ from your POS PIN');
      }

      const hash = await hashPin(newPin);
      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ duressPinHash: hash, duressPinSetAt: now })
          .where(eq(users.id, req.actor.id));

        await tx.insert(auditLog).values({
          eventType: 'pin.set_duress',
          actorUserId: req.actor.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: { duress: true },
        });
      });

      return { ok: true as const, setAt: now.toISOString() };
    },
  );
};

export default authPinRoutes;
