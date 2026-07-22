/**
 * ebay_sync reconciler — integration test (Epic D).
 *
 * Ein Stück, das am Tresen verkauft wurde (status=SOLD) und dessen Inserat
 * noch ONLINE steht, durchläuft drei Durchgänge:
 *
 *   1. ohne eBay-Zugang  → bleibt ONLINE, keine Historie. Vorher stand hier
 *      das Gegenteil, und das war die Gefahr: der Abgleich meldete „beendet",
 *      ohne eBay je gefragt zu haben.
 *   2. mit Zugang        → BEENDET + eine WORKER-Zeile, über einen
 *      eBay-Doppelgänger statt über einen erfundenen Erfolg.
 *   3. noch einmal       → nichts kommt hinzu (der geschützte UPDATE).
 *
 * Requires Docker (Postgres testcontainer) + extension privileges — runs in
 * CI; skipped where the sandbox keyring/extension setup is unavailable.
 */

import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorkerDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';

import { ebaySyncJob } from '../../src/jobs/ebay-sync.js';

import { type WorkerHandle, buildWorker } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  for (const f of files) await sqlClient.unsafe(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
}

describe('ebay_sync reconciler', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let workerSql: Sql;
  let workerDb: WorkerDb;
  let handle: WorkerHandle;

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
    const lockUrl = `postgres://warehouse14_worker:warehouse14_worker_test_pw@${host}:${port}/warehouse14_test`;

    const env: Env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      METRICS_PORT: 0,
      DATABASE_URL: lockUrl,
      DB_POOL_MAX: 5,
      WORKER_DEFAULT_MAX_RETRIES: 3,
      WORKER_DEFAULT_TIMEOUT_MS: 5_000,
      METAL_PRICE_PROVIDER: 'disabled',
      METAL_PRICE_API_KEY: '',
      LBMA_PRICES_URL: '',
      EBAY_API_TOKEN: '', // → mock EndItem
    };

    handle = await buildWorker({
      env,
      dbOverride: { db: workerDb, sql: workerSql, lockConnectionUrl: lockUrl },
      schedule: 'manual',
    });
    await handle.httpServer.listen({ port: 0, host: '127.0.0.1' });
  }, 90_000);

  afterAll(async () => {
    await handle?.close().catch(() => {});
    await workerSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  async function seedSoldOnlineProduct(): Promise<string> {
    const rows = await migratorSql<{ id: string }[]>`
      INSERT INTO products
        (sku, status, tax_treatment_code, item_type, name,
         acquisition_cost_eur, list_price_eur, ebay_state)
      VALUES
        (${`SKU-${randomUUID()}`}, 'SOLD'::product_status, 'MARGIN_25A',
         'gold_jewelry'::item_type, 'Sold ring', '50.00', '150.00',
         'ONLINE'::ebay_listing_state)
      RETURNING id`;
    const id = rows[0]?.id;
    if (!id) throw new Error('seed product insert returned no id');
    return id;
  }

  /** Ein Stück, drei Durchgänge: ohne Zugang, mit Zugang, noch einmal. */
  let ringId = '';

  it('leaves the listing ONLINE when no eBay access is configured', async () => {
    // Diese Datei forderte vorher das Gegenteil: mit leerem Token erwartete sie
    // BEENDET. Der Abgleich meldete das Inserat also als vom Markt genommen,
    // ohne eBay je gefragt zu haben. Weil hier jedes Stück ein Einzelstück ist,
    // hätte es weiterverkauft werden können, während es im Haus schon
    // verkauft war. Auf der Produktion ist kein Token gesetzt.
    ringId = await seedSoldOnlineProduct();

    // Der Lauf ist ausdrücklich ein Erfolg: nichts ist ausgefallen, es fehlt
    // nur der Zugang, und die Zeile wartet auf den nächsten Durchgang.
    const outcome = await handle.runner.runOnce('ebay_sync');
    expect(outcome.status).toBe('SUCCESS');

    const [product] = await migratorSql<{ ebay_state: string }[]>`
      SELECT ebay_state::text AS ebay_state FROM products WHERE id = ${ringId}`;
    expect(product?.ebay_state).toBe('ONLINE');

    const events = await migratorSql<{ to_state: string }[]>`
      SELECT to_state::text AS to_state FROM product_ebay_listing_events
       WHERE product_id = ${ringId}`;
    expect(events).toHaveLength(0);
  });

  it('ends the listing for real once eBay answers', async () => {
    // Dasselbe Stück wie eben, das absichtlich ONLINE stehen geblieben ist:
    // der Inhaber trägt den Zugang nach, der nächste Durchgang beendet es.
    // Der Erfolgsweg läuft über einen eBay-Doppelgänger, nicht über „ohne
    // Zugang gilt als beendet" — genau diese Bequemlichkeit war der Fehler.
    const calls: string[] = [];
    handle.runner.register(
      ebaySyncJob({
        token: 'tok-test',
        fetchImpl: (_url, init) => {
          calls.push(String(init?.body ?? ''));
          return Promise.resolve(
            new Response('<EndItemResponse><Ack>Success</Ack></EndItemResponse>', {
              status: 200,
              headers: { 'content-type': 'text/xml' },
            }),
          );
        },
      }),
    );

    const outcome = await handle.runner.runOnce('ebay_sync');
    expect(outcome.status).toBe('SUCCESS');
    // eBay wurde wirklich gefragt.
    expect(calls).toHaveLength(1);

    const [product] = await migratorSql<{ ebay_state: string }[]>`
      SELECT ebay_state::text AS ebay_state FROM products WHERE id = ${ringId}`;
    expect(product?.ebay_state).toBe('BEENDET');

    const events = await migratorSql<{ to_state: string; changed_by_source: string }[]>`
      SELECT to_state::text AS to_state, changed_by_source
        FROM product_ebay_listing_events
       WHERE product_id = ${ringId}`;
    expect(events).toHaveLength(1);
    expect(events[0]?.to_state).toBe('BEENDET');
    expect(events[0]?.changed_by_source).toBe('WORKER');
  });

  it('writes no second event when it runs again over an already ended listing', async () => {
    // Der geschützte UPDATE (`WHERE ebay_state = 'ONLINE'`) darf beim
    // zweiten Durchgang kein zweites Ereignis in die Historie schreiben.
    const before = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM product_ebay_listing_events`;

    const outcome = await handle.runner.runOnce('ebay_sync');
    expect(outcome.status).toBe('SUCCESS');

    const after = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM product_ebay_listing_events`;
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));
  });
});
