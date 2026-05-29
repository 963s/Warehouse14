/**
 * GET /health — combined liveness + readiness probe.
 *
 * • `ok: true` means the process is alive (liveness).
 * • `db: 'up' | 'down'` is a 1-second-budget SELECT against PG (readiness).
 *
 * A failed DB check still returns HTTP 200 with `ok: true, db: 'down'` —
 * Kubernetes / Cloudflare distinguishes "the pod is dead" (liveness 5xx) from
 * "the pod is alive but degraded" (readiness body). Operators read the body.
 *
 * `version` is the static package version — useful in incident review.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

const HealthResponse = Type.Object({
  ok: Type.Boolean(),
  db: Type.Union([Type.Literal('up'), Type.Literal('down')]),
  version: Type.String(),
  timestamp: Type.String({ format: 'date-time' }),
});

const VERSION = '0.1.0'; // align with package.json — kept static, no env lookup

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness + readiness probe',
        description:
          'Always 200 if the process is alive. The body reports `db: "down"` ' +
          'when the readiness check fails (caller decides what to do).',
        response: { 200: HealthResponse },
      },
    },
    async (_req, _reply) => {
      let dbStatus: 'up' | 'down' = 'down';
      try {
        // 1-second budget — long enough for transient hiccups, short enough that
        // a hung Postgres does not block the readiness probe.
        await Promise.race([
          app.db.execute(drizzleSql`SELECT 1`),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('db readiness timeout')), 1_000),
          ),
        ]);
        dbStatus = 'up';
      } catch (err) {
        app.log.warn({ err }, 'db readiness check failed');
      }
      return {
        ok: true,
        db: dbStatus,
        version: VERSION,
        timestamp: new Date().toISOString(),
      };
    },
  );
};

export default healthRoute;
