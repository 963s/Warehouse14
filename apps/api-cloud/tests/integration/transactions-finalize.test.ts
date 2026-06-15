/**
 * POST /api/transactions/finalize — Day 13 E2E test.
 *
 * The first vital artery, exercised end-to-end through the real Postgres:
 * mTLS → auth → step-up → Decimal math → inventory-lock finalize → INSERT
 * transactions → SECURITY DEFINER triggers fire (sanctions, closing-day,
 * Great Connection) → cumulative_spend updated → ledger event emitted →
 * pg_notify substrate.
 *
 * The test seeds a session row directly (skipping better-auth's full login
 * machinery — that's Day-12 surface, not what we're testing here). The
 * device fingerprint header is set explicitly via `X-Dev-Device-Fingerprint`
 * so the mTLS plugin recognises the test caller.
 *
 * Coverage matrix:
 *   ✓ happy path: VERKAUF → 200 + product SOLD + ledger emitted + cumulative spend updated
 *   ✓ all-or-nothing: a bad reservation session_id rolls back EVERYTHING (no SOLD, no row, no ledger)
 *   ✓ Decimal math: line totals not summing → 400 VALIDATION_ERROR
 *   ✓ DB CHECK enforced: ANKAUF without customer_id → 400 (mig 0013 C-1)
 *   ✓ Sanctions: flagged customer → 403 SANCTIONS_BLOCK (mig 0013 C-2)
 *   ✓ GwG KYC route pre-check: ANKAUF unverified → 403 KYC_REQUIRED (§259);
 *     VERKAUF ≥ €2.000 unverified/no-customer → 403; verified → 200 (mig 0050)
 *   ✓ Step-up gating: total ≥ threshold without fresh step-up → 403 STEP_UP_REQUIRED
 *   ✓ Step-up gating: same request with fresh step-up → 200 OK
 *   ✓ mTLS gate: missing device header → 403 DEVICE_NOT_AUTHORIZED
 */

import { randomUUID } from 'node:crypto';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');
const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

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

describe('POST /api/transactions/finalize — Day 13 vital artery', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  // Per-test fixtures populated in beforeEach (so each test gets isolation).
  let cashierUserId: string;
  let ownerUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let cashierSessionToken: string;
  let ownerSessionToken: string;
  let cashierSessionId: string;
  let ownerSessionId: string;
  let productId: string;
  let customerId: string;

  // ────────────────────────────────────────────────────────────────────
  // One-time container + migrations + app build.
  // ────────────────────────────────────────────────────────────────────

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
      // Empty → endEbayListing() returns a mock success, so the instant-delist
      // background task flips the listing to BEENDET without real eBay creds.
      EBAY_API_TOKEN: '',
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

  // ────────────────────────────────────────────────────────────────────
  // Per-test seeding — fresh actors, device, product, customer.
  // ────────────────────────────────────────────────────────────────────

  beforeEach(async () => {
    // Reset fiscal + actor tables between tests. TRUNCATE (not DELETE) is
    // required: transactions/tse_signatures are append-only with BEFORE DELETE
    // triggers that refuse row deletion. CASCADE follows the FK graph (sessions
    // + devices → users), which is why a bare `DELETE FROM users` failed on the
    // sessions_user_id_fkey. ledger_events is append-only evidence, left intact.
    await migratorSql.unsafe(
      'TRUNCATE tse_signatures, transaction_payments, transaction_items, ' +
        'transactions, daily_closings, shifts, sessions, devices, customers, products CASCADE',
    );
    // Cashier + Owner users (the Owner gets the partial-UNIQUE bit reset).
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    const [owner] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`o-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    ownerUserId = owner!.id;

    // mTLS device, paired to the cashier.
    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days',
              ${cashierUserId})
      RETURNING id`;
    deviceId = dev!.id;

    // Fresh sessions for cashier and owner. Step-up is fresh on the Owner
    // session so high-value tests pass; cashier session has NO step-up so
    // we can verify the gating works.
    cashierSessionToken = randomUUID().replace(/-/g, '');
    const [cs] = await migratorSql<{ id: string }[]>`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierSessionToken}, now() + interval '8 hours',
              ${deviceId}, NULL)
      RETURNING id`;
    cashierSessionId = cs!.id;

    ownerSessionToken = randomUUID().replace(/-/g, '');
    const [os] = await migratorSql<{ id: string }[]>`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerUserId}, ${ownerSessionToken}, now() + interval '30 days',
              ${deviceId}, now())
      RETURNING id`;
    ownerSessionId = os!.id;

    // A product available for sale.
    const [product] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '50.00', '150.00', 'Test ring', now())
      RETURNING id`;
    productId = product!.id;

    // A non-sanctioned customer.
    const [cust] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Test Customer'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    customerId = cust!.id;
  });

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────

  /** Reserve the product as a POS reservation; returns the session_id. */
  async function reserveProduct(asUserId: string): Promise<string> {
    const sessionId = randomUUID();
    await migratorSql`
      UPDATE products
         SET status = 'RESERVED'::product_status,
             reserved_at = now(),
             reserved_by_session_id = ${sessionId},
             reserved_by_channel = 'POS'::reservation_channel,
             reserved_by_user_id = ${asUserId}
       WHERE id = ${productId}`;
    return sessionId;
  }

  /** Build a valid VERKAUF body for one product at total €150. */
  function buildBody(opts: {
    totalEur?: string;
    customerId?: string | null;
    direction?: 'VERKAUF' | 'ANKAUF';
    reservationSessionId: string;
  }): Record<string, unknown> {
    const total = opts.totalEur ?? '150.00';
    // VAT-on-margin: sale=total, acquisition=50 → margin=(total-50) → VAT=margin * 19/119.
    // For the test we accept any consistent triple; pre-compute by hand.
    const totalNum = Number.parseFloat(total);
    const margin = totalNum - 50;
    const vat = Math.round(((margin * 19) / 119) * 100) / 100;
    const subtotal = Math.round((totalNum - vat) * 100) / 100;

    return {
      direction: opts.direction ?? 'VERKAUF',
      customerId: opts.customerId === undefined ? customerId : opts.customerId,
      subtotalEur: subtotal.toFixed(2),
      vatEur: vat.toFixed(2),
      totalEur: totalNum.toFixed(2),
      taxTreatmentCode: 'MARGIN_25A',
      items: [
        {
          productId,
          reservationSessionId: opts.reservationSessionId,
          lineSubtotalEur: subtotal.toFixed(2),
          lineVatEur: vat.toFixed(2),
          lineTotalEur: totalNum.toFixed(2),
          appliedTaxTreatmentCode: 'MARGIN_25A',
          appliedVatRate: null,
          acquisitionCostEurSnapshot: '50.00',
          marginEur: margin.toFixed(2),
        },
      ],
      payments: [
        {
          paymentMethod: 'CASH',
          amountEur: totalNum.toFixed(2),
        },
      ],
      // §19.2 C-4 — required since migration 0028. One key per logical sale;
      // a test that posts the same built body twice reuses this key (the
      // idempotent-retry path), separate buildBody() calls get distinct keys.
      idempotencyKey: randomUUID(),
    };
  }

  async function postFinalize(
    body: Record<string, unknown>,
    opts: { sessionToken?: string; fingerprint?: string | null } = {},
  ) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    const token = opts.sessionToken ?? cashierSessionToken;
    headers.cookie = `warehouse14.session=${token}`;
    if (opts.fingerprint !== null) {
      headers['x-dev-device-fingerprint'] = opts.fingerprint ?? deviceFingerprint;
    }
    return await app.inject({
      method: 'POST',
      url: '/api/transactions/finalize',
      headers,
      payload: body,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 1. Happy path
  // ────────────────────────────────────────────────────────────────────

  it('VERKAUF happy path: 200 + product SOLD + ledger emitted + cumulative_spend updated', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({ reservationSessionId: sessionId, totalEur: '150.00' });

    const res = await postFinalize(body);
    expect(res.statusCode).toBe(200);
    const out = res.json() as {
      id: string;
      receiptLocator: string;
      finalizedAt: string;
      ledgerEventId: number;
      direction: string;
      totalEur: string;
      storno: boolean;
    };
    expect(out.direction).toBe('VERKAUF');
    expect(out.totalEur).toBe('150.00');
    expect(out.storno).toBe(false);
    expect(out.ledgerEventId).toBeGreaterThan(0);
    expect(out.receiptLocator).toMatch(/^RCP-\d{4}-\d{6}$/);

    // Product is SOLD.
    const [p] = await migratorSql<{ status: string }[]>`
      SELECT status FROM products WHERE id = ${productId}`;
    expect(p!.status).toBe('SOLD');

    // Cumulative spend updated.
    const [c] = await migratorSql<{ cumulative_spend_eur: string }[]>`
      SELECT cumulative_spend_eur FROM customers WHERE id = ${customerId}`;
    expect(c!.cumulative_spend_eur).toBe('150.00');

    // Ledger event emitted.
    const [ev] = await migratorSql<{ event_type: string; entity_id: string }[]>`
      SELECT event_type, entity_id FROM ledger_events WHERE id = ${out.ledgerEventId}`;
    expect(ev!.event_type).toBe('transaction.finalized');
    expect(ev!.entity_id).toBe(out.id);
  });

  // ────────────────────────────────────────────────────────────────────
  // 1b. Instant eBay delisting (Epic D / Task 6)
  // ────────────────────────────────────────────────────────────────────

  it('VERKAUF with active eBay listing: triggers instant background delisting to BEENDET', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    // Mark the reserved product as live on eBay so finalize must end the listing.
    await migratorSql`
      UPDATE products
         SET ebay_state = 'ONLINE'::ebay_listing_state, ebay_state_changed_at = now()
       WHERE id = ${productId}`;

    const body = buildBody({ reservationSessionId: sessionId, totalEur: '150.00' });
    const res = await postFinalize(body);
    // Checkout must succeed immediately — delisting is detached, never blocking.
    expect(res.statusCode).toBe(200);

    // The delist runs in a detached background promise; poll until BEENDET.
    let state = 'ONLINE';
    for (let i = 0; i < 50; i++) {
      const [p] = await migratorSql<{ ebay_state: string }[]>`
        SELECT ebay_state FROM products WHERE id = ${productId}`;
      state = p?.ebay_state ?? 'ONLINE';
      if (state === 'BEENDET') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(state).toBe('BEENDET');

    // A forensic event row recorded the WORKER-sourced ONLINE → BEENDET flip.
    const [ev] = await migratorSql<
      { from_state: string; to_state: string; changed_by_source: string; notes: string }[]
    >`
      SELECT from_state, to_state, changed_by_source, notes
        FROM product_ebay_listing_events
       WHERE product_id = ${productId}
       ORDER BY id DESC
       LIMIT 1`;
    expect(ev?.from_state).toBe('ONLINE');
    expect(ev?.to_state).toBe('BEENDET');
    expect(ev?.changed_by_source).toBe('WORKER');
    expect(ev?.notes).toContain('retail counter');
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. All-or-nothing rollback
  // ────────────────────────────────────────────────────────────────────

  it('all-or-nothing: wrong reservation_session_id rolls back EVERYTHING', async () => {
    await reserveProduct(cashierUserId); // valid reservation exists, but…
    const wrongSession = randomUUID(); // …caller sends a different one.
    const body = buildBody({ reservationSessionId: wrongSession });

    const res = await postFinalize(body);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'PRODUCT_NOT_RESERVABLE' } });

    // Product stayed RESERVED — no half-finalized state.
    const [p] = await migratorSql<{ status: string }[]>`
      SELECT status FROM products WHERE id = ${productId}`;
    expect(p!.status).toBe('RESERVED');

    // No transactions row.
    const [{ count }] = await migratorSql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM transactions WHERE cashier_user_id = ${cashierUserId}`;
    expect(Number.parseInt(count, 10)).toBe(0);

    // Customer cumulative still zero.
    const [c] = await migratorSql<{ cumulative_spend_eur: string }[]>`
      SELECT cumulative_spend_eur FROM customers WHERE id = ${customerId}`;
    expect(c!.cumulative_spend_eur).toBe('0.00');
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Decimal math validation
  // ────────────────────────────────────────────────────────────────────

  it('Decimal mismatch: payments do not sum to total → 400 VALIDATION_ERROR', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({ reservationSessionId: sessionId, totalEur: '150.00' });
    (body.payments as Array<{ amountEur: string }>)[0]!.amountEur = '149.00'; // off by 1

    const res = await postFinalize(body);
    expect(res.statusCode).toBe(400);
    const err = res.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe('VALIDATION_ERROR');
    // The error-handler envelope surfaces the offending field in the message
    // (structured `details` is reserved for the PIN-lock countdown only).
    expect(err.error.message).toContain('payments');
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. ANKAUF requires customer (DB CHECK from migration 0013 C-1)
  // ────────────────────────────────────────────────────────────────────

  it('ANKAUF without a seller is rejected — GwG KYC hard-block (§259 StGB)', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({
      reservationSessionId: sessionId,
      direction: 'ANKAUF',
      customerId: null,
    });

    const res = await postFinalize(body);
    // Defense in depth: the authoritative `transactions_validate_kyc` trigger
    // hard-blocks a seller-less Ankauf from €0,01 BEFORE the requires-customer
    // CHECK (mig 0013 C-1) is reached — every Ankauf needs an ID-verified
    // seller. The rejection still holds; only the layer (and code) is the
    // outer KYC gate rather than the inner NOT NULL CHECK.
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'KYC_REQUIRED' } });

    // Product stayed RESERVED.
    const [p] = await migratorSql<{ status: string }[]>`
      SELECT status FROM products WHERE id = ${productId}`;
    expect(p!.status).toBe('RESERVED');
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Sanctions hard-block (mig 0013 C-2)
  // ────────────────────────────────────────────────────────────────────

  it('sanctioned customer → 403 SANCTIONS_BLOCK + product NOT sold', async () => {
    await migratorSql`UPDATE customers SET sanctions_match = TRUE WHERE id = ${customerId}`;

    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({ reservationSessionId: sessionId });

    const res = await postFinalize(body);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'SANCTIONS_BLOCK' } });

    // Product stayed RESERVED (rollback).
    const [p] = await migratorSql<{ status: string }[]>`
      SELECT status FROM products WHERE id = ${productId}`;
    expect(p!.status).toBe('RESERVED');
  });

  // ────────────────────────────────────────────────────────────────────
  // 5b. GwG KYC enforcement (route pre-check → 403 KYC_REQUIRED)
  //     The DB trigger is integration-proven in 0050_gwg_kyc_enforcement; here
  //     we prove the FRIENDLY route 403 end-to-end through the real app.
  // ────────────────────────────────────────────────────────────────────

  it('ANKAUF with an UN-verified seller → 403 KYC_REQUIRED (§259 StGB, from €0,01)', async () => {
    // The seeded customer is never KYC-stamped. The pre-check fires before the
    // reserve/insert, so a small Ankauf (no step-up) is rejected on identity.
    const body = buildBody({
      direction: 'ANKAUF',
      totalEur: '100.00',
      reservationSessionId: randomUUID(),
    });
    const res = await postFinalize(body);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'KYC_REQUIRED' } });
  });

  it('VERKAUF ≥ €2.000 with an UN-verified customer → 403 KYC_REQUIRED (§10 GwG)', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    // Owner session carries a fresh step-up so we get PAST the step-up gate and
    // hit the KYC pre-check (€2.000 ≥ the €1.000 step-up threshold).
    const body = buildBody({ reservationSessionId: sessionId, totalEur: '2000.00' });
    const res = await postFinalize(body, { sessionToken: ownerSessionToken });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'KYC_REQUIRED' } });

    const [p] = await migratorSql<{ status: string }[]>`
      SELECT status FROM products WHERE id = ${productId}`;
    expect(p?.status).toBe('RESERVED'); // rolled back / never sold
  });

  it('VERKAUF ≥ €2.000 with NO customer → 403 KYC_REQUIRED (§10 GwG)', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({
      reservationSessionId: sessionId,
      totalEur: '2000.00',
      customerId: null,
    });
    const res = await postFinalize(body, { sessionToken: ownerSessionToken });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'KYC_REQUIRED' } });
  });

  it('VERKAUF ≥ €2.000 with a KYC-verified customer → 200 OK', async () => {
    await migratorSql`
      UPDATE customers SET kyc_verified_at = now(), kyc_verified_by_user_id = ${ownerUserId}
       WHERE id = ${customerId}`;
    // Reserve as the Owner: this sale finalizes on the Owner session (fresh
    // step-up), and the §19.2 C-1 guard requires the reservation owner to match
    // the finalizing actor.
    const sessionId = await reserveProduct(ownerUserId);
    const body = buildBody({ reservationSessionId: sessionId, totalEur: '2000.00' });
    const res = await postFinalize(body, { sessionToken: ownerSessionToken });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { totalEur: string }).totalEur).toBe('2000.00');
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Step-up gating
  // ────────────────────────────────────────────────────────────────────

  it('high-value (≥ €1000) without fresh step-up → 403 STEP_UP_REQUIRED', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    // Cashier session has last_pin_step_up_at = NULL → no step-up freshness.
    const body = buildBody({ reservationSessionId: sessionId, totalEur: '1500.00' });

    const res = await postFinalize(body);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } });

    // No state change.
    const [p] = await migratorSql<{ status: string }[]>`
      SELECT status FROM products WHERE id = ${productId}`;
    expect(p!.status).toBe('RESERVED');
  });

  it('high-value WITH fresh step-up (Owner session) → 200 OK', async () => {
    // Reserve as the Owner so the §19.2 C-1 reservation-ownership guard passes
    // when the Owner session finalizes (it carries the fresh step-up).
    const sessionId = await reserveProduct(ownerUserId);
    const body = buildBody({ reservationSessionId: sessionId, totalEur: '1500.00' });

    const res = await postFinalize(body, { sessionToken: ownerSessionToken });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { totalEur: string }).totalEur).toBe('1500.00');
  });

  it('below threshold without step-up → 200 OK (no friction)', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({ reservationSessionId: sessionId, totalEur: '150.00' });

    const res = await postFinalize(body);
    expect(res.statusCode).toBe(200);
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. mTLS gate
  // ────────────────────────────────────────────────────────────────────

  it('missing device fingerprint → 403 DEVICE_NOT_AUTHORIZED', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({ reservationSessionId: sessionId });

    const res = await postFinalize(body, { fingerprint: null });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'DEVICE_NOT_AUTHORIZED' } });
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. Sign discipline — Decimal validator catches it before the DB
  // ────────────────────────────────────────────────────────────────────

  it('original (no storno) with negative amounts → 400 VALIDATION_ERROR (sign discipline)', async () => {
    const sessionId = await reserveProduct(cashierUserId);
    const body = buildBody({ reservationSessionId: sessionId });
    // Flip the sign of the totals (but not storno_of_transaction_id).
    body.totalEur = '-150.00';
    body.subtotalEur = `-${body.subtotalEur as string}`;
    body.vatEur = `-${body.vatEur as string}`;
    const items = body.items as Array<Record<string, string>>;
    items[0]!.lineTotalEur = '-' + items[0]!.lineTotalEur;
    items[0]!.lineSubtotalEur = '-' + items[0]!.lineSubtotalEur;
    items[0]!.lineVatEur = '-' + items[0]!.lineVatEur;
    (body.payments as Array<{ amountEur: string }>)[0]!.amountEur = '-150.00';

    const res = await postFinalize(body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    // Avoid unused-variable noise.
    expect(ownerSessionId).toBeDefined();
    expect(cashierSessionId).toBeDefined();
  });
});
