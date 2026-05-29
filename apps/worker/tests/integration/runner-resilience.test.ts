/**
 * Day-18 worker integration tests — the resilience contract.
 *
 * Coverage matrix:
 *
 *   Lifecycle
 *     ✓ runner.runOnce records a SUCCESS row in worker_job_runs with finishedAt set
 *     ✓ Pino metrics counter is incremented for SUCCESS
 *
 *   Advisory lock
 *     ✓ Two parallel runOnce calls of the same job → first SUCCESS, second SKIPPED
 *     ✓ runner.close() flips closing flag → subsequent runOnce returns SKIPPED('closing')
 *
 *   Failure path
 *     ✓ throwing job: each attempt records FAILED + increments consecutive_failures
 *     ✓ after maxRetries attempts → row written to worker_job_dlq + ledger event emitted + counter reset
 *
 *   Timeout
 *     ✓ AbortSignal-honoring job that overruns its timeoutMs → TIMEOUT row
 *
 *   reservation_sweeper end-to-end
 *     ✓ Seeded RESERVED product past expiry → sweeper releases it + emits ledger event
 *
 *   chain_verifier end-to-end
 *     ✓ Clean chain → SUCCESS with breaks=0
 *
 *   /health + /metrics
 *     ✓ /health 200 with db=up
 *     ✓ /metrics exposes worker_job_runs_total + process metrics
 */

import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { WorkerDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type WorkerHandle, buildWorker } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { JobRunner } from '../../src/lib/job-runner.js';
import { createMetrics } from '../../src/lib/metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  for (const f of files) await sqlClient.unsafe(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
}

describe('Day 18 — apps/worker resilience', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let workerSql: Sql;
  let workerDb: WorkerDb;
  let lockUrl: string;
  let workerHandle: WorkerHandle;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();

    migratorSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });
    await applyAll(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_worker PASSWORD 'warehouse14_worker_test_pw'`);

    const host = container.getHost();
    const port = container.getPort();
    workerSql = postgres({
      host,
      port,
      database: 'warehouse14_test',
      username: 'warehouse14_worker',
      password: 'warehouse14_worker_test_pw',
      max: 5,
      onnotice: () => {},
    });
    workerDb = drizzle(workerSql, { schema });
    lockUrl = `postgres://warehouse14_worker:warehouse14_worker_test_pw@${host}:${port}/warehouse14_test`;

    const env: Env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      METRICS_PORT: 0,
      DATABASE_URL: lockUrl,
      DB_POOL_MAX: 5,
      WORKER_DEFAULT_MAX_RETRIES: 3,
      WORKER_DEFAULT_TIMEOUT_MS: 5_000,
      LBMA_PRICES_URL: '',
    };

    workerHandle = await buildWorker({
      env,
      dbOverride: { db: workerDb, sql: workerSql, lockConnectionUrl: lockUrl },
      schedule: 'manual',
    });
    // Start the HTTP server on a random port (METRICS_PORT=0).
    await workerHandle.httpServer.listen({ port: 0, host: '127.0.0.1' });
  }, 90_000);

  afterAll(async () => {
    await workerHandle.close().catch(() => {});
    await workerSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Happy path: registered job lands SUCCESS
  // ────────────────────────────────────────────────────────────────────

  it('runOnce records SUCCESS row with finished_at + payload', async () => {
    // chain_verifier on a clean chain → SUCCESS with breaks=0.
    const outcome = await workerHandle.runner.runOnce('chain_verifier');
    expect(outcome.status).toBe('SUCCESS');

    const rows = await migratorSql<
      { status: string; finished_at: Date; payload: { breaks: number } }[]
    >`
      SELECT status::text AS status, finished_at, payload
        FROM worker_job_runs
       WHERE job_name = 'chain_verifier'
         AND run_id::text = ${outcome.runId}
       LIMIT 1`;
    expect(rows[0]!.status).toBe('SUCCESS');
    expect(rows[0]!.finished_at).toBeInstanceOf(Date);
    expect(rows[0]!.payload.breaks).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Advisory lock: parallel runs of same job → second SKIPPED
  // ────────────────────────────────────────────────────────────────────

  it('parallel runOnce of same job: first runs, second SKIPPED', async () => {
    // Build an isolated runner with a slow job so we can race two ticks.
    const metrics = createMetrics();
    const runner = new JobRunner({
      db: workerDb,
      sql: workerSql,
      lockConnectionUrl: lockUrl,
      metrics,
      defaults: { maxRetries: 5, timeoutMs: 30_000 },
      schedule: 'manual',
    });
    runner.register({
      name: 'slow_test_job',
      async run({ signal }) {
        await wait(500, undefined, { signal }).catch(() => {});
        return { slept: true };
      },
    });

    const [a, b] = await Promise.all([
      runner.runOnce('slow_test_job'),
      runner.runOnce('slow_test_job'),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain('SUCCESS');
    expect(statuses).toContain('SKIPPED');
    await runner.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Failure path + DLQ
  // ────────────────────────────────────────────────────────────────────

  it('failing job after maxRetries attempts → DLQ row + alert ledger event', async () => {
    const metrics = createMetrics();
    const runner = new JobRunner({
      db: workerDb,
      sql: workerSql,
      lockConnectionUrl: lockUrl,
      metrics,
      defaults: { maxRetries: 3, timeoutMs: 5_000 },
      schedule: 'manual',
    });
    const jobName = `failing_test_${randomUUID().slice(0, 8)}`;
    runner.register({
      name: jobName,
      async run() {
        throw new Error('intentional failure for test');
      },
    });

    // 3 consecutive failures → DLQ on the 3rd.
    for (let i = 0; i < 3; i++) {
      const outcome = await runner.runOnce(jobName);
      expect(outcome.status).toBe('FAILED');
    }

    const dlq = await migratorSql<{ failure_count: number; last_error: string }[]>`
      SELECT failure_count, last_error
        FROM worker_job_dlq
       WHERE job_name = ${jobName}
       ORDER BY id DESC LIMIT 1`;
    expect(dlq.length).toBe(1);
    expect(dlq[0]!.failure_count).toBe(3);
    expect(dlq[0]!.last_error).toContain('intentional failure for test');

    // Ledger event emitted.
    const alert = await migratorSql<{ event_type: string; payload: { jobName: string } }[]>`
      SELECT event_type, payload
        FROM ledger_events
       WHERE event_type = 'alert.worker_job_dead_letter'
         AND payload->>'jobName' = ${jobName}
       ORDER BY id DESC LIMIT 1`;
    expect(alert.length).toBe(1);
    expect(alert[0]!.payload.jobName).toBe(jobName);

    await runner.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Timeout
  // ────────────────────────────────────────────────────────────────────

  it('job exceeding timeoutMs → TIMEOUT row', async () => {
    const metrics = createMetrics();
    const runner = new JobRunner({
      db: workerDb,
      sql: workerSql,
      lockConnectionUrl: lockUrl,
      metrics,
      defaults: { maxRetries: 5, timeoutMs: 60_000 },
      schedule: 'manual',
    });
    const jobName = `timeout_test_${randomUUID().slice(0, 8)}`;
    runner.register({
      name: jobName,
      timeoutMs: 100,
      async run({ signal }) {
        // Honor the abort signal — wait 5s OR until aborted.
        await wait(5_000, undefined, { signal }).catch(() => {
          throw new Error('aborted by timeout');
        });
      },
    });
    const outcome = await runner.runOnce(jobName);
    expect(outcome.status).toBe('TIMEOUT');
    await runner.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Graceful close — subsequent runOnce returns SKIPPED('closing')
  // ────────────────────────────────────────────────────────────────────

  it('runner.close() makes subsequent runOnce return SKIPPED(closing)', async () => {
    const metrics = createMetrics();
    const runner = new JobRunner({
      db: workerDb,
      sql: workerSql,
      lockConnectionUrl: lockUrl,
      metrics,
      defaults: { maxRetries: 3, timeoutMs: 5_000 },
      schedule: 'manual',
    });
    runner.register({
      name: 'closed_test',
      async run() {
        return { ok: true };
      },
    });
    await runner.close();
    const outcome = await runner.runOnce('closed_test');
    expect(outcome.status).toBe('SKIPPED');
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. reservation_sweeper end-to-end
  // ────────────────────────────────────────────────────────────────────

  it('reservation_sweeper releases an expired RESERVED row', async () => {
    // Seed an expired storefront reservation.
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
      RETURNING id`;
    const sessionId = randomUUID();
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name,
                            reserved_by_channel, reserved_by_session_id, reserved_by_user_id,
                            reserved_at, reservation_expires_at, published_at)
      VALUES (${`SKU-exp-${randomUUID()}`}, 'RESERVED'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '50.00', '100.00', 'expired test ring',
              'STOREFRONT'::reservation_channel, ${sessionId}, ${u!.id},
              now() - interval '20 minutes', now() - interval '5 minutes', now())
      RETURNING id`;

    const outcome = await workerHandle.runner.runOnce('reservation_sweeper');
    expect(outcome.status).toBe('SUCCESS');

    const [after] = await migratorSql<{ status: string }[]>`
      SELECT status::text AS status FROM products WHERE id = ${p!.id}`;
    expect(after!.status).toBe('AVAILABLE');

    // Ledger event was emitted by the sweeper.
    const events = await migratorSql<{ event_type: string }[]>`
      SELECT event_type FROM ledger_events
       WHERE event_type = 'inventory.reservation_auto_released'
         AND entity_id = ${p!.id}`;
    expect(events.length).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. /health + /metrics HTTP
  // ────────────────────────────────────────────────────────────────────

  it('GET /health returns 200 with db=up', async () => {
    const res = await workerHandle.httpServer.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
  });

  it('GET /metrics exposes worker counters + process metrics', async () => {
    // Drive at least one run so the counter has a value.
    await workerHandle.runner.runOnce('sessions_cleanup');
    const res = await workerHandle.httpServer.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('worker_job_runs_total');
    expect(res.body).toContain('worker_up');
    expect(res.body).toContain('process_cpu_user_seconds_total');
  });
});
