/**
 * Rate limiting (Day 16 audit fix A-1).
 *
 * Defends against brute-force at the HTTP layer. The PIN lockout (5
 * attempts → 30 min lock at the DB level) protects PIN-login, but every
 * other endpoint — email/password, step-up, even reads — was previously
 * unbounded. An attacker could hammer `/api/auth/sign-in` from rotating
 * IPs to brute-force passwords.
 *
 * Strategy:
 *   • Global default: 300 requests / minute / key.
 *   • Per-route override: routes set `config: { rateLimit: { max, timeWindow } }`.
 *     - /api/auth/* gets 10/minute/IP (very strict — brute-force surface).
 *     - sensitive writes (storno, finalize) get 30/minute/actor.
 *   • Key: `req.actor.id` when authenticated, else `req.ip`.
 *
 * V1 storage is in-memory. Phase 1.5 swaps to Redis once the Oracle Cloud
 * Redis container lands (ADR-0012 §6). The plugin's API surface is
 * unchanged on that swap.
 *
 * Order: this plugin MUST be registered AFTER `auth` so `req.actor` is
 * populated by the time the key generator runs. For public auth routes
 * (`/api/auth/*`), `req.actor` is null and the key falls back to IP — which
 * is the correct behavior for brute-force defense.
 */

import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { Env } from '../config/env.js';

export interface RateLimitPluginOpts {
  env: Env;
}

const rateLimitPlugin: FastifyPluginAsync<RateLimitPluginOpts> = async (app, opts) => {
  await app.register(fastifyRateLimit, {
    // Global default: tolerant for normal usage, hard cap on abuse.
    max: 300,
    timeWindow: '1 minute',

    // Skip /health, /metrics, /docs — they're internal/monitoring.
    skipOnError: false,
    allowList: (req): boolean => {
      const path = req.url.split('?')[0] ?? '';
      // Day 19: webhook delivery from Stripe must NEVER be rate-limited —
      // Stripe will retry but we want the FIRST delivery to land so the
      // idempotency table records it. Stripe imposes its own retry policy.
      if (path === '/api/webhooks/stripe' || path.startsWith('/api/webhooks/')) return true;
      return (
        path === '/health' ||
        path === '/metrics' ||
        path === '/' ||
        path === '' ||
        path.startsWith('/docs') ||
        path === '/openapi.json'
      );
    },

    // Key: per-actor when authenticated, per-IP otherwise.
    keyGenerator: (req: FastifyRequest): string => {
      const actor = (req as FastifyRequest & { actor?: { id: string } | null }).actor;
      return actor?.id ?? req.ip ?? 'unknown';
    },

    // Error message is replaced by our error-handler's RATE_LIMITED code;
    // we just need to throw with the right shape.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded: ${ctx.max} per ${ctx.after}. Retry after ${ctx.ttl}ms.`,
    }),

    // In dev we relax — the bootstrap script + repeated curl tests would
    // otherwise hit the cap. In test we relax for the same reason. In
    // production these limits stand.
    enableDraftSpec: true, // emit `RateLimit-*` headers (RFC IETF draft)
    ...(opts.env.NODE_ENV !== 'production' ? { max: 10_000 } : {}),
  });
};

export default fastifyPlugin(rateLimitPlugin, {
  name: 'warehouse14-rate-limit',
  fastify: '4.x',
});
