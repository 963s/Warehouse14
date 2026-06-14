/**
 * Storefront "Sign in with Google" — OAuth 2.0 authorization-code flow + PKCE.
 *
 *   GET /api/storefront/auth/google/start
 *       — 302 to Google's consent screen with state + PKCE challenge + nonce.
 *   GET /api/storefront/auth/google/callback
 *       — verify state, exchange the code SERVER-SIDE, verify the id_token
 *         claims, upsert the shopper, set the `warehouse14.shopper_session`
 *         cookie, then 302 back to the storefront account page.
 *
 * Security model
 * ──────────────
 *   • Authorization-code flow with PKCE (S256). The browser never sees the
 *     client secret; the code→token exchange happens server-to-server.
 *   • CSRF/replay defense: a single-use, HMAC-signed state cookie carries
 *     {state, codeVerifier, nonce, returnTo, exp}, signed with AUTH_SECRET. The
 *     callback recomputes the MAC (timing-safe) and matches the `state` echoed
 *     by Google before doing anything.
 *   • The id_token is received DIRECTLY from Google's token endpoint over TLS,
 *     so per OIDC Core §3.1.3.7 signature verification is not strictly required;
 *     we still verify iss / aud / exp / nonce / email_verified.
 *   • A Google login proves a VERIFIED EMAIL only. It is NOT a GwG identification
 *     and sets NO KYC flag — identity for thresholded gold stays the in-shop POS
 *     path. `email_verified_at` here is account email verification, not KYC.
 *
 * The shopper account model mirrors storefront-auth.ts exactly (1:1 customer +
 * shopper, the `warehouse14.shopper_session` cookie). A Google identity is keyed
 * on the stable `sub` claim; an existing email-account is linked on first login.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { customers, shopperSessions, shoppers } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { SHOPPER_SESSION_TTL_MS, newSessionToken, setShopperCookie } from './storefront-auth.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Short-lived cookie holding the signed PKCE/state payload during the round-trip. */
const OAUTH_STATE_COOKIE = 'warehouse14.gauth';
const OAUTH_STATE_PATH = '/api/storefront/auth/google';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the consent.

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
  // Length-guard before timingSafeEqual (it throws on mismatched lengths).
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
 * Only ever redirect to a SAME-SITE relative path. Rejects absolute URLs and
 * protocol-relative (`//evil.com`) targets — an open-redirect guard.
 */
function sanitizeReturnTo(v: unknown): string {
  if (typeof v !== 'string') return '/konto';
  if (!v.startsWith('/') || v.startsWith('//')) return '/konto';
  return v;
}

function redirectUriFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/storefront/auth/google/callback`;
}

const storefrontGoogleAuthRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const { env } = opts;

  function configured(): boolean {
    return !!(
      env.GOOGLE_STOREFRONT_CLIENT_ID &&
      env.GOOGLE_STOREFRONT_CLIENT_SECRET &&
      env.STOREFRONT_PUBLIC_URL
    );
  }

  // ── GET /api/storefront/auth/google/start ────────────────────────────
  app.get(
    '/api/storefront/auth/google/start',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Begin Sign-in-with-Google (302 to Google).',
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
        returnTo: sanitizeReturnTo(req.query.returnTo),
        exp: Date.now() + STATE_TTL_MS,
      };
      reply.setCookie(OAUTH_STATE_COOKIE, signState(payload, env.AUTH_SECRET), {
        path: OAUTH_STATE_PATH,
        httpOnly: true,
        // lax (not strict) so the cookie survives the top-level GET redirect back
        // from accounts.google.com; secure in production.
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: Math.floor(STATE_TTL_MS / 1000),
      });

      const url = new URL(GOOGLE_AUTH_URL);
      url.searchParams.set('client_id', env.GOOGLE_STOREFRONT_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUriFor(env.STOREFRONT_PUBLIC_URL));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', payload.state);
      url.searchParams.set('nonce', payload.nonce);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('access_type', 'online');
      url.searchParams.set('prompt', 'select_account');
      return reply.redirect(url.toString());
    },
  );

  // ── GET /api/storefront/auth/google/callback ─────────────────────────
  app.get(
    '/api/storefront/auth/google/callback',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Google OAuth callback — exchange code, sign the shopper in.',
        hide: true,
      },
    },
    async (
      req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
      reply: FastifyReply,
    ) => {
      const base = env.STOREFRONT_PUBLIC_URL.replace(/\/+$/, '');
      // Honest failure → back to the sign-in page with a flag (never leak detail).
      const fail = () => reply.redirect(`${base}/anmelden?fehler=google`);

      if (!configured()) {
        return reply.status(503).send({
          error: { code: 'NOT_CONFIGURED', message: 'Google-Anmeldung ist nicht eingerichtet.' },
        });
      }

      const raw = (req.cookies as Record<string, string | undefined>)?.[OAUTH_STATE_COOKIE];
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH });

      const q = req.query;
      if (q.error || !q.code || !q.state) return fail();
      const st = verifyState(raw, env.AUTH_SECRET);
      if (!st || st.state !== q.state) return fail();

      // Exchange the code SERVER-SIDE (client secret + PKCE verifier).
      let claims: Record<string, unknown> | null = null;
      try {
        const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: q.code,
            client_id: env.GOOGLE_STOREFRONT_CLIENT_ID,
            client_secret: env.GOOGLE_STOREFRONT_CLIENT_SECRET,
            redirect_uri: redirectUriFor(env.STOREFRONT_PUBLIC_URL),
            grant_type: 'authorization_code',
            code_verifier: st.codeVerifier,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!tokenResp.ok) return fail();
        const tokens = (await tokenResp.json()) as { id_token?: string };
        if (!tokens.id_token) return fail();
        claims = decodeJwtClaims(tokens.id_token);
      } catch {
        return fail();
      }
      if (!claims) return fail();

      // Verify the id_token claims (token came directly from Google over TLS).
      const iss = String(claims.iss ?? '');
      if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') return fail();
      if (String(claims.aud ?? '') !== env.GOOGLE_STOREFRONT_CLIENT_ID) return fail();
      const exp = typeof claims.exp === 'number' ? claims.exp : 0;
      if (exp * 1000 < Date.now()) return fail();
      if (String(claims.nonce ?? '') !== st.nonce) return fail();

      const sub = String(claims.sub ?? '');
      const email = String(claims.email ?? '')
        .trim()
        .toLowerCase();
      const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
      const displayName = String(claims.name ?? '').trim() || email;
      // Require a verified Google email — an unverified address is not trustworthy
      // as an account anchor (and is certainly not a GwG identity).
      if (!sub || !email || !emailVerified) return fail();

      // Upsert the shopper: by google_sub, then link an existing email account,
      // else create customer + shopper. All PII goes through encrypt_pii/blind_index.
      let session: { token: string; expiresAt: Date } | null = null;
      try {
        session = await app.withPii(async (tx) => {
          const bySub = await tx.execute<{ id: string }>(drizzleSql`
            SELECT id FROM shoppers
             WHERE google_sub = ${sub} AND soft_deleted_at IS NULL
             LIMIT 1`);
          let shopperId = bySub[0]?.id ?? null;

          if (!shopperId) {
            const byEmail = await tx.execute<{ id: string }>(drizzleSql`
              SELECT id FROM shoppers
               WHERE email_blind_index = blind_index(${email}) AND soft_deleted_at IS NULL
               LIMIT 1`);
            if (byEmail[0]) {
              // Link Google to the existing email account.
              shopperId = byEmail[0].id;
              await tx.execute(drizzleSql`
                UPDATE shoppers
                   SET google_sub = ${sub},
                       email_verified_at = COALESCE(email_verified_at, now()),
                       updated_at = now()
                 WHERE id = ${shopperId}`);
            }
          }

          if (!shopperId) {
            const [c] = await tx
              .insert(customers)
              .values({
                fullNameEncrypted: drizzleSql`encrypt_pii(${displayName})` as never,
                retentionUntil: drizzleSql`(now() + interval '5 years')::date` as never,
              })
              .returning({ id: customers.id });
            if (!c) throw new Error('customer insert returned no row');
            const [s] = await tx
              .insert(shoppers)
              .values({
                customerId: c.id,
                emailEncrypted: drizzleSql`encrypt_pii(${email})` as never,
                emailBlindIndex: drizzleSql`blind_index(${email})` as never,
                googleSub: sub,
                emailVerifiedAt: drizzleSql`now()` as never,
                preferredLanguage: 'de',
              })
              .returning({ id: shoppers.id });
            if (!s) throw new Error('shopper insert returned no row');
            shopperId = s.id;
          }

          const token = newSessionToken();
          const expiresAt = new Date(Date.now() + SHOPPER_SESSION_TTL_MS);
          await tx.insert(shopperSessions).values({
            shopperId,
            token,
            expiresAt,
            ipAddress: (req.ip ?? null) as never,
            userAgent: req.headers['user-agent'] ?? null,
          });
          return { token, expiresAt };
        });
      } catch (err) {
        req.log.error({ err }, 'storefront google login: shopper upsert failed');
        return fail();
      }

      setShopperCookie(reply, session.token, session.expiresAt);
      return reply.redirect(`${base}${st.returnTo || '/konto'}`);
    },
  );
};

export default storefrontGoogleAuthRoutes;
