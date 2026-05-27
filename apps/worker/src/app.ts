/**
 * `buildWorker(opts)` — the testable factory for `apps/worker`.
 *
 * Returns:
 *   • `runner`  — JobRunner with all V1 jobs registered (but cron NOT started).
 *   • `metrics` — the prom-client Registry, exposed via Fastify /metrics.
 *   • `httpServer` — Fastify instance bound to 127.0.0.1:<METRICS_PORT> for
 *     /metrics + /health. Bound to localhost only — Prometheus scrapes from
 *     the same VM (ADR-0012). NEVER exposes business endpoints.
 *   • `close()` — graceful shutdown: stop runner + close http + end pool.
 *
 * `server.ts` calls `buildWorker(env)` then `runner.startSchedules()` to
 * begin actual cron-driven execution. Tests skip `startSchedules` and drive
 * `runner.runOnce(jobName)` directly.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifySensible from '@fastify/sensible';
import type { Sql } from 'postgres';

import { connectWorker, type WorkerDb } from '@warehouse14/db/client';

import type { Env } from './config/env.js';
import { createMetrics, type WorkerMetrics } from './lib/metrics.js';
import { JobRunner } from './lib/job-runner.js';
import {
  anomalyWatchdogJob,
  chainVerifierJob,
  dsfinvkDailyExportJob,
  lbmaPricesJob,
  reservationSweeperJob,
  sessionsCleanupJob,
  storefrontCartSweeperJob,
} from './jobs/index.js';

export interface BuildWorkerOpts {
  env: Env;
  /** Optional override — tests inject a testcontainer-backed client pair. */
  dbOverride?: {
    db: WorkerDb;
    sql: Sql;
    /** URL the runner uses for the per-job advisory-lock connection. */
    lockConnectionUrl: string;
  };
  /** Skip cron registration. Tests use `'manual'` and call `runOnce` directly. */
  schedule?: 'cron' | 'manual';
}

export interface WorkerHandle {
  runner: JobRunner;
  metrics: WorkerMetrics;
  httpServer: FastifyInstance;
  close: () => Promise<void>;
}

export async function buildWorker(opts: BuildWorkerOpts): Promise<WorkerHandle> {
  const metrics = createMetrics();

  // Resolve the DB clients.
  let workerDb: WorkerDb;
  let workerSql: Sql;
  let lockUrl: string;
  let ownedConnections = false;
  if (opts.dbOverride) {
    workerDb = opts.dbOverride.db;
    workerSql = opts.dbOverride.sql;
    lockUrl = opts.dbOverride.lockConnectionUrl;
  } else {
    const { db, sql } = connectWorker({
      url: opts.env.DATABASE_URL,
      max: opts.env.DB_POOL_MAX,
      applicationName: 'warehouse14_worker',
    });
    workerDb = db;
    workerSql = sql;
    lockUrl = opts.env.DATABASE_URL;
    ownedConnections = true;
    // Smoke test — fail fast if URL/role wrong.
    await sql`SELECT 1`;
  }

  const runner = new JobRunner({
    db: workerDb,
    sql: workerSql,
    lockConnectionUrl: lockUrl,
    metrics,
    defaults: {
      maxRetries: opts.env.WORKER_DEFAULT_MAX_RETRIES,
      timeoutMs: opts.env.WORKER_DEFAULT_TIMEOUT_MS,
    },
    schedule: opts.schedule ?? 'cron',
    logger: {
      info: (msg, extra) => console.log(JSON.stringify({ level: 'info', msg, ...extra })),
      warn: (msg, extra) => console.warn(JSON.stringify({ level: 'warn', msg, ...extra })),
      error: (msg, extra) => console.error(JSON.stringify({ level: 'error', msg, ...extra })),
      debug: (msg, extra) =>
        opts.env.LOG_LEVEL === 'debug' || opts.env.LOG_LEVEL === 'trace'
          ? console.debug(JSON.stringify({ level: 'debug', msg, ...extra }))
          : undefined,
    },
  });

  // Register V1 jobs. Order doesn't affect runtime — cron handles scheduling.
  runner.register(reservationSweeperJob);
  runner.register(chainVerifierJob);
  runner.register(sessionsCleanupJob);
  runner.register(anomalyWatchdogJob);
  runner.register(lbmaPricesJob({ url: opts.env.LBMA_PRICES_URL }));
  runner.register(dsfinvkDailyExportJob);
  // Day 20: B2C cart expiry — releases 15-min STOREFRONT soft locks.
  runner.register(storefrontCartSweeperJob);

  // Tiny Fastify for /metrics + /health.
  const httpServer = Fastify({
    logger: {
      level: opts.env.LOG_LEVEL,
    },
    disableRequestLogging: true,
    trustProxy: false,
  });
  await httpServer.register(fastifySensible);

  httpServer.get('/health', async (_req, reply) => {
    let dbStatus: 'up' | 'down' = 'down';
    try {
      await workerSql`SELECT 1`;
      dbStatus = 'up';
    } catch { /* up=false */ }
    return reply.status(200).send({ ok: true, db: dbStatus, version: '0.1.0', timestamp: new Date().toISOString() });
  });

  httpServer.get('/metrics', async (_req, reply) => {
    reply.header('content-type', metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });

  return {
    runner,
    metrics,
    httpServer,
    close: async () => {
      await runner.close().catch(() => {});
      await httpServer.close().catch(() => {});
      if (ownedConnections) {
        await workerSql.end({ timeout: 5 }).catch(() => {});
      }
    },
  };
}
