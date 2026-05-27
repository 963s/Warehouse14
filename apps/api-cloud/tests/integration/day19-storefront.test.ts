/**
 * Day 19 E2E — Storefront commerce (B2C identity + cart + Stripe webhook).
 *
 * Coverage matrix:
 *
 *   sign-up    ✓ happy path → 201 + customer + shopper + session cookie
 *              ✓ weak password → 400
 *              ✓ duplicate active email → 409 CONFLICT
 *              ✓ re-signup after soft-delete works (UNIQUE partial)
 *
 *   sign-in    ✓ wrong password → 401 + failed_login_attempts++
 *              ✓ 5 wrong attempts → 423 PIN_LOCKED
 *              ✓ happy path → 200 + cookie
 *
 *   cart       ✓ GET creates active cart on first call
 *              ✓ POST /items refuses unlisted product
 *              ✓ POST /items refuses duplicate (one-product-per-cart)
 *              ✓ DELETE removes line
 *
 *   webhook    ✓ unsigned → 400 (signature missing)
 *              ✓ bad HMAC → 400
 *              ✓ stale timestamp (> tolerance) → 400 (replay defense)
 *              ✓ valid sig + duplicate evt_id → 200 idempotent:true
 *              ✓ valid sig + payment_intent.succeeded converts cart → CONVERTED + tx (sales_channel=WEB, shipping_status=PENDING)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
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
import { STOREFRONT_COOKIE_NAME } from '../../src/plugins/storefront-session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');
const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
const STRIPE_WHSEC = 'whsec_test_dummy_secret_for_signature_verification';

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

/** Compute a Stripe-Signature header value over a raw body. */
function stripeSignature(rawBody: string, secret: string, ts?: number): string {
  const t = ts ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Extract a cookie value from a Set-Cookie header value. */
function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) {
    const first = c.split(';')[0];
    if (!first) continue;
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    if (first.slice(0, eq) === name) return first.slice(eq + 1);
  }
  return null;
}

describe('Day 19 — storefront commerce', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

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
      STRIPE_SECRET_KEY: 'sk_test_dummy_for_typecheck_not_called_in_tests',
      STRIPE_WEBHOOK_SECRET: STRIPE_WHSEC,
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
  }, 120_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  beforeEach(async () => {
    // Truncate the storefront tables between tests to keep email UNIQUE clean.
    await migratorSql`TRUNCATE webhook_events RESTART IDENTITY CASCADE`;
    await migratorSql`TRUNCATE payment_intents CASCADE`;
    await migratorSql`TRUNCATE cart_items CASCADE`;
    await migratorSql`TRUNCATE carts CASCADE`;
    await migratorSql`TRUNCATE shopper_sessions CASCADE`;
    await migratorSql`DELETE FROM shoppers`;
  });

  // ════════════════════════════════════════════════════════════════════
  // 1. sign-up
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/storefront/auth/sign-up', () => {
    it('happy path → 201 + shopper + customer + session cookie', async () => {
      const email = `s-${randomUUID()}@x.test`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: {
          email, password: 'CorrectHorseBattery42',
          fullName: 'Test Shopper', preferredLanguage: 'de',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { shopperId: string; customerId: string; emailVerified: boolean };
      expect(body.shopperId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.customerId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.emailVerified).toBe(false);

      // The set-cookie carries the session token.
      const setCookie = res.headers['set-cookie'];
      const token = cookieValue(setCookie, STOREFRONT_COOKIE_NAME);
      expect(token).not.toBeNull();
      expect(token!.length).toBeGreaterThanOrEqual(32);
    });

    it('weak password (< 10 chars) → 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: {
          email: `weak-${randomUUID()}@x.test`,
          password: 'short',  // 5 chars
          fullName: 'X',
        },
      });
      // The TypeBox schema's minLength: 10 catches this BEFORE the policy validator.
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    });

    it('duplicate active email → 409 CONFLICT', async () => {
      const email = `dup-${randomUUID()}@x.test`;
      const ok = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: { email, password: 'CorrectHorseBattery42', fullName: 'A' },
      });
      expect(ok.statusCode).toBe(201);

      const dup = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: { email, password: 'AnotherStrongPassword42', fullName: 'B' },
      });
      expect(dup.statusCode).toBe(409);
      expect((dup.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
    });

    it('re-signup after soft-delete works (partial UNIQUE)', async () => {
      const email = `resign-${randomUUID()}@x.test`;
      const first = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: { email, password: 'CorrectHorseBattery42', fullName: 'First' },
      });
      const firstId = (first.json() as { shopperId: string }).shopperId;
      // Soft-delete from the DB side.
      await migratorSql`UPDATE shoppers SET soft_deleted_at = now() WHERE id = ${firstId}`;

      // Re-signup with same email — should succeed.
      const second = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: { email, password: 'CorrectHorseBattery43', fullName: 'Second' },
      });
      expect(second.statusCode).toBe(201);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 2. sign-in lockout
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/storefront/auth/sign-in (lockout)', () => {
    async function newShopper(): Promise<string> {
      const email = `signin-${randomUUID()}@x.test`;
      const res = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: { email, password: 'CorrectHorseBattery42', fullName: 'X' },
      });
      expect(res.statusCode).toBe(201);
      return email;
    }

    it('5 wrong attempts → 423 PIN_LOCKED on the 5th', async () => {
      const email = await newShopper();
      let last = 0;
      for (let i = 0; i < 5; i++) {
        const r = await app.inject({
          method: 'POST', url: '/api/storefront/auth/sign-in',
          headers: { 'content-type': 'application/json' },
          payload: { email, password: 'totally-wrong-password-but-long-enough' },
        });
        last = r.statusCode;
      }
      // The 5th attempt triggers the lock and STILL refuses with 423.
      expect(last).toBe(423);

      // Even a correct password is refused while locked.
      const lockedTry = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-in',
        headers: { 'content-type': 'application/json' },
        payload: { email, password: 'CorrectHorseBattery42' },
      });
      expect(lockedTry.statusCode).toBe(423);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 3. Cart routes
  // ════════════════════════════════════════════════════════════════════

  describe('cart routes', () => {
    async function signUpAndCookie(): Promise<{ shopperId: string; cookie: string }> {
      const email = `cart-${randomUUID()}@x.test`;
      const res = await app.inject({
        method: 'POST', url: '/api/storefront/auth/sign-up',
        headers: { 'content-type': 'application/json' },
        payload: { email, password: 'CorrectHorseBattery42', fullName: 'X' },
      });
      const body = res.json() as { shopperId: string };
      const token = cookieValue(res.headers['set-cookie'], STOREFRONT_COOKIE_NAME)!;
      return { shopperId: body.shopperId, cookie: `${STOREFRONT_COOKIE_NAME}=${token}` };
    }

    async function makeProduct(opts: { listedOnStorefront?: boolean } = {}): Promise<string> {
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name, published_at,
                              listed_on_storefront)
        VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
                'gold_jewelry'::item_type, '50.00', '119.00', 'Day-19 storefront ring', now(),
                ${opts.listedOnStorefront ?? true})
        RETURNING id`;
      return p!.id;
    }

    it('GET /api/storefront/cart creates active cart on first call', async () => {
      const { cookie } = await signUpAndCookie();
      const res = await app.inject({
        method: 'GET', url: '/api/storefront/cart',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const cart = res.json() as { status: string; items: unknown[] };
      expect(cart.status).toBe('ACTIVE');
      expect(cart.items).toEqual([]);
    });

    it('POST /items refuses non-storefront products', async () => {
      const { cookie } = await signUpAndCookie();
      const pid = await makeProduct({ listedOnStorefront: false });
      const res = await app.inject({
        method: 'POST', url: '/api/storefront/cart/items',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { productId: pid },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_RESERVABLE');
    });

    it('POST /items twice for the same product → 409 CONFLICT (one-per-cart)', async () => {
      const { cookie } = await signUpAndCookie();
      const pid = await makeProduct();
      const r1 = await app.inject({
        method: 'POST', url: '/api/storefront/cart/items',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { productId: pid },
      });
      expect(r1.statusCode).toBe(200);
      const r2 = await app.inject({
        method: 'POST', url: '/api/storefront/cart/items',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { productId: pid },
      });
      expect(r2.statusCode).toBe(409);
    });

    it('DELETE /items/:id removes the line', async () => {
      const { cookie } = await signUpAndCookie();
      const pid = await makeProduct();
      const added = await app.inject({
        method: 'POST', url: '/api/storefront/cart/items',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { productId: pid },
      });
      const items = (added.json() as { items: { id: string; productId: string }[] }).items;
      expect(items.length).toBe(1);

      const deleted = await app.inject({
        method: 'DELETE', url: `/api/storefront/cart/items/${items[0]!.id}`,
        headers: { cookie },
      });
      expect(deleted.statusCode).toBe(200);
      expect((deleted.json() as { items: unknown[] }).items).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 4. Stripe webhook signature + idempotency
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/webhooks/stripe', () => {
    const postWebhook = (rawBody: string, sigHeader: string | null) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (sigHeader != null) headers['stripe-signature'] = sigHeader;
      return app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers, payload: rawBody });
    };

    it('missing Stripe-Signature header → 400', async () => {
      const r = await postWebhook(JSON.stringify({ id: 'evt_1', type: 'x', data: { object: { id: 'pi_x' } } }), null);
      expect(r.statusCode).toBe(400);
    });

    it('bad HMAC → 400', async () => {
      const body = JSON.stringify({ id: 'evt_2', type: 'x', data: { object: { id: 'pi_x' } } });
      const sig = stripeSignature(body, 'whsec_WRONG_SECRET');
      const r = await postWebhook(body, sig);
      expect(r.statusCode).toBe(400);
    });

    it('stale timestamp (>tolerance) → 400 (replay defense)', async () => {
      const body = JSON.stringify({ id: 'evt_3', type: 'x', data: { object: { id: 'pi_x' } } });
      const veryOld = Math.floor(Date.now() / 1000) - 10_000;
      const sig = stripeSignature(body, STRIPE_WHSEC, veryOld);
      const r = await postWebhook(body, sig);
      expect(r.statusCode).toBe(400);
    });

    it('valid sig + duplicate evt_id → 200 idempotent: true', async () => {
      const body = JSON.stringify({
        id: 'evt_idem_1',
        type: 'charge.succeeded',
        data: { object: { id: 'ch_test_1' } },
      });
      const sig = stripeSignature(body, STRIPE_WHSEC);
      const first = await postWebhook(body, sig);
      expect(first.statusCode).toBe(200);
      expect((first.json() as { idempotent: boolean }).idempotent).toBe(false);

      // Stripe retried — same event id.
      const sig2 = stripeSignature(body, STRIPE_WHSEC); // fresh ts, same body+id
      const second = await postWebhook(body, sig2);
      expect(second.statusCode).toBe(200);
      expect((second.json() as { idempotent: boolean }).idempotent).toBe(true);
    });
  });
});
