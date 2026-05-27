/**
 * Day 17 E2E — Catalog + Customers + DEBT + audit fixes.
 *
 * Coverage:
 *   GET  /api/products
 *     ✓ ADMIN sees all
 *     ✓ filter status=AVAILABLE excludes DRAFT/SOLD
 *     ✓ filter q (search) matches name/sku
 *     ✓ pagination limit + offset works, hasMore correct
 *     ✓ no cookie → 401
 *
 *   POST /api/customers + GET /api/customers/:id
 *     ✓ happy path → row inserted, fullName retrievable decrypted
 *     ✓ CASHIER → 403
 *     ✓ audit_log.customer_created written with redacted field map (no plaintext)
 *
 *   GET /api/customers/:id/products
 *     ✓ returns products with acquired_from_customer_id = :id
 *
 *   Day-17 audit fix #1 (deep equality)
 *     ✓ PUT marketingAttributes with identical content → 200 + changedFields = []
 *     ✓ PUT marketingAttributes with different content → 200 + changedFields includes 'marketingAttributes'
 *
 *   DB constraint trigger (audit fix #2) — covered at migration test level
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@warehouse14/db/schema';
import type { AppDb } from '@warehouse14/db/client';
import type { FastifyInstance } from 'fastify';

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
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((n) => /^\d{4}_.+\.sql$/.test(n))
    .sort();
  for (const f of files) await sqlClient.unsafe(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
}

describe('Day 17 — catalog + customers + debt + audit fixes', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let ownerUserId: string;
  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let ownerToken: string;
  let cashierToken: string;

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
      host: container.getHost(), port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1, onnotice: () => {},
    });
    await applyAll(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: container.getHost(), port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 5, onnotice: () => {},
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

    ownerToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerUserId}, ${ownerToken}, now() + interval '30 days', ${deviceId}, now())`;
    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, NULL)`;
  });

  function headers(token: string | null): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (token) h.cookie = `warehouse14.session=${token}`;
    h['x-dev-device-fingerprint'] = deviceFingerprint;
    return h;
  }

  // ════════════════════════════════════════════════════════════════════
  // GET /api/products — catalog
  // ════════════════════════════════════════════════════════════════════

  describe('GET /api/products', () => {
    beforeEach(async () => {
      // 3 products: 1 DRAFT, 1 AVAILABLE (storefront), 1 AVAILABLE (eBay)
      await migratorSql`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name)
        VALUES (${`SKU-draft-${randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '100.00', 'Draft ring')`;
      await migratorSql`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name,
                              listed_on_storefront, published_at)
        VALUES (${`SKU-store-${randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '150.00', 'Storefront ring', TRUE, now())`;
      await migratorSql`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name,
                              listed_on_ebay, published_at)
        VALUES (${`SKU-ebay-${randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
                'gold_coin'::item_type, '500.00', '600.00', 'eBay coin', TRUE, now())`;
    });

    it('ADMIN happy path — returns all 3 + pagination metadata', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/products?limit=50',
        headers: headers(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { items: unknown[]; total: number; hasMore: boolean };
      expect(out.items.length).toBeGreaterThanOrEqual(3);
      expect(out.hasMore).toBe(false);
    });

    it('filter status=AVAILABLE excludes DRAFT', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/products?status=AVAILABLE',
        headers: headers(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { items: Array<{ status: string }> };
      for (const item of out.items) expect(item.status).toBe('AVAILABLE');
    });

    it('filter listedOnStorefront=true returns only storefront-listed', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/products?listedOnStorefront=true',
        headers: headers(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { items: Array<{ listedOnStorefront: boolean }> };
      for (const item of out.items) expect(item.listedOnStorefront).toBe(true);
    });

    it('filter q (search) matches name substring', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/products?q=eBay',
        headers: headers(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { items: Array<{ name: string }> };
      expect(out.items.some((i) => i.name.toLowerCase().includes('ebay'))).toBe(true);
    });

    it('pagination limit=1 + offset=0 + offset=1', async () => {
      const a = await app.inject({
        method: 'GET', url: '/api/products?limit=1&offset=0',
        headers: headers(ownerToken),
      });
      const b = await app.inject({
        method: 'GET', url: '/api/products?limit=1&offset=1',
        headers: headers(ownerToken),
      });
      const outA = a.json() as { items: Array<{ id: string }>; hasMore: boolean };
      const outB = b.json() as { items: Array<{ id: string }> };
      expect(outA.items.length).toBe(1);
      expect(outB.items.length).toBe(1);
      expect(outA.items[0]!.id).not.toBe(outB.items[0]!.id);
      expect(outA.hasMore).toBe(true);
    });

    it('no cookie → 401', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/products',
        headers: headers(null),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/customers + GET /api/customers/:id
  // ════════════════════════════════════════════════════════════════════

  describe('POST + GET /api/customers', () => {
    it('Owner creates + retrieves with decrypted PII; audit_log carries redacted fieldsSet', async () => {
      const create = await app.inject({
        method: 'POST', url: '/api/customers',
        headers: headers(ownerToken),
        payload: {
          fullName: 'Hans Mustermann',
          dateOfBirth: '1970-03-15',
          email: 'hans@example.de',
          phone: '+49 7621 123456',
          notes: 'Returning customer; prefers German.',
          preferredLanguage: 'de',
        },
      });
      expect(create.statusCode).toBe(200);
      const created = create.json() as { id: string; customerNumber: string };
      expect(created.customerNumber).toMatch(/^CUST-\d{4}-\d{6}$/);

      // Read back — PII must decrypt.
      const read = await app.inject({
        method: 'GET', url: `/api/customers/${created.id}`,
        headers: headers(ownerToken),
      });
      expect(read.statusCode).toBe(200);
      const detail = read.json() as { fullName: string; email: string | null; phone: string | null; notes: string | null };
      expect(detail.fullName).toBe('Hans Mustermann');
      expect(detail.email).toBe('hans@example.de');
      expect(detail.phone).toBe('+49 7621 123456');
      expect(detail.notes).toBe('Returning customer; prefers German.');

      // audit_log: no plaintext PII, only the field map.
      const [audit] = await migratorSql<{ payload: { customerId: string; fieldsSet: Record<string, boolean> } }[]>`
        SELECT payload FROM audit_log
         WHERE event_type = 'customer.created'
           AND (payload->>'customerId')::text = ${created.id}`;
      expect(audit).toBeDefined();
      expect(audit!.payload.fieldsSet).toEqual({
        fullName: true, dateOfBirth: true, email: true, phone: true,
        address: false, notes: true,
      });
      // Hard check: no plaintext leak.
      expect(JSON.stringify(audit!.payload)).not.toContain('Hans Mustermann');
      expect(JSON.stringify(audit!.payload)).not.toContain('hans@example.de');
    });

    it('CASHIER → 403', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/customers',
        headers: headers(cashierToken),
        payload: { fullName: 'Should not work' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // GET /api/customers/:id/products — Ankauf history
  // ════════════════════════════════════════════════════════════════════

  describe('GET /api/customers/:id/products', () => {
    it('returns products acquired from that customer', async () => {
      // Seed a customer + 2 products from that customer.
      const create = await app.inject({
        method: 'POST', url: '/api/customers',
        headers: headers(ownerToken),
        payload: { fullName: 'Seller A' },
      });
      const { id: customerId } = create.json() as { id: string };

      await migratorSql`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name,
                              acquired_from_customer_id)
        VALUES (${`SKU-${randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '100.00', 'From Seller A #1',
                ${customerId})`;
      await migratorSql`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name,
                              acquired_from_customer_id)
        VALUES (${`SKU-${randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '80.00', '160.00', 'From Seller A #2',
                ${customerId})`;

      const res = await app.inject({
        method: 'GET', url: `/api/customers/${customerId}/products`,
        headers: headers(ownerToken),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { items: Array<{ name: string }> };
      const names = out.items.map((i) => i.name).sort();
      expect(names).toEqual(['From Seller A #1', 'From Seller A #2']);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Day-17 audit fix #1 — deep equality for marketingAttributes
  // ════════════════════════════════════════════════════════════════════

  describe('Audit fix #1 — marketingAttributes deep equality', () => {
    async function createProduct(): Promise<string> {
      const res = await app.inject({
        method: 'POST', url: '/api/products',
        headers: headers(ownerToken),
        payload: {
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
          name: 'Deep-equality probe',
          marketingAttributes: [{ key: 'origin', value: 'Italy' }, { key: 'style', value: 'modern' }],
        },
      });
      return (res.json() as { id: string }).id;
    }

    it('PUT with identical marketingAttributes content → changedFields excludes marketingAttributes', async () => {
      const id = await createProduct();
      const res = await app.inject({
        method: 'PUT', url: `/api/products/${id}`,
        headers: headers(ownerToken),
        payload: {
          // Same content, different reference (JSON re-parsed by Ajv) — this
          // is the audit's bug scenario.
          marketingAttributes: [{ key: 'origin', value: 'Italy' }, { key: 'style', value: 'modern' }],
        },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { changedFields: string[] };
      expect(out.changedFields).not.toContain('marketingAttributes');
    });

    it('PUT with different marketingAttributes → changedFields includes marketingAttributes', async () => {
      const id = await createProduct();
      const res = await app.inject({
        method: 'PUT', url: `/api/products/${id}`,
        headers: headers(ownerToken),
        payload: {
          marketingAttributes: [{ key: 'origin', value: 'Switzerland' }],
        },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { changedFields: string[] };
      expect(out.changedFields).toContain('marketingAttributes');
    });
  });
});
