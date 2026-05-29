/**
 * Auth plugin — better-auth wiring + session/actor population.
 *
 * Two responsibilities:
 *   1. Mount better-auth's HTTP handler at `/api/auth/*`. better-auth ships
 *      a framework-agnostic `auth.handler(Request) → Response` function;
 *      we translate Fastify req/reply ↔ Fetch Request/Response.
 *   2. Run a `preHandler` hook that — for every non-public route — reads the
 *      session cookie, fetches the actor+session from the DB, and populates
 *      `req.actor` + `req.session` for the policy helpers to consume.
 *
 * What this plugin does NOT do:
 *   • PIN auth — that lives in `routes/auth-pin.ts` and calls into our own
 *     `@warehouse14/auth-pin` package + emits a session row directly.
 *   • mTLS — separate plugin, runs earlier in the pipeline.
 *   • PII key injection — separate plugin.
 *
 * Public route list:
 *   `/health`, `/metrics`, `/docs`, `/docs/*`, `/openapi.json`, `/api/auth/*`
 *   are public. Everything else demands an actor.
 */

import { betterAuth } from 'better-auth';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

import type { Env } from '../config/env.js';
import { loadActorBySession } from '../lib/actor.js';
import { isPublicRoute } from '../lib/public-routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    auth: ReturnType<typeof betterAuth>;
  }
}

export interface AuthPluginOpts {
  env: Env;
}

const authPlugin: FastifyPluginAsync<AuthPluginOpts> = async (app, opts) => {
  // ──────────────────────────────────────────────────────────────────────
  // 1. Construct the better-auth instance.
  //
  // We use better-auth's framework-agnostic core. The Kysely-driven default
  // adapter speaks postgres directly using `DATABASE_URL` — no Drizzle
  // adapter wiring needed here. Migration 0004 already defined the schema
  // better-auth expects (users / sessions / accounts / verifications +
  // two_factors via plugin).
  // ──────────────────────────────────────────────────────────────────────

  // better-auth 1.3.x removed the string-based dialect shorthand and now
  // requires either a Kysely Dialect instance, a Drizzle adapter, or a node-pg
  // Pool. The pg Pool is the smallest dependency add and is what better-auth's
  // current docs recommend.
  const auth = betterAuth({
    database: new Pool({ connectionString: opts.env.DATABASE_URL }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    session: {
      // Default 8h fixed — Owner extension is applied by our PIN-login route,
      // not by better-auth (which doesn't know about `is_owner`).
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60 * 24, // refresh updatedAt at most daily
    },
    trustedOrigins: opts.env.TRUSTED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    advanced: {
      cookies: {
        session_token: { name: 'warehouse14.session' },
      },
    },
  });

  app.decorate('auth', auth);

  // ──────────────────────────────────────────────────────────────────────
  // 2. Mount better-auth's handler at /api/auth/*.
  //
  // better-auth speaks the Fetch API (Request → Response). We translate the
  // Fastify req → Request and pipe the Response → Fastify reply.
  // ──────────────────────────────────────────────────────────────────────
  app.all('/api/auth/*', async (req, reply) => {
    const host = req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
    const url = new URL(req.url, `${proto}://${host}`);

    // Fastify already parsed JSON body; re-serialize for Fetch Request.
    const init: RequestInit = {
      method: req.method,
      headers: req.headers as Record<string, string>,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    const fetchReq = new Request(url, init);
    const fetchRes = await auth.handler(fetchReq);

    reply.status(fetchRes.status);
    fetchRes.headers.forEach((v, k) => {
      // Avoid `host` / `content-length` — Fastify computes its own.
      if (k === 'host' || k === 'content-length') return;
      reply.header(k, v);
    });
    return reply.send(await fetchRes.text());
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. preHandler — populate req.actor + req.session from the cookie.
  //    Public routes skip this; the cookie may be absent and that's fine.
  // ──────────────────────────────────────────────────────────────────────
  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (isPublicRoute(req.url)) {
      return;
    }

    // Look up the session via the cookie name we configured above.
    const cookie = req.headers.cookie;
    if (!cookie) return; // No cookie → unauthenticated; route helpers throw.

    const sessionToken = parseSessionCookie(cookie, 'warehouse14.session');
    if (!sessionToken) return;

    // The cookie carries the session token. Look up the session by token,
    // then load the actor+session bundle.
    const result = await app.db.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.token, sessionToken),
      columns: { id: true, expiresAt: true },
    });
    if (!result) return;
    if (result.expiresAt.getTime() < Date.now()) return;

    const bundle = await loadActorBySession(app.db, result.id);
    if (!bundle) return;

    req.actor = bundle.actor;
    req.session = bundle;
  });
};

/** Cookie parser scoped to our session cookie name only. */
function parseSessionCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export default fastifyPlugin(authPlugin, {
  name: 'warehouse14-auth',
  fastify: '4.x',
  dependencies: ['warehouse14-db'],
});
