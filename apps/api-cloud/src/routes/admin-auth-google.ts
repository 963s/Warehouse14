/**
 * Staff / Owner "Sign in with Google" — OAuth 2.0 authorization-code flow + PKCE.
 *
 *   GET /api/admin/auth/google/start
 *       — 302 to Google's consent screen with state + PKCE challenge + nonce.
 *   GET /api/admin/auth/google/callback
 *       — verify state, exchange the code SERVER-SIDE, verify the id_token
 *         claims, resolve the verified email against the `users` table, and —
 *         only if it maps to a provisioned staff member — mint a
 *         `warehouse14.session` and hand it back. An unknown email is refused.
 *
 * This is the STAFF door. It deliberately mirrors routes/storefront-auth-google.ts
 * (the customer door) but differs in one decisive way:
 *
 *   • The customer door CREATES an account for any verified Google email.
 *   • The staff door creates NOTHING. It resolves the email against the pre-
 *     provisioned `users` table and 403s anything it does not find. The role
 *     (ADMIN / CASHIER / READONLY) and the `is_owner` bit come from that row —
 *     never from Google, never from the client. Google proves IDENTITY; the
 *     server assigns AUTHORITY. Provisioning is admin-mediated (migrator role):
 *     see scripts/provision-staff.ts. A compromised app role cannot mint a staff
 *     account because it cannot write `users.role` / `users.is_owner`.
 *
 * Two locks stack:
 *   1. Google — the staff OAuth client's consent screen is org-restricted
 *      (Workspace-internal), so Google itself refuses any account outside the
 *      warehouse14.de organisation before the request ever reaches us.
 *   2. Us — the email must resolve to an active `users` row. Belt and braces.
 *
 * The session it mints is byte-for-byte the same shape as routes/auth-pin.ts:
 * a row in `sessions` (TTL 30d Owner / 8h staff), the `warehouse14.session`
 * cookie, AND the token echoed in the response so the Tauri/RN clients can carry
 * it as a Bearer header (the cross-site cookie is dropped by Windows WebView2).
 * Because a Google login is a full, fresh authentication, `last_pin_step_up_at`
 * is stamped now so step-up-gated actions work immediately after sign-in.
 */

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { auditLog, sessions } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Short-lived cookie holding the signed PKCE/state payload during the round-trip. */
const OAUTH_STATE_COOKIE = 'warehouse14.gauth.admin';
const OAUTH_STATE_PATH = '/api/admin/auth/google';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the consent.

/** Session lifetimes — identical to routes/auth-pin.ts (ADR-0022 §2). */
const OWNER_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days
const STAFF_TTL_MS = 8 * 60 * 60_000; // 8 hours

interface StatePayload {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

/** Random URL-safe token. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** HMAC-SHA256(payload, secret) → base64url. */
function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Sign a state payload as `<base64url(json)>.<mac>`. */
function signState(p: StatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

/** Verify + parse a signed state cookie. Returns null on any tamper/expiry. */
function verifyState(raw: string | undefined, secret: string): StatePayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = hmac(body, secret);
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Decode (NOT verify-signature) a JWT's payload claims. */
function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Where the callback may hand the freshly-minted session back to. The native
 * clients cannot read an httpOnly cross-site cookie, so they open the system
 * browser at `/start?returnTo=…` and receive the token via this redirect.
 * Allowed targets ONLY:
 *   • a same-site relative path (`/…`, not `//…`)  — browser testing
 *   • the app deep-link scheme `warehouse14://…`    — Android / iOS owner app
 *   • loopback `http://localhost[:port]` / `127.0.0.1` — desktop (Tauri) app
 * Anything else is an open-redirect vector and is rejected → JSON response.
 */
function sanitizeReturnTo(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (v.startsWith('warehouse14://')) return v;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/.test(v)) return v;
  return null;
}

/** Append a URL fragment (never a query — fragments are not written to access logs). */
function withFragment(target: string, params: Record<string, string>): string {
  const frag = new URLSearchParams(params).toString();
  const sep = target.includes('#') ? '&' : '#';
  return `${target}${sep}${frag}`;
}

function redirectUriFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/admin/auth/google/callback`;
}

const adminGoogleAuthRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const { env } = opts;

  function configured(): boolean {
    return !!(env.GOOGLE_STAFF_CLIENT_ID && env.GOOGLE_STAFF_CLIENT_SECRET && env.ADMIN_PUBLIC_URL);
  }

  /** Set the staff session cookie — identical attributes to routes/auth-pin.ts. */
  function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    const crossSite = process.env.NODE_ENV === 'production';
    reply.setCookie('warehouse14.session', token, {
      httpOnly: true,
      secure: crossSite ? true : false,
      sameSite: crossSite ? 'none' : 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  // ── GET /api/admin/auth/google/start ─────────────────────────────────
  app.get(
    '/api/admin/auth/google/start',
    {
      schema: {
        tags: ['auth'],
        summary: 'Begin staff Sign-in-with-Google (302 to Google).',
        security: [],
        hide: true,
      },
    },
    async (req: FastifyRequest<{ Querystring: { returnTo?: string } }>, reply: FastifyReply) => {
      if (!configured()) {
        return reply.status(503).send({
          error: { code: 'NOT_CONFIGURED', message: 'Google-Anmeldung ist nicht eingerichtet.' },
        });
      }
      const codeVerifier = randomToken();
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const payload: StatePayload = {
        state: randomToken(),
        codeVerifier,
        nonce: randomToken(),
        returnTo: sanitizeReturnTo(req.query.returnTo) ?? '',
        exp: Date.now() + STATE_TTL_MS,
      };
      reply.setCookie(OAUTH_STATE_COOKIE, signState(payload, env.AUTH_SECRET), {
        path: OAUTH_STATE_PATH,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: Math.floor(STATE_TTL_MS / 1000),
      });

      const url = new URL(GOOGLE_AUTH_URL);
      url.searchParams.set('client_id', env.GOOGLE_STAFF_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUriFor(env.ADMIN_PUBLIC_URL));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', payload.state);
      url.searchParams.set('nonce', payload.nonce);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('access_type', 'online');
      url.searchParams.set('prompt', 'select_account');
      // Hint Google to pre-select the Workspace org. Not a security boundary
      // (the org-restricted consent screen + the users-table lookup are), just UX.
      if (env.STAFF_GOOGLE_HD) url.searchParams.set('hd', env.STAFF_GOOGLE_HD);
      return reply.redirect(url.toString());
    },
  );

  // ── GET /api/admin/auth/google/callback ──────────────────────────────
  app.get(
    '/api/admin/auth/google/callback',
    {
      schema: {
        tags: ['auth'],
        summary: 'Staff Google OAuth callback — exchange code, resolve role, sign in.',
        security: [],
        hide: true,
      },
    },
    async (
      req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!configured()) {
        return reply.status(503).send({
          error: { code: 'NOT_CONFIGURED', message: 'Google-Anmeldung ist nicht eingerichtet.' },
        });
      }

      const raw = (req.cookies as Record<string, string | undefined>)?.[OAUTH_STATE_COOKIE];
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH });

      const q = req.query;
      const st = verifyState(raw, env.AUTH_SECRET);
      const returnTo = st ? sanitizeReturnTo(st.returnTo) : null;

      /** Deny: redirect to returnTo with an error fragment, else a JSON status. */
      const deny = (status: number, code: string, message: string) => {
        if (returnTo) return reply.redirect(withFragment(returnTo, { error: code }));
        return reply.status(status).send({ error: { code, message } });
      };

      if (q.error || !q.code || !q.state) return deny(400, 'OAUTH_FAILED', 'Anmeldung abgebrochen.');
      if (!st || st.state !== q.state) return deny(400, 'OAUTH_FAILED', 'Ungültiger Anmeldeversuch.');

      // Exchange the code SERVER-SIDE (client secret + PKCE verifier).
      let claims: Record<string, unknown> | null = null;
      try {
        const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: q.code,
            client_id: env.GOOGLE_STAFF_CLIENT_ID,
            client_secret: env.GOOGLE_STAFF_CLIENT_SECRET,
            redirect_uri: redirectUriFor(env.ADMIN_PUBLIC_URL),
            grant_type: 'authorization_code',
            code_verifier: st.codeVerifier,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!tokenResp.ok) return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');
        const tokens = (await tokenResp.json()) as { id_token?: string };
        if (!tokens.id_token) return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');
        claims = decodeJwtClaims(tokens.id_token);
      } catch {
        return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');
      }
      if (!claims) return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');

      // Verify the id_token claims (token came DIRECTLY from Google over TLS, so
      // per OIDC Core §3.1.3.7 signature re-verification is not strictly required;
      // we still verify iss / aud / exp / nonce / email_verified).
      const iss = String(claims.iss ?? '');
      if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
        return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');
      }
      if (String(claims.aud ?? '') !== env.GOOGLE_STAFF_CLIENT_ID) {
        return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');
      }
      const exp = typeof claims.exp === 'number' ? claims.exp : 0;
      if (exp * 1000 < Date.now()) return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');
      if (String(claims.nonce ?? '') !== st.nonce) {
        return deny(400, 'OAUTH_FAILED', 'Anmeldung fehlgeschlagen.');
      }

      const email = String(claims.email ?? '')
        .trim()
        .toLowerCase();
      const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
      const sub = String(claims.sub ?? '');
      if (!email || !emailVerified || !sub) {
        return deny(403, 'FORBIDDEN', 'Dieses Konto ist nicht freigeschaltet.');
      }

      // THE AUTHORISATION GATE: the email must resolve to an ACTIVE staff row.
      // Not found (or soft-deleted) → 403. Nothing is created here, ever.
      const staff = await app.db.query.users.findFirst({
        where: (u) => and(eq(u.email, email), isNull(u.softDeletedAt)),
        columns: { id: true, role: true, isOwner: true, preferredLanguage: true },
      });
      if (!staff) {
        const ip = req.ip ?? null;
        await app.db.insert(auditLog).values({
          eventType: 'auth.google_denied',
          actorUserId: null,
          deviceId: null,
          ipAddress: ip,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: { email, reason: 'not_provisioned' },
        });
        return deny(403, 'FORBIDDEN', 'Dieses Konto ist nicht freigeschaltet.');
      }

      // Mint the session — identical shape to routes/auth-pin.ts. Google login is
      // a full fresh authentication, so stamp a fresh step-up. No device binding:
      // the Google path does not carry mTLS device identity (device_id stays null).
      const ttlMs = staff.isOwner ? OWNER_TTL_MS : STAFF_TTL_MS;
      const sessionId = randomUUID();
      const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + ttlMs);
      const ip = req.ip ?? null;
      const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;

      await app.db.transaction(async (tx) => {
        await tx.insert(sessions).values({
          id: sessionId,
          userId: staff.id,
          token,
          expiresAt,
          ipAddress: ip,
          userAgent,
          deviceId: null,
          lastPinStepUpAt: new Date(),
        });
        await tx.insert(auditLog).values({
          eventType: 'auth.google_login',
          actorUserId: staff.id,
          deviceId: null,
          ipAddress: ip,
          userAgent,
          payload: { email, sub, isOwner: staff.isOwner, role: staff.role },
        });
      });

      setSessionCookie(reply, token, expiresAt);

      // Hand the session back. Native clients get the token in the URL fragment
      // (never the query string, so it is not written to any access log); browser
      // testers with no returnTo get the same JSON shape as pin-login.
      if (returnTo) {
        return reply.redirect(
          withFragment(returnTo, { token, expiresAt: expiresAt.toISOString() }),
        );
      }
      return {
        ok: true as const,
        sessionExpiresAt: expiresAt.toISOString(),
        actor: { id: staff.id, role: staff.role, isOwner: staff.isOwner },
        token,
      };
    },
  );
};

export default adminGoogleAuthRoutes;
