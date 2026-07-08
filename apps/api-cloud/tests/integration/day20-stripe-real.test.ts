/**
 * Day 20 — Real Stripe Testmode integration (gated by env).
 *
 *   1. Hits api.stripe.com in TEST MODE (sk_test_*) to create a real
 *      PaymentIntent. Skipped unless `STRIPE_TEST_SECRET_KEY` is set.
 *   2. Exercises the full webhook → fiscal conversion path with a
 *      SELF-SIGNED valid webhook (HMAC-SHA256 over the configured secret).
 *      This is the documented Stripe pattern for testing webhook handlers.
 *
 * Coverage matrix:
 *   ✓ [STRIPE_TEST_SECRET_KEY set] /checkout hits Stripe + returns client_secret
 *   ✓ signed payment_intent.succeeded → cart=CONVERTED + products SOLD + tx (WEB)
 *   ✓ signed payment_intent.payment_failed → cart=ABANDONED + products AVAILABLE
 *   ✓ signed payment_intent.canceled → cart=ABANDONED + pi=CANCELED
 *   ✓ shipping_address_encrypted snapshot is readable via decrypt_pii
 */

import { createHmac, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { STOREFRONT_COOKIE_NAME } from '../../src/plugins/storefront-session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');
const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
const STRIPE_WHSEC = 'whsec_test_day20_self_signed_secret';

const STRIPE_LIVE_KEY = process.env.STRIPE_TEST_SECRET_KEY ?? '';
const HAS_LIVE_STRIPE = STRIPE_LIVE_KEY.startsWith('sk_test_');
const describeWhenLive = HAS_LIVE_STRIPE ? describe : describe.skip;

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

function stripeSig(rawBody: string, secret: string, ts?: number): string {
  const t = ts ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

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

describe('Day 20 — Stripe testmode + full conversion pipeline', () => {
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

    // The webhook handler reads process.env.WAREHOUSE14_PII_KEY directly.
    process.env.WAREHOUSE14_PII_KEY = PII_KEY;

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
      STRIPE_SECRET_KEY: HAS_LIVE_STRIPE ? STRIPE_LIVE_KEY : 'sk_test_dummy_unused',
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

    // Owner + system device required by webhook conversion path.
    const [owner] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`owner-${randomUUID()}@x.test`}, 'WebOwner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    await migratorSql`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${`CERT-web-${randomUUID()}`},
              now() - interval '1 day', now() + interval '365 days', ${owner!.id})`;
  }, 120_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  beforeEach(async () => {
    await migratorSql`TRUNCATE webhook_events RESTART IDENTITY CASCADE`;
    await migratorSql`TRUNCATE payment_intents CASCADE`;
    await migratorSql`TRUNCATE cart_items CASCADE`;
    await migratorSql`TRUNCATE carts CASCADE`;
    await migratorSql`TRUNCATE shopper_sessions CASCADE`;
    await migratorSql`DELETE FROM shoppers`;
  });

  async function setupCartReady(): Promise<{
    cookie: string;
    productId: string;
    shopperId: string;
  }> {
    const email = `pipe-${randomUUID()}@x.test`;
    const sign = await app.inject({
      method: 'POST',
      url: '/api/storefront/auth/sign-up',
      headers: { 'content-type': 'application/json' },
      payload: { email, password: 'CorrectHorseBattery42', fullName: 'Pipeline Tester' },
    });
    expect(sign.statusCode).toBe(201);
    const token = cookieValue(sign.headers['set-cookie'], STOREFRONT_COOKIE_NAME)!;
    const cookie = `${STOREFRONT_COOKIE_NAME}=${token}`;
    const shopperId = (sign.json() as { shopperId: string }).shopperId;

    // `is_published_to_web` is the flag that gates add-to-cart (the old
    // `listed_on_storefront` was retired as a buyability gate, audit H1). Seed
    // both TRUE so the product is buyable, mirroring the day19 makeProduct helper.
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at,
                            listed_on_storefront, is_published_to_web)
      VALUES (${`SKU-pipe-${randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'gold_jewelry'::item_type, '50.00', '119.00', 'Pipeline ring', now(), TRUE, TRUE)
      RETURNING id`;

    const add = await app.inject({
      method: 'POST',
      url: '/api/storefront/cart/items',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { productId: p!.id },
    });
    expect(add.statusCode).toBe(200);
    return { cookie, productId: p!.id, shopperId };
  }

  async function postCheckout(cookie: string) {
    return app.inject({
      method: 'POST',
      url: '/api/storefront/cart/checkout',
      headers: { cookie, 'content-type': 'application/json' },
      payload: {
        shippingAddress: {
          recipientName: 'Pipeline Tester',
          line1: 'Marktplatz 1',
          postalCode: '79576',
          city: 'Weil am Rhein',
          country: 'DE',
        },
      },
    });
  }

  describeWhenLive('real Stripe API (sk_test_*)', () => {
    it('POST /checkout creates a real PaymentIntent + returns client_secret', async () => {
      const { cookie } = await setupCartReady();
      const res = await postCheckout(cookie);
      expect(res.statusCode).toBe(200);
      const out = res.json() as {
        providerIntentId: string;
        clientSecret: string;
        amountEur: string;
      };
      expect(out.providerIntentId).toMatch(/^pi_/);
      expect(out.clientSecret).toMatch(/_secret_/);
      expect(out.amountEur).toBe('119.00');
    });
  });

  describe('webhook → cart conversion (self-signed)', () => {
    async function checkoutWithoutRealStripe(): Promise<{
      cookie: string;
      cartId: string;
      productId: string;
      providerIntentId: string;
    }> {
      const { cookie, productId, shopperId } = await setupCartReady();
      const reservationSessionId = randomUUID();
      const checkoutExpires = new Date(Date.now() + 15 * 60_000);

      await migratorSql`
        UPDATE products
           SET status = 'RESERVED'::product_status,
               reserved_by_channel = 'STOREFRONT'::reservation_channel,
               reserved_by_session_id = ${reservationSessionId},
               reserved_at = now(),
               reservation_expires_at = ${checkoutExpires}
         WHERE id = ${productId}`;

      const [cart] = await migratorSql<{ id: string }[]>`
        UPDATE carts
           SET status = 'CHECKOUT'::cart_status,
               reservation_session_id = ${reservationSessionId},
               checkout_started_at = now(),
               checkout_expires_at = ${checkoutExpires}
         WHERE shopper_id = ${shopperId} AND status = 'ACTIVE'
         RETURNING id`;

      await migratorSql`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        UPDATE shoppers
           SET shipping_recipient_name_encrypted = (SELECT encrypt_pii('Pipeline Tester') FROM s),
               shipping_address_line1_encrypted  = (SELECT encrypt_pii('Marktplatz 1') FROM s),
               shipping_postal_code_encrypted    = (SELECT encrypt_pii('79576') FROM s),
               shipping_city_encrypted           = (SELECT encrypt_pii('Weil am Rhein') FROM s),
               shipping_country                  = 'DE'
         WHERE id = ${shopperId}`;

      const providerIntentId = `pi_test_${randomUUID().replace(/-/g, '')}`;
      await migratorSql`
        INSERT INTO payment_intents (cart_id, provider, provider_intent_id, status, amount_eur, client_secret)
        VALUES (${cart!.id}, 'STRIPE'::payment_provider, ${providerIntentId},
                'PENDING'::payment_intent_status, '119.00', 'pi_test_client_secret')`;

      return { cookie, cartId: cart!.id, productId, providerIntentId };
    }

    it('payment_intent.succeeded → cart=CONVERTED + product SOLD + tx(WEB) + shipping snapshot', async () => {
      const { cartId, productId, providerIntentId } = await checkoutWithoutRealStripe();

      const event = {
        id: `evt_pipeline_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        data: { object: { id: providerIntentId, status: 'succeeded' } },
      };
      const rawBody = JSON.stringify(event);
      const sig = stripeSig(rawBody, STRIPE_WHSEC);

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);

      const [cart] = await migratorSql<
        { status: string; converted_to_transaction_id: string | null }[]
      >`
        SELECT status::text AS status, converted_to_transaction_id FROM carts WHERE id = ${cartId}`;
      expect(cart!.status).toBe('CONVERTED');
      expect(cart!.converted_to_transaction_id).not.toBeNull();

      const [product] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM products WHERE id = ${productId}`;
      expect(product!.status).toBe('SOLD');

      const [tx] = await migratorSql<
        {
          sales_channel: string;
          shipping_status: string;
          total_eur: string;
        }[]
      >`
        SELECT sales_channel::text AS sales_channel,
               shipping_status::text AS shipping_status,
               total_eur::text AS total_eur
          FROM transactions WHERE id = ${cart!.converted_to_transaction_id}`;
      expect(tx!.sales_channel).toBe('WEB');
      expect(tx!.shipping_status).toBe('PENDING');
      expect(tx!.total_eur).toBe('119.00');

      const [decrypted] = await migratorSql<{ shipping: string | null }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT decrypt_pii(shipping_address_encrypted) AS shipping
          FROM transactions, s WHERE transactions.id = ${cart!.converted_to_transaction_id}`;
      expect(decrypted!.shipping).not.toBeNull();
      const json = JSON.parse(decrypted!.shipping!);
      expect(json.recipientName).toBe('Pipeline Tester');
      expect(json.country).toBe('DE');
    });

    it('payment_intent.payment_failed → cart=ABANDONED + product back to AVAILABLE', async () => {
      const { cartId, productId, providerIntentId } = await checkoutWithoutRealStripe();

      const event = {
        id: `evt_failed_${randomUUID()}`,
        type: 'payment_intent.payment_failed',
        data: { object: { id: providerIntentId, status: 'requires_payment_method' } },
      };
      const rawBody = JSON.stringify(event);
      const sig = stripeSig(rawBody, STRIPE_WHSEC);

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);

      const [cart] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM carts WHERE id = ${cartId}`;
      expect(cart!.status).toBe('ABANDONED');

      const [product] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM products WHERE id = ${productId}`;
      expect(product!.status).toBe('AVAILABLE');

      const [pi] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM payment_intents WHERE provider_intent_id = ${providerIntentId}`;
      expect(pi!.status).toBe('FAILED');
    });

    it('payment_intent.canceled → cart=ABANDONED + pi=CANCELED', async () => {
      const { cartId, providerIntentId } = await checkoutWithoutRealStripe();

      const event = {
        id: `evt_cancel_${randomUUID()}`,
        type: 'payment_intent.canceled',
        data: { object: { id: providerIntentId, status: 'canceled' } },
      };
      const rawBody = JSON.stringify(event);
      const sig = stripeSig(rawBody, STRIPE_WHSEC);

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);

      const [cart] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM carts WHERE id = ${cartId}`;
      expect(cart!.status).toBe('ABANDONED');

      const [pi] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM payment_intents WHERE provider_intent_id = ${providerIntentId}`;
      expect(pi!.status).toBe('CANCELED');
    });

    // ────────────────────────────────────────────────────────────────────
    // Async-payment lifecycle (SEPA/Klarna settle for days, not seconds).
    // ────────────────────────────────────────────────────────────────────

    it('payment_intent.processing → holds cart + reservation for async settlement', async () => {
      const { cartId, productId, providerIntentId } = await checkoutWithoutRealStripe();
      // Precondition: helper set both windows to now + 15 min (the card default).

      const event = {
        id: `evt_processing_${randomUUID()}`,
        type: 'payment_intent.processing',
        data: { object: { id: providerIntentId, status: 'processing' } },
      };
      const rawBody = JSON.stringify(event);
      const sig = stripeSig(rawBody, STRIPE_WHSEC);

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);

      // A 13-day floor proves both windows were pushed to the ~14-day horizon and
      // are no longer the 15-minute default the sweeper/reaper would act on.
      const floor = Date.now() + 13 * 24 * 60 * 60_000;

      const [cart] = await migratorSql<{ status: string; checkout_expires_at: Date }[]>`
        SELECT status::text AS status, checkout_expires_at FROM carts WHERE id = ${cartId}`;
      expect(cart!.status).toBe('CHECKOUT'); // still open, not swept
      expect(new Date(cart!.checkout_expires_at).getTime()).toBeGreaterThan(floor);

      const [product] = await migratorSql<{ status: string; reservation_expires_at: Date }[]>`
        SELECT status::text AS status, reservation_expires_at FROM products WHERE id = ${productId}`;
      expect(product!.status).toBe('RESERVED'); // still held for the paying shopper
      expect(new Date(product!.reservation_expires_at).getTime()).toBeGreaterThan(floor);

      const [pi] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM payment_intents WHERE provider_intent_id = ${providerIntentId}`;
      expect(pi!.status).toBe('PENDING'); // unchanged, no new enum state introduced
    });

    it('duplicate delivery whose prior attempt never finished → re-processes (recovery)', async () => {
      const { cartId, productId, providerIntentId } = await checkoutWithoutRealStripe();

      const eventId = `evt_recover_${randomUUID()}`;
      // Simulate a prior delivery that inserted the dedup row but crashed before
      // marking processed_at (a transient DB error mid-conversion).
      await migratorSql`
        INSERT INTO webhook_events (provider, provider_event_id, event_type, raw_body, payload, signature_verified, processed_at)
        VALUES ('STRIPE', ${eventId}, 'payment_intent.succeeded', '', '{}'::jsonb, true, NULL)`;

      const event = {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: providerIntentId, status: 'succeeded' } },
      };
      const rawBody = JSON.stringify(event);
      const sig = stripeSig(rawBody, STRIPE_WHSEC);

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);
      // A duplicate delivery, but the unfinished prior attempt means the work is
      // DONE this time rather than swallowed.
      expect((res.json() as { idempotent: boolean }).idempotent).toBe(true);

      const [cart] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM carts WHERE id = ${cartId}`;
      expect(cart!.status).toBe('CONVERTED'); // recovered, not lost

      const [product] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM products WHERE id = ${productId}`;
      expect(product!.status).toBe('SOLD');

      const [row] = await migratorSql<{ processed_at: Date | null }[]>`
        SELECT processed_at FROM webhook_events WHERE provider_event_id = ${eventId}`;
      expect(row!.processed_at).not.toBeNull(); // now marked finished
    });

    it('duplicate delivery whose prior attempt finished → does NOT re-process (idempotent)', async () => {
      const { cartId, providerIntentId } = await checkoutWithoutRealStripe();

      const eventId = `evt_done_${randomUUID()}`;
      // A prior delivery that fully finished: dedup row present AND processed_at set.
      await migratorSql`
        INSERT INTO webhook_events (provider, provider_event_id, event_type, raw_body, payload, signature_verified, processed_at)
        VALUES ('STRIPE', ${eventId}, 'payment_intent.succeeded', '', '{}'::jsonb, true, now())`;

      const event = {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: providerIntentId, status: 'succeeded' } },
      };
      const rawBody = JSON.stringify(event);
      const sig = stripeSig(rawBody, STRIPE_WHSEC);

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { idempotent: boolean }).idempotent).toBe(true);

      // Untouched: the finished-guard short-circuits before any conversion work.
      const [cart] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM carts WHERE id = ${cartId}`;
      expect(cart!.status).toBe('CHECKOUT');

      const [pi] = await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM payment_intents WHERE provider_intent_id = ${providerIntentId}`;
      expect(pi!.status).toBe('PENDING');
    });
  });
});
