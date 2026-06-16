/**
 * Phase-2 P1.5 — the WhatsApp send records intent BEFORE the external call.
 *
 * Previously the Meta send ran FIRST and the DB row was inserted only AFTER it
 * returned, so a crash between the two left a REAL delivered message with NO
 * `whatsapp_outbound_messages` row. The fix records 'queued' first, then settles
 * the row (status + provider fields) after the call. This proves, against real
 * Postgres, that a send whose provider REJECTS still leaves a recorded row
 * (status='failed') — and that the settle UPDATE has the grant it needs (0073).
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyAllMigrations } from './_migrate.js';

// Mock the Meta transport: success or failure controlled per test. MetaApiError
// stays the REAL class so `err instanceof MetaApiError` still narrows.
const h = vi.hoisted(() => ({ mode: 'fail' as 'fail' | 'ok' }));
vi.mock('../../src/lib/meta-whatsapp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/meta-whatsapp.js')>();
  return {
    ...actual,
    sendToMeta: async () => {
      if (h.mode === 'fail') {
        throw new actual.MetaApiError('provider rejected', 131_026, { error: { code: 131_026 } });
      }
      return { messageId: 'wamid.TEST123' };
    },
  };
});

const { buildApp } = await import('../../src/app.js');
const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN SUPERUSER PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a seeded row');
  return v;
}

describe('POST /api/whatsapp/send — record-intent then settle (P1.5)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;
  let adminFingerprint: string;
  let adminSessionToken: string;

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
      DATABASE_URL: 'unused',
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
      // Non-empty → liveSendEnabled = true → the send + settle path runs.
      WHATSAPP_PHONE_NUMBER_ID: '123456',
      WHATSAPP_ACCESS_TOKEN: 'test-token',
    } as unknown as Parameters<typeof buildApp>[0]['env'];
    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });

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
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  beforeEach(async () => {
    await migratorSql`DELETE FROM whatsapp_outbound_messages`;
  });

  function send(toPhone: string) {
    return app.inject({
      method: 'POST',
      url: '/api/whatsapp/send',
      headers: {
        'content-type': 'application/json',
        cookie: `warehouse14.session=${adminSessionToken}`,
        'x-dev-device-fingerprint': adminFingerprint,
      },
      payload: { toPhone, body: 'Hallo' },
    });
  }

  it('a provider rejection still records the row as failed (settle UPDATE + 0073 grant)', async () => {
    h.mode = 'fail';
    const res = await send('+4915112345678');
    // The route surfaces the provider rejection — but the row MUST exist.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const rows = await migratorSql<{ status: string; provider_error: unknown }[]>`
      SELECT status::text AS status, provider_error FROM whatsapp_outbound_messages
      WHERE to_phone = '+4915112345678'`;
    expect(rows).toHaveLength(1);
    expect(must(rows[0]).status).toBe('failed');
    expect(must(rows[0]).provider_error).not.toBeNull();
  });

  it('a successful send settles the row to sent with the provider message id', async () => {
    h.mode = 'ok';
    const res = await send('+4915187654321');
    expect(res.statusCode).toBe(200);

    const rows = await migratorSql<{ status: string; provider_message_id: string | null }[]>`
      SELECT status::text AS status, provider_message_id FROM whatsapp_outbound_messages
      WHERE to_phone = '+4915187654321'`;
    expect(rows).toHaveLength(1);
    expect(must(rows[0]).status).toBe('sent');
    expect(must(rows[0]).provider_message_id).toBe('wamid.TEST123');
  });
});
