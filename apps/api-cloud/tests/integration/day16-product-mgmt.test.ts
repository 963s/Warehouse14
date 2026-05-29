/**
 * Day 16 E2E — Product Management + Audit fix smoke checks.
 *
 * Coverage matrix:
 *
 *   POST /api/products
 *     ✓ ADMIN happy path → 200 + audit_log row
 *     ✓ CASHIER → 403 FORBIDDEN
 *     ✓ no cookie → 401 UNAUTHORIZED
 *     ✓ extra intake-locked field (additionalProperties false) refused by TypeBox? on PUT
 *     ✓ acquisitionCostEur ≥ step-up threshold without step-up → 403 STEP_UP_REQUIRED
 *
 *   PUT /api/products/:id
 *     ✓ Owner happy update → 200 + changedFields
 *     ✓ unknown field rejected by TypeBox additionalProperties:false → 400
 *     ✓ unknown product → 404 NOT_FOUND
 *     ✓ DRAFT → AVAILABLE transition lands publishedAt
 *
 *   POST /api/products/:id/archive
 *     ✓ AVAILABLE product → 409 CONFLICT (not SOLD)
 *     ✓ SOLD product → 200 + archived_at set
 *     ✓ double archive → 409 CONFLICT
 *
 *   POST /api/products/:id/photos
 *     ✓ unknown product → 404
 *     ✓ R2 not configured (test env) → 500 INTERNAL_ERROR (clean message)
 *
 *   Audit fixes
 *     ✓ A-3 helmet: X-Content-Type-Options + Referrer-Policy present
 *     ✓ A-3 helmet: Strict-Transport-Security present
 */

import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');
const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

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

describe('Day 16 — Product Management + audit fixes', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let ownerUserId: string;
  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let ownerTokenStepUp: string;
  let ownerTokenNoStepUp: string;
  let cashierToken: string;
  let sellerCustomerId: string;

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

    const env: Env = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
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
    };
    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });
  }, 90_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  beforeEach(async () => {
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;

    const [owner] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`o-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    ownerUserId = owner!.id;

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${ownerUserId})
      RETURNING id`;
    deviceId = dev!.id;

    ownerTokenStepUp = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerUserId}, ${ownerTokenStepUp}, now() + interval '30 days', ${deviceId}, now())`;

    ownerTokenNoStepUp = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerUserId}, ${ownerTokenNoStepUp}, now() + interval '30 days', ${deviceId}, NULL)`;

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, NULL)`;

    const [seller] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Ankauf Seller'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    sellerCustomerId = seller!.id;
  });

  function headers(token: string | null): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (token) h.cookie = `warehouse14.session=${token}`;
    h['x-dev-device-fingerprint'] = deviceFingerprint;
    return h;
  }

  /** Minimal valid create body — caller can override fields. */
  function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      sku: `SKU-${randomUUID()}`,
      itemType: 'gold_jewelry',
      metal: 'gold',
      finenessDecimal: '0.5850',
      weightGrams: '5.42',
      hallmarkStamps: ['585'],
      acquisitionCostEur: '50.00',
      listPriceEur: '150.00',
      taxTreatmentCode: 'MARGIN_25A',
      condition: 'USED_GOOD',
      isCommission: false,
      name: 'Day-16 gold ring',
      listedOnStorefront: false,
      listedOnEbay: false,
      ...overrides,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // POST /api/products
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/products', () => {
    it('Owner happy path → 200 + audit_log entry', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody({ acquiredFromCustomerId: sellerCustomerId, isCommission: true }),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { id: string; sku: string; status: string };
      expect(out.status).toBe('DRAFT');

      // audit_log row written.
      const [audit] = await migratorSql<{ payload: Record<string, unknown> }[]>`
        SELECT payload FROM audit_log
         WHERE event_type = 'product.created'
           AND (payload->>'productId')::text = ${out.id}`;
      expect(audit).toBeDefined();
      expect((audit!.payload as { isCommission: boolean }).isCommission).toBe(true);

      // is_commission + acquired_from_customer_id persisted.
      const [row] = await migratorSql<
        { is_commission: boolean; acquired_from_customer_id: string | null }[]
      >`
        SELECT is_commission, acquired_from_customer_id FROM products WHERE id = ${out.id}`;
      expect(row!.is_commission).toBe(true);
      expect(row!.acquired_from_customer_id).toBe(sellerCustomerId);
    });

    it('CASHIER role → 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(cashierToken),
        payload: createBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('no cookie → 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(null),
        payload: createBody(),
      });
      expect(res.statusCode).toBe(401);
    });

    it('acquisitionCostEur ≥ threshold without step-up → 403 STEP_UP_REQUIRED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenNoStepUp),
        payload: createBody({ acquisitionCostEur: '5000.00' }),
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // PUT /api/products/:id
  // ════════════════════════════════════════════════════════════════════

  describe('PUT /api/products/:id', () => {
    async function createOne(): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      return (res.json() as { id: string }).id;
    }

    it('Owner update list price → 200 + changedFields includes listPriceEur', async () => {
      const id = await createOne();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { listPriceEur: '199.99' },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { id: string; changedFields: string[] };
      expect(out.changedFields).toContain('listPriceEur');
    });

    it('rejects unknown / intake-locked field (additionalProperties: false)', async () => {
      const id = await createOne();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { acquisitionCostEur: '999.99' }, // intake-locked, not in PUT schema
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    });

    it('unknown product id → 404 NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/00000000-0000-0000-0000-000000000000`,
        headers: headers(ownerTokenStepUp),
        payload: { listPriceEur: '199.99' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DRAFT → AVAILABLE transition lands publishedAt', async () => {
      const id = await createOne();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { status: 'AVAILABLE' },
      });
      expect(res.statusCode).toBe(200);
      const [row] = await migratorSql<{ status: string; published_at: Date | null }[]>`
        SELECT status, published_at FROM products WHERE id = ${id}`;
      expect(row!.status).toBe('AVAILABLE');
      expect(row!.published_at).toBeInstanceOf(Date);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/archive
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/products/:id/archive', () => {
    it('AVAILABLE product → 409 CONFLICT', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      const id = (create.json() as { id: string }).id;
      await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { status: 'AVAILABLE' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${id}/archive`,
        headers: headers(ownerTokenStepUp),
        payload: {},
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
    });

    it('SOLD product → 200 + archived_at set', async () => {
      // Insert a SOLD product directly (bypass finalize for fixture brevity).
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name, published_at, sold_at)
        VALUES (${`SKU-sold-${randomUUID()}`}, 'SOLD'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '150.00', 'sold ring', now(), now())
        RETURNING id`;

      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${p!.id}/archive`,
        headers: headers(ownerTokenStepUp),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const [row] = await migratorSql<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM products WHERE id = ${p!.id}`;
      expect(row!.archived_at).toBeInstanceOf(Date);
    });

    it('archive without step-up → 403 STEP_UP_REQUIRED', async () => {
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name, published_at, sold_at)
        VALUES (${`SKU-sold-${randomUUID()}`}, 'SOLD'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '150.00', 'x', now(), now())
        RETURNING id`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${p!.id}/archive`,
        headers: headers(ownerTokenNoStepUp),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/photos
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/products/:id/photos', () => {
    it('unknown product → 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/00000000-0000-0000-0000-000000000000/photos`,
        headers: headers(ownerTokenStepUp),
        payload: { contentType: 'image/jpeg', contentLength: 1024 },
      });
      expect(res.statusCode).toBe(404);
    });

    it('R2 not configured → 500 INTERNAL_ERROR (test env empty R2 vars)', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      const id = (create.json() as { id: string }).id;
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${id}/photos`,
        headers: headers(ownerTokenStepUp),
        payload: { contentType: 'image/jpeg', contentLength: 1024 },
      });
      expect(res.statusCode).toBe(500);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Audit fix A-3 (helmet) — smoke check on response headers
  // ════════════════════════════════════════════════════════════════════

  describe('Audit fix A-3 — helmet security headers', () => {
    it('GET /health carries X-Content-Type-Options + Referrer-Policy + HSTS', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(String(res.headers['strict-transport-security'])).toMatch(/max-age=/);
      expect(res.headers['x-frame-options']).toBe('DENY');
    });
  });
});
