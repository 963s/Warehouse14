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
import { composeWelcome, enqueueEmail } from '@warehouse14/email';
import { localeFromAcceptLanguage, normalizeEmailLocale } from '@warehouse14/email';
import { SHOPPER_SESSION_TTL_MS, newSessionToken, setShopperCookie } from './storefront-auth.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Short-lived cookie holding the signed PKCE/state payload during the round-trip. */
const OAUTH_STATE_COOKIE = 'warehouse14.gauth';
const OAUTH_STATE_PATH = '/api/storefront/auth/google';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the consent.

interface StatePayload {
  /** Native-app handoff nonce (mobile shop app). Empty for the web flow. */
  appNonce?: string;
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

const HANDOFF_TTL_MS = 5 * 60 * 1000;

interface ShopperHandoff {
  token: string;
  expiresAt: string;
  createdAt: number;
}

/**
 * In-memory native-handoff store (mirrors the admin flow): the phone app
 * begins login with ?nonce=…, the browser leg completes here, and the app
 * claims the minted shopper session exactly once. Single-use + 5min TTL;
 * the unguessable nonce IS the capability.
 */
const shopperHandoffs = new Map<string, ShopperHandoff>();

function sanitizeAppNonce(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(t) ? t : null;
}

function sweepShopperHandoffs(now: number): void {
  for (const [k, h] of shopperHandoffs) {
    if (now - h.createdAt > HANDOFF_TTL_MS) shopperHandoffs.delete(k);
  }
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
    async (
      req: FastifyRequest<{ Querystring: { returnTo?: string; nonce?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!configured()) {
        return reply.status(503).send({
          error: { code: 'NOT_CONFIGURED', message: 'Google-Anmeldung ist nicht eingerichtet.' },
        });
      }
      const codeVerifier = randomToken();
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const appNonce = sanitizeAppNonce(req.query.nonce);
      const payload: StatePayload = {
        state: randomToken(),
        codeVerifier,
        nonce: randomToken(),
        returnTo: sanitizeReturnTo(req.query.returnTo),
        exp: Date.now() + STATE_TTL_MS,
        ...(appNonce ? { appNonce } : {}),
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
      // Which language this person reads. Google's own locale claim is the
      // best signal here, since the handoff happens in a browser and there is
      // no in-app picker in the loop; the request header is the fallback. The
      // account was previously hardcoded to German, so every Google shopper
      // got German letters no matter what they had chosen in the app.
      // Everything else Google verified about this person. We used to discard
      // all of it and then ask the customer at the counter for details Google
      // had already confirmed. Empty string means "Google did not send it",
      // which stays NULL rather than becoming an empty name.
      const givenName = String(claims.given_name ?? '').trim();
      const familyName = String(claims.family_name ?? '').trim();
      const pictureUrl = String(claims.picture ?? '').trim();
      const claimLocale = String(claims.locale ?? '').trim();
      const signInLocale = claimLocale
        ? normalizeEmailLocale(claimLocale)
        : localeFromAcceptLanguage(req.headers['accept-language']);
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
              // Link Google to the existing email account. SECURITY: an account
              // that was NOT already email-verified holds a password that was
              // never proven to belong to this address (there is no email-verify
              // flow, so a password sign-up leaves email_verified_at NULL). Google
              // has now proven ownership, so we DISCARD that untrusted password —
              // otherwise a pre-registration attacker who signed up the victim's
              // email keeps their password after the victim's first Google login
              // (classic-federated-merge account takeover). verifyPassword returns
              // false on a NULL hash, so the stale password then cleanly fails
              // sign-in; the CHECK (password_hash OR google_sub) stays satisfied.
              shopperId = byEmail[0].id;
              await tx.execute(drizzleSql`
                UPDATE shoppers
                   SET google_sub = ${sub},
                       password_hash = CASE
                         WHEN email_verified_at IS NULL THEN NULL
                         ELSE password_hash
                       END,
                       email_verified_at = COALESCE(email_verified_at, now()),
                       updated_at = now()
                 WHERE id = ${shopperId}`);
            }
          }

          if (!shopperId) {
            // Email lands on the CUSTOMERS row too — the record staff read
            // at the POS and in the owner apps (the 2026-07-20 gap: Google
            // customers showed name only, no contact).
            const [c] = await tx
              .insert(customers)
              .values({
                fullNameEncrypted: drizzleSql`encrypt_pii(${displayName})` as never,
                emailEncrypted: drizzleSql`encrypt_pii(${email})` as never,
                emailBlindIndex: drizzleSql`blind_index(${email})` as never,
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
                preferredLanguage: signInLocale,
              })
              .returning({ id: shoppers.id });
            if (!s) throw new Error('shopper insert returned no row');
            shopperId = s.id;
            // Welcome letter for the brand-new account — best-effort.
            try {
              await enqueueEmail(tx, email, composeWelcome(displayName, signInLocale), c.id);
            } catch {
              /* outbox unavailable — sign-in still succeeds */
            }
          } else {
            // Existing account signing in with Google: make sure the staff
            // record carries the contact (accounts created before 0088 had
            // the email only on the shopper row).
            await tx.execute(drizzleSql`
              UPDATE customers c
                 SET email_encrypted   = encrypt_pii(${email}),
                     email_blind_index = COALESCE(c.email_blind_index, blind_index(${email})),
                     updated_at        = now()
                FROM shoppers s
               WHERE s.id = ${shopperId} AND c.id = s.customer_id
                 AND c.email_encrypted IS NULL
            `);
          }

          // ── Profile sync, EVERY sign in, not just the first ────────────
          // Names and pictures change, and a profile frozen at first login
          // slowly stops describing the person standing at the counter. One
          // statement covers all three paths above (found by subject, linked
          // by email, freshly created). COALESCE on the incoming value means
          // a claim Google stops sending never erases what we already hold.
          await tx.execute(drizzleSql`
            UPDATE shoppers
               SET given_name_encrypted  = COALESCE(${
                 givenName ? drizzleSql`encrypt_pii(${givenName})` : drizzleSql`NULL`
               }, given_name_encrypted),
                   family_name_encrypted = COALESCE(${
                     familyName ? drizzleSql`encrypt_pii(${familyName})` : drizzleSql`NULL`
                   }, family_name_encrypted),
                   picture_url_encrypted = COALESCE(${
                     pictureUrl ? drizzleSql`encrypt_pii(${pictureUrl})` : drizzleSql`NULL`
                   }, picture_url_encrypted),
                   last_seen_at          = now(),
                   updated_at            = now()
             WHERE id = ${shopperId}
          `);

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

      // Native shop app: park the session for the single-use claim and land the
      // browser on a calm "return to the app" note instead of the web shop.
      if (st.appNonce) {
        sweepShopperHandoffs(Date.now());
        shopperHandoffs.set(st.appNonce, {
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          createdAt: Date.now(),
        });
        // Bounce straight back into the app: the client opens this leg inside
        // a system auth session (ASWebAuthenticationSession / Custom Tabs)
        // whose completion URL is the app scheme below — the redirect closes
        // the sheet automatically and the app claims the parked session
        // immediately.
        //
        // Der sichtbare KNOPF ist nicht Deko: Chrome auf Android blockiert die
        // AUTOMATISCHEN Sprünge (meta refresh + location.replace) zu einem
        // App-Schema ohne Nutzergeste — genau daran „klemmte" die Anmeldung
        // (Basels Befund 24.07.2026). Ein Tippen auf den Knopf ist die Geste,
        // die immer durchgeht; die App-seitige Claim-Schleife bleibt das Netz.
        return reply
          .type('text/html; charset=utf-8')
          .send(
            '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<meta http-equiv="refresh" content="0;url=warehouse14shop://google-fertig">' +
              '<body style="font-family:-apple-system,system-ui;display:grid;place-items:center;height:90vh;margin:0">' +
              '<div style="max-width:26rem;text-align:center">' +
              '<p style="font-size:1.05rem;line-height:1.5">' +
              'Anmeldung erfolgreich.</p>' +
              '<a href="warehouse14shop://google-fertig" style="display:inline-block;padding:.85rem 1.6rem;' +
              'border-radius:.75rem;background:#a3823b;color:#fff;text-decoration:none;font-weight:600">' +
              'Zur&uuml;ck zur App</a></div>' +
              '<script>location.replace("warehouse14shop://google-fertig")</script></body>',
          );
      }

      return reply.redirect(`${base}${st.returnTo || '/konto'}`);
    },
  );

  // ── POST /api/storefront/auth/google/claim ───────────────────────────
  // The native shop app polls here with its nonce until the browser leg lands.
  app.post(
    '/api/storefront/auth/google/claim',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Claim a completed native Google login (shop app).',
        hide: true,
      },
    },
    async (req: FastifyRequest<{ Body: { nonce?: string } }>, reply: FastifyReply) => {
      const nonce = sanitizeAppNonce((req.body ?? {}).nonce);
      if (!nonce) {
        return reply
          .status(400)
          .send({ error: { code: 'BAD_REQUEST', message: 'nonce fehlt oder ist ungültig.' } });
      }
      sweepShopperHandoffs(Date.now());
      const h = shopperHandoffs.get(nonce);
      if (!h) return { ok: false as const, pending: true };
      shopperHandoffs.delete(nonce); // single-use
      // Set the session cookie ON THIS RESPONSE. The claim is the one request
      // the native app itself makes in the handoff, and iOS XHR refuses a
      // manually written Cookie header — the app can only authenticate via
      // its NATIVE cookie jar (withCredentials). Without Set-Cookie here the
      // jar keeps whatever session it had before (typically the guest one),
      // so the shopper "signs in with Google" yet keeps browsing as the
      // guest — the exact 2026-07-20 bug. With it, the jar replaces the
      // guest cookie atomically and the Google session survives restarts.
      setShopperCookie(reply, h.token, new Date(h.expiresAt));
      return { ok: true as const, token: h.token, expiresAt: h.expiresAt };
    },
  );
};

export default storefrontGoogleAuthRoutes;
