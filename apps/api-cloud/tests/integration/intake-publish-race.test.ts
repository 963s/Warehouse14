/**
 * Phase-2 P1.5 — concurrent intake publishes create exactly ONE product.
 *
 * The publish route checked `status = 'READY_FOR_REVIEW'` in a statement that
 * committed BEFORE the product-insert transaction opened. Two concurrent
 * publishes of the same session both passed the check and both created a product
 * (with DIFFERENT skus, so neither hit the sku-unique guard); the second
 * `UPDATE intake_sessions SET product_id` overwrote the first, orphaning product
 * #1 forever. The fix folds the guard INSIDE the transaction with FOR UPDATE.
 *
 * This is a genuine RACE: two concurrent requests with different skus. Without
 * FOR UPDATE → two products. With it → exactly one (the loser blocks, re-reads
 * 'PUBLISHED', and is rejected 400). Real Postgres via testcontainers.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { applyAllMigrations } from './_migrate.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN SUPERUSER PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a seeded row');
  return v;
}

describe('intake publish — concurrent publishes create exactly one product (P1.5)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let adminFingerprint: string;
  let adminSessionToken: string;
  let staffPhoneId: string;

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
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 5,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });

    const env = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      BOT_MAX_CONCURRENT: 4,
      WAREHOUSE14_PII_KEY: PII_KEY,
      TRUSTED_ORIGINS: '',
      TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
      R2_ACCOUNT_ID: '',
      R2_BUCKET: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_PUBLIC_URL_BASE: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_WEBHOOK_TOLERANCE_SECONDS: 300,
      STRIPE_API_VERSION: '2024-12-18.acacia',
      WHATSAPP_APP_SECRET: '',
      WHATSAPP_VERIFY_TOKEN: '',
    } as unknown as Env;
    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });

    // Admin user + device + session (publish is ADMIN-only).
    const [admin] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`a-${randomUUID()}@x.test`}, 'Admin', 'ADMIN'::user_role) RETURNING id`;
    const adminId = must(admin).id;
    adminFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${adminFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${adminId}) RETURNING id`;
    adminSessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminId}, ${adminSessionToken}, now() + interval '8 hours', ${must(dev).id}, now())`;
    const [phone] = await migratorSql<{ id: string }[]>`
      INSERT INTO staff_phone_numbers (user_id, phone_e164, role, verified_at)
      VALUES (${adminId}, ${`+49${Math.floor(Math.random() * 1e9)}`}, 'BOTH', now()) RETURNING id`;
    staffPhoneId = must(phone).id;
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  let sessionId: string;
  beforeEach(async () => {
    await migratorSql`DELETE FROM products`;
    const [s] = await migratorSql<{ id: string }[]>`
      INSERT INTO intake_sessions (staff_phone_id, grouping_closes_at, status)
      VALUES (${staffPhoneId}::uuid, now(), 'READY_FOR_REVIEW'::intake_status) RETURNING id`;
    sessionId = must(s).id;
  });

  function publish(sku: string) {
    return app.inject({
      method: 'POST',
      url: `/api/intake/drafts/${sessionId}/publish`,
      headers: {
        'content-type': 'application/json',
        cookie: `warehouse14.session=${adminSessionToken}`,
        'x-dev-device-fingerprint': adminFingerprint,
      },
      payload: {
        name: 'Race watch',
        sku,
        itemType: 'watch',
        taxTreatmentCode: 'STANDARD_19',
        acquisitionCostEur: '50.00',
        listPriceEur: '119.00',
        adminVerificationNote: 'verified',
      },
    });
  }

  it('two concurrent publishes (different skus) → exactly one product, one 400', async () => {
    const [rA, rB] = await Promise.all([
      publish(`SKU-A-${randomUUID()}`),
      publish(`SKU-B-${randomUUID()}`),
    ]);

    const codes = [rA.statusCode, rB.statusCode].sort();
    expect(codes).toEqual([200, 400]); // exactly one wins, the loser is rejected

    const products = await migratorSql`SELECT id FROM products`;
    expect(products).toHaveLength(1); // NO orphaned second product

    const [sess] = await migratorSql<{ status: string; product_id: string | null }[]>`
      SELECT status::text AS status, product_id::text AS product_id
      FROM intake_sessions WHERE id = ${sessionId}::uuid`;
    expect(must(sess).status).toBe('PUBLISHED');
    expect(must(sess).product_id).not.toBeNull();
  });
});
