import { randomUUID } from 'node:crypto';
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

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    SUPERUSER
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

describe('B2B checkout integration test', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let cashierSessionToken: string;
  let productId: string;
  let customerId: string;

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
    // Fresh seed data
    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days',
              ${cashierUserId})
      RETURNING id`;
    deviceId = dev!.id;

    cashierSessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierSessionToken}, now() + interval '8 hours',
              ${deviceId}, NULL)`;

    // A standard 19% product
    const [product] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'watch'::item_type, '50.00', '119.00', 'B2B eligible watch', now())
      RETURNING id`;
    productId = product!.id;

    // A B2B customer with vat_id
    const [cust] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, vat_id, retention_until)
      SELECT encrypt_pii('B2B Tech AG'), 'DE123456789', (now() + interval '5 years')::date FROM s
      RETURNING id`;
    customerId = cust!.id;
  });

  it('finalizes a B2B reverse charge checkout successfully with correct net totals and ledger', async () => {
    // 1. Reserve the product
    const sessionId = randomUUID();
    await migratorSql`
      UPDATE products
         SET status = 'RESERVED'::product_status,
             reserved_at = now(),
             reserved_by_session_id = ${sessionId},
             reserved_channel = 'POS'::reservation_channel,
             reserved_by_user_id = ${cashierUserId}
       WHERE id = ${productId}`;

    // 2. Build B2B Reverse Charge payload. List price is €119.00 gross, net is €100.00.
    // 13b overrides standard 19% to REVERSE_CHARGE_13B (0% VAT, net pricing).
    const body = {
      direction: 'VERKAUF',
      customerId,
      subtotalEur: '100.00',
      vatEur: '0.00',
      totalEur: '100.00',
      taxTreatmentCode: 'REVERSE_CHARGE_13B',
      items: [
        {
          productId,
          reservationSessionId: sessionId,
          lineSubtotalEur: '100.00',
          lineVatEur: '0.00',
          lineTotalEur: '100.00',
          appliedTaxTreatmentCode: 'REVERSE_CHARGE_13B',
          appliedVatRate: '0.0000',
          acquisitionCostEurSnapshot: '50.00',
          marginEur: null,
          displayOrder: 1,
        },
      ],
      payments: [
        {
          paymentMethod: 'CASH',
          amountEur: '100.00',
        },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/finalize',
      headers: {
        'content-type': 'application/json',
        cookie: `warehouse14.session=${cashierSessionToken}`,
        'x-dev-device-fingerprint': deviceFingerprint,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const out = res.json() as {
      id: string;
      receiptLocator: string;
      ledgerEventId: number;
      direction: string;
      totalEur: string;
      taxTreatmentCode: string;
    };
    expect(out.direction).toBe('VERKAUF');
    expect(out.totalEur).toBe('100.00');
    expect(out.taxTreatmentCode).toBe('REVERSE_CHARGE_13B');

    // Assert database values
    const [txRow] = await migratorSql<{ tax_treatment_code: string; total_eur: string }[]>`
      SELECT tax_treatment_code, total_eur::text FROM transactions WHERE id = ${out.id}`;
    expect(txRow!.tax_treatment_code).toBe('REVERSE_CHARGE_13B');
    expect(txRow!.total_eur).toBe('100.00');

    // Assert customer cumulative spend increased by 100.00
    const [custRow] = await migratorSql<{ cumulative_spend_eur: string }[]>`
      SELECT cumulative_spend_eur::text FROM customers WHERE id = ${customerId}`;
    expect(custRow!.cumulative_spend_eur).toBe('100.00');

    // Ledger has the correct event
    const [ledgRow] = await migratorSql<{ payload: any }[]>`
      SELECT payload FROM ledger_events WHERE id = ${out.ledgerEventId}`;
    expect(ledgRow!.payload.tax_treatment_code).toBe('REVERSE_CHARGE_13B');
    expect(ledgRow!.payload.total_eur).toBe('100.00');
  });
});
