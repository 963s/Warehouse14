/**
 * Storefront B2C auth routes (Day 19).
 *
 *   POST /api/storefront/auth/sign-up   — creates customer + shopper + session
 *   POST /api/storefront/auth/sign-in   — verify pw + lockout check + session
 *   POST /api/storefront/auth/sign-out  — revoke current session
 *
 * Distinct from staff auth (better-auth + PIN). Cookie name:
 * `warehouse14.shopper_session`. Lockout uses the same state machine as
 * the POS PIN (decideAttemptOutcome) — 5 wrong attempts → 30-minute lock.
 */

import { randomBytes } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import {
  type AttemptState,
  PasswordPolicy,
  decideAttemptOutcome,
  hashPassword,
  verifyPassword,
} from '@warehouse14/auth-pin';
import { customers, shopperSessions, shoppers } from '@warehouse14/db/schema';

import { composeWelcome, enqueueEmail } from '../lib/email-outbox.js';
import { localeFromAcceptLanguage } from '../lib/email-copy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { STOREFRONT_COOKIE_NAME } from '../plugins/storefront-session.js';
import {
  SignInBody,
  SignInResponse,
  SignUpBody,
  SignUpResponse,
  type SignInBody as TSignInBody,
  type SignUpBody as TSignUpBody,
} from '../schemas/storefront.js';

class ShopperUnauthorizedError extends DomainError {
  public readonly httpStatus = 401;
  public readonly code: ApiErrorCode = 'UNAUTHORIZED';
}
class ShopperConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class ShopperValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}
class ShopperLockedError extends DomainError {
  public readonly httpStatus = 423;
  public readonly code: ApiErrorCode = 'PIN_LOCKED';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export const SHOPPER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days rolling

/** Generate a 32-byte random session token, hex-encoded. */
export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Attach the cookie that the storefront-session plugin will read on later
 * requests.
 *
 * `secure` MUST track the REAL runtime environment. Previously both call sites
 * passed a hardcoded `{ NODE_ENV: 'development' }`, so the shopper session
 * cookie was NEVER marked Secure — even in production it travelled over any
 * plaintext hop and was exposed to network sniffing / downgrade attacks. We now
 * read `process.env.NODE_ENV` directly (this route is registered without an
 * `env` opt, so there is no typed env to thread through), which makes the cookie
 * Secure + correctly scoped in production while staying non-Secure in dev/test
 * so local HTTP and the integration harness keep working.
 */
export function setShopperCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  const isProduction = process.env.NODE_ENV === 'production';
  reply.setCookie(STOREFRONT_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    expires: expiresAt,
  });
}

const storefrontAuthRoutes: FastifyPluginAsync = async (app) => {
  // ════════════════════════════════════════════════════════════════════
  // POST /api/storefront/auth/sign-up
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Body: TSignUpBody }>(
    '/api/storefront/auth/sign-up',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Create a new shopper account.',
        description:
          'Creates a `customers` row (KYC-track) + a `shoppers` row (online account) ' +
          'in one DB transaction. Sets the `warehouse14.shopper_session` cookie. ' +
          'Email re-registration after soft-delete is allowed (partial UNIQUE).',
        body: SignUpBody,
        response: {
          201: SignUpResponse,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const body = req.body;

      // 1. Validate password strength.
      const pwErr = PasswordPolicy.validate(body.password, { email: body.email });
      if (pwErr) {
        throw new ShopperValidationError(`Weak password: ${pwErr.code}`, pwErr);
      }

      // 2. Hash the password (argon2id, ~100ms).
      const passwordHash = await hashPassword(body.password);

      // The language this person is registering IN. What the client explicitly
      // sends wins; otherwise the request's own Accept Language, which the
      // storefront sets from the picked locale. It decides both the stored
      // preference and the language of the welcome letter, so a Turkish
      // shopper is never greeted in German.
      const signupLocale = body.preferredLanguage ?? localeFromAcceptLanguage(req.headers['accept-language']);

      // 3. Insert customer + shopper in ONE transaction inside withPii.
      //    The encrypted email + blind index require warehouse14.pii_key.
      //    GUEST UPGRADE (0085): when the request carries a live GUEST session,
      //    upgrade that shopper row IN PLACE instead of inserting a new one —
      //    the guest's cart keys on shoppers.id, so it survives registration.
      const guestShopperId = req.shopper?.isGuest ? req.shopper.id : null;
      const result = await app.withPii(async (tx) => {
        // 3a. Reject if an active shopper already uses this email.
        const existing = await tx.execute<{ id: string }>(drizzleSql`
        SELECT s.id FROM shoppers s
         WHERE s.email_blind_index = blind_index(${body.email})
           AND s.soft_deleted_at IS NULL
         LIMIT 1
      `);
        if (existing[0]) {
          throw new ShopperConflictError('Email already registered.');
        }

        if (guestShopperId) {
          // In-place upgrade: real identity onto the guest row, keep the id.
          const phoneEncU = body.phone ? drizzleSql`encrypt_pii(${body.phone})` : drizzleSql`NULL`;
          const phoneBlindU = body.phone ? drizzleSql`blind_index(${body.phone})` : drizzleSql`NULL`;
          const upgraded = await tx.execute<{ id: string; customer_id: string }>(drizzleSql`
          UPDATE shoppers
             SET email_encrypted    = encrypt_pii(${body.email}),
                 email_blind_index  = blind_index(${body.email}),
                 password_hash      = ${passwordHash},
                 is_guest           = FALSE,
                 phone_encrypted    = ${phoneEncU},
                 phone_blind_index  = ${phoneBlindU},
                 preferred_language = ${signupLocale},
                 marketing_consent  = ${body.marketingConsent ?? false},
                 marketing_consent_at = ${body.marketingConsent ? drizzleSql`now()` : drizzleSql`NULL`},
                 updated_at         = now()
           WHERE id = ${guestShopperId} AND is_guest
           RETURNING id, customer_id
        `);
          const up = upgraded[0];
          if (up) {
            await tx.execute(drizzleSql`
            UPDATE customers
               SET full_name_encrypted = encrypt_pii(${body.fullName}),
                   email_encrypted     = encrypt_pii(${body.email}),
                   email_blind_index   = blind_index(${body.email}),
                   phone_encrypted     = ${body.phone ? drizzleSql`encrypt_pii(${body.phone})` : drizzleSql`phone_encrypted`},
                   phone_blind_index   = ${body.phone ? drizzleSql`blind_index(${body.phone})` : drizzleSql`phone_blind_index`},
                   updated_at          = now()
             WHERE id = ${up.customer_id}
          `);
            // Fresh session for the fresh identity (the guest session stays
            // valid until expiry but now resolves to a registered shopper).
            const token = newSessionToken();
            const expiresAt = new Date(Date.now() + SHOPPER_SESSION_TTL_MS);
            await tx.insert(shopperSessions).values({
              shopperId: up.id,
              token,
              expiresAt,
              ipAddress: (req.ip ?? null) as never,
              userAgent: req.headers['user-agent'] ?? null,
            });
            // Welcome letter — best-effort, never blocks the registration.
            try {
              await enqueueEmail(tx, body.email, composeWelcome(body.fullName, signupLocale));
            } catch {
              /* outbox unavailable — registration still succeeds */
            }
            return { shopperId: up.id, customerId: up.customer_id, token, expiresAt };
          }
          // Guest row vanished mid-flight — fall through to a normal insert.
        }

        // 3b. Create the customer (KYC-track). Email + phone land HERE too —
        // this is the row the POS and owner apps read; a customer whose
        // contact lives only on the shopper row is invisible to staff
        // (the 2026-07-20 gap Basel hit with his Google account).
        const phoneEncC = body.phone ? drizzleSql`encrypt_pii(${body.phone})` : drizzleSql`NULL`;
        const phoneBlindC = body.phone ? drizzleSql`blind_index(${body.phone})` : drizzleSql`NULL`;
        const [c] = await tx
          .insert(customers)
          .values({
            fullNameEncrypted: drizzleSql`encrypt_pii(${body.fullName})` as never,
            emailEncrypted: drizzleSql`encrypt_pii(${body.email})` as never,
            emailBlindIndex: drizzleSql`blind_index(${body.email})` as never,
            phoneEncrypted: phoneEncC as never,
            phoneBlindIndex: phoneBlindC as never,
            retentionUntil: drizzleSql`(now() + interval '5 years')::date` as never,
          })
          .returning({ id: customers.id });
        if (!c) throw new Error('customer insert returned no row');

        // 3c. Create the shopper.
        const phoneEnc = body.phone ? drizzleSql`encrypt_pii(${body.phone})` : drizzleSql`NULL`;
        const phoneBlind = body.phone ? drizzleSql`blind_index(${body.phone})` : drizzleSql`NULL`;
        const consentAt = body.marketingConsent ? drizzleSql`now()` : drizzleSql`NULL`;

        const [s] = await tx
          .insert(shoppers)
          .values({
            customerId: c.id,
            emailEncrypted: drizzleSql`encrypt_pii(${body.email})` as never,
            emailBlindIndex: drizzleSql`blind_index(${body.email})` as never,
            passwordHash,
            phoneEncrypted: phoneEnc as never,
            phoneBlindIndex: phoneBlind as never,
            preferredLanguage: signupLocale,
            marketingConsent: body.marketingConsent ?? false,
            marketingConsentAt: consentAt as never,
          })
          .returning({ id: shoppers.id });
        if (!s) throw new Error('shopper insert returned no row');

        // 3d. Open a session immediately (sign-up implies sign-in).
        const token = newSessionToken();
        const expiresAt = new Date(Date.now() + SHOPPER_SESSION_TTL_MS);
        await tx.insert(shopperSessions).values({
          shopperId: s.id,
          token,
          expiresAt,
          ipAddress: (req.ip ?? null) as never,
          userAgent: req.headers['user-agent'] ?? null,
        });

        // Welcome letter — best-effort, never blocks the registration.
        try {
          await enqueueEmail(tx, body.email, composeWelcome(body.fullName, signupLocale));
        } catch {
          /* outbox unavailable — registration still succeeds */
        }

        return { shopperId: s.id, customerId: c.id, token, expiresAt };
      });

      setShopperCookie(reply, result.token, result.expiresAt);
      return reply.status(201).send({
        shopperId: result.shopperId,
        customerId: result.customerId,
        emailVerified: false,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/storefront/auth/sign-in
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Body: TSignInBody }>(
    '/api/storefront/auth/sign-in',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Sign in an existing shopper (email + password).',
        description:
          'Verifies argon2id-hashed password. Increments failed_login_attempts on ' +
          'wrong password; locks the account for 30 minutes after 5 consecutive ' +
          'failures (same state machine as POS PIN).',
        body: SignInBody,
        response: {
          200: SignInResponse,
          401: ErrorResponse,
          423: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const body = req.body;

      const outcome = await app.withPii(async (tx) => {
        // 1. Resolve the shopper by email_blind_index (active rows only).
        const rows = await tx.execute<{
          id: string;
          password_hash: string;
          email_verified_at: Date | null;
          failed_login_attempts: number;
          locked_until: Date | null;
        }>(drizzleSql`
        SELECT id, password_hash, email_verified_at, failed_login_attempts, locked_until
          FROM shoppers
         WHERE email_blind_index = blind_index(${body.email})
           AND soft_deleted_at IS NULL
         LIMIT 1
      `);
        const row = rows[0];
        if (!row) {
          // Defuse user-enumeration timing leak — pretend to hash anyway.
          await verifyPassword(body.password, '$argon2id$v=19$m=19456,t=2,p=1$xxxxx$x');
          return { kind: 'no_user' as const };
        }

        // 2. State machine: try-attempt decision.
        const state: AttemptState = {
          failedAttempts: row.failed_login_attempts,
          lockedUntil: row.locked_until,
        };
        // Refuse outright if already locked.
        const pre = decideAttemptOutcome({ state, now: new Date(), pinCorrect: false });
        if (pre.kind === 'already_locked') {
          return { kind: 'locked' as const, until: pre.until };
        }

        // 3. Verify password.
        const ok = await verifyPassword(body.password, row.password_hash);
        const decision = decideAttemptOutcome({ state, now: new Date(), pinCorrect: ok });

        // 4. Persist the new state.
        if (decision.kind !== 'already_locked') {
          await tx
            .update(shoppers)
            .set({
              failedLoginAttempts: decision.newState.failedAttempts,
              lockedUntil: decision.newState.lockedUntil ?? null,
            })
            .where(eq(shoppers.id, row.id));
        }

        if (decision.kind === 'success') {
          // 5. Create session.
          const token = newSessionToken();
          const expiresAt = new Date(Date.now() + SHOPPER_SESSION_TTL_MS);
          await tx.insert(shopperSessions).values({
            shopperId: row.id,
            token,
            expiresAt,
            ipAddress: (req.ip ?? null) as never,
            userAgent: req.headers['user-agent'] ?? null,
          });
          return {
            kind: 'success' as const,
            shopperId: row.id,
            token,
            expiresAt,
            emailVerified: row.email_verified_at !== null,
          };
        }
        if (decision.kind === 'failed_now_locked') {
          return { kind: 'locked' as const, until: decision.newState.lockedUntil! };
        }
        return { kind: 'wrong_password' as const };
      });

      if (outcome.kind === 'success') {
        setShopperCookie(reply, outcome.token, outcome.expiresAt);
        return reply.status(200).send({
          shopperId: outcome.shopperId,
          emailVerified: outcome.emailVerified,
          sessionExpiresAt: outcome.expiresAt.toISOString(),
        });
      }
      if (outcome.kind === 'locked') {
        throw new ShopperLockedError(
          `Account locked until ${outcome.until.toISOString()}. Reset via password recovery.`,
        );
      }
      throw new ShopperUnauthorizedError('Invalid email or password.');
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/storefront/auth/sign-out
  // ════════════════════════════════════════════════════════════════════

  app.post(
    '/api/storefront/auth/sign-out',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Sign out — revoke the current shopper session.',
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (req, reply) => {
      // No requireShopper — silent no-op if already signed out.
      const token = (req.cookies as Record<string, string | undefined>)?.[STOREFRONT_COOKIE_NAME];
      if (token) {
        await app.db.delete(shopperSessions).where(eq(shopperSessions.token, token));
      }
      reply.clearCookie(STOREFRONT_COOKIE_NAME, { path: '/' });
      return reply.status(200).send({ ok: true });
    },
  );
};

export default storefrontAuthRoutes;
