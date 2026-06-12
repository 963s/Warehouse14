/**
 * /api/integrations — the integrations cockpit (ADMIN-gated).
 *
 * Coverage:
 *   ✓ no session                 → 401 (GET)
 *   ✓ cashier (not ADMIN)        → 403 (GET)
 *   ✓ GET shape                  → typed array, every integration present,
 *                                  configured=false / source='none' before any key
 *   ✓ unknown id on PUT          → 404
 *   ✓ PUT then GET               → configured=true, source='settings' (no key echoed)
 *   ✓ POST /test (mocked fetch)  → typed { ok, status?, message } + persisted
 *                                  lastTestOk/lastTestedAt surface on the next GET
 *
 * The upstream fetch is mocked (vi.spyOn(globalThis,'fetch')) so the probe is
 * deterministic and never hits the network.
 *
 * NOTE: requires a Postgres testcontainer (Docker) — same as every api-cloud
 * integration test. Mirrors the metal-prices-margin harness.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

function firstId(rows: { id: string }[]): string {
  const r = rows[0];
  if (!r) throw new Error('INSERT … RETURNING id produced no row');
  return r.id;
}

describe('/api/integrations', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let deviceFingerprint: string;
  let adminToken: string;
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
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });
    await applyAllMigrationsFidelity(migratorSql);
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

    // Empty env keys → every integration starts source='none'. The test then
    // proves a STORED settings key flips configured/source on its own.
    const env = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      WAREHOUSE14_PII_KEY: PII_KEY,
      TRUSTED_ORIGINS: '',
      TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
      ANTHROPIC_API_KEY: '',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_PHONE_NUMBER_ID: '',
      META_PAGE_ACCESS_TOKEN: '',
      CHATWOOT_BOT_TOKEN: '',
      CHATWOOT_URL: '',
      CHATWOOT_ACCOUNT_ID: '',
    } as unknown as Env;

    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  beforeEach(async () => {
    // Order matters: sessions, devices, and audit_log all reference users (FKs),
    // so clear the children before the parent. The settings upsert fires the
    // on_system_setting_event audit trigger → an audit_log row keyed to the actor.
    await migratorSql`DELETE FROM sessions`;
    await migratorSql`DELETE FROM devices`;
    await migratorSql`DELETE FROM audit_log`;
    await migratorSql`DELETE FROM system_settings WHERE key LIKE 'integration.%'`;
    await migratorSql`DELETE FROM users WHERE email LIKE '%@x.test'`;

    const adminId = firstId(
      await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role, is_owner)
        VALUES (${`a-${randomUUID()}@x.test`}, 'Admin', 'ADMIN'::user_role, TRUE) RETURNING id`,
    );
    const cashierId = firstId(
      await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role) RETURNING id`,
    );

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const deviceId = firstId(
      await migratorSql<{ id: string }[]>`
        INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
        VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
                now() - interval '1 day', now() + interval '365 days', ${adminId})
        RETURNING id`,
    );

    adminToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminId}, ${adminToken}, now() + interval '30 days', ${deviceId}, now())`;

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierId}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, NULL)`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // `withBody` adds the JSON content-type only when a payload is sent — Fastify
  // rejects an empty body when content-type is application/json (POST /test +
  // GET carry no body).
  function authHeaders(token?: string, withBody = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (withBody) headers['content-type'] = 'application/json';
    if (token) headers.cookie = `warehouse14.session=${token}`;
    headers['x-dev-device-fingerprint'] = deviceFingerprint;
    return headers;
  }

  function getList(token?: string) {
    return app.inject({ method: 'GET', url: '/api/integrations', headers: authHeaders(token) });
  }
  function putKey(id: string, payload: Record<string, unknown>, token?: string) {
    return app.inject({
      method: 'PUT',
      url: `/api/integrations/${id}`,
      headers: authHeaders(token, true),
      payload,
    });
  }
  function postTest(id: string, token?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/integrations/${id}/test`,
      headers: authHeaders(token),
    });
  }

  it('rejects an unauthenticated GET (401)', async () => {
    const res = await getList();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a cashier GET — ADMIN only (403)', async () => {
    const res = await getList(cashierToken);
    expect(res.statusCode).toBe(403);
  });

  it('GET returns the typed integration list (configured=false before any key)', async () => {
    const res = await getList(adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: string;
      label: string;
      configured: boolean;
      source: string;
      lastTestOk: boolean | null;
      lastTestedAt: string | null;
    }>;

    expect(Array.isArray(body)).toBe(true);
    const ids = body.map((i) => i.id).sort();
    expect(ids).toEqual(['ai', 'chatwoot', 'social', 'whatsapp']);

    for (const item of body) {
      expect(typeof item.label).toBe('string');
      expect(item.configured).toBe(false);
      expect(item.source).toBe('none');
      expect(item.lastTestOk).toBeNull();
      expect(item.lastTestedAt).toBeNull();
      // The key itself must NEVER appear in the payload.
      expect(item).not.toHaveProperty('apiKey');
      expect(item).not.toHaveProperty('key');
    }
  });

  it('rejects an unknown integration id on PUT (404)', async () => {
    const res = await putKey('does-not-exist', { apiKey: 'x' }, adminToken);
    expect(res.statusCode).toBe(404);
  });

  it('PUT stores the key, then GET shows configured=true / source=settings (no key echo)', async () => {
    const put = await putKey('ai', { apiKey: 'sk-ant-secret-123' }, adminToken);
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ configured: true });
    // The response must not leak the key anywhere.
    expect(JSON.stringify(put.json())).not.toContain('sk-ant-secret-123');

    const list = await getList(adminToken);
    expect(list.statusCode).toBe(200);
    const ai = (list.json() as Array<{ id: string; configured: boolean; source: string }>).find(
      (i) => i.id === 'ai',
    );
    expect(ai).toMatchObject({ configured: true, source: 'settings' });
    expect(JSON.stringify(list.json())).not.toContain('sk-ant-secret-123');

    // The secret is stored server-side under integration.ai.api_key.
    const rows = await migratorSql<{ value: string }[]>`
      SELECT value::text AS value FROM system_settings WHERE key = 'integration.ai.api_key'`;
    expect(rows[0]?.value).toBe('"sk-ant-secret-123"');
  });

  it('POST /test (mocked OK fetch) returns a typed result and persists last-test status', async () => {
    await putKey('ai', { apiKey: 'sk-ant-secret-123' }, adminToken);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response);

    const res = await postTest('ai', adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; status?: number; message: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe(200);
    expect(typeof body.message).toBe('string');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('api.anthropic.com');

    // The result is persisted → surfaces on the next GET.
    const list = await getList(adminToken);
    const ai = (
      list.json() as Array<{ id: string; lastTestOk: boolean | null; lastTestedAt: string | null }>
    ).find((i) => i.id === 'ai');
    expect(ai?.lastTestOk).toBe(true);
    expect(ai?.lastTestedAt).not.toBeNull();
    expect(() => new Date(ai?.lastTestedAt as string).toISOString()).not.toThrow();
  });

  it('POST /test (mocked 401 fetch) reports ok=false with a German message', async () => {
    await putKey('ai', { apiKey: 'sk-ant-bad' }, adminToken);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as unknown as Response);

    const res = await postTest('ai', adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; status?: number; message: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe(401);
    expect(body.message).toContain('ungültig');
  });

  it('POST /test (network error) reports ok=false and never throws', async () => {
    await putKey('whatsapp', { apiKey: 'meta-token', phoneNumberId: '123' }, adminToken);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await postTest('whatsapp', adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message.length).toBeGreaterThan(0);

    // A failed probe is still persisted as lastTestOk=false.
    const list = await getList(adminToken);
    const wa = (list.json() as Array<{ id: string; lastTestOk: boolean | null }>).find(
      (i) => i.id === 'whatsapp',
    );
    expect(wa?.lastTestOk).toBe(false);
  });

  it('POST /test without a configured key returns ok=false (no fetch attempted)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await postTest('social', adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain('Schlüssel');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
