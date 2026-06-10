/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Public appointment booking + iCal feed — CONTRACT endpoints 1–3 (E2E)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Boots the REAL Fastify app against a REAL Postgres (testcontainers,
 * pgvector:pg17) with EVERY production migration applied (incl. the new 0062),
 * connected as the REAL `warehouse14_app` role — so grant gaps in the
 * SECURITY DEFINER trigger chain surface here, not in prod (the 0055/0056/0057
 * lesson). Drives the routes through `app.inject()`:
 *
 *   ✓ GET  /api/storefront/appointments/slots reflects business hours
 *       (Mon 10–18 → 16×30-min slots, all available on an empty day; Sunday
 *       closed → zero slots),
 *   ✓ POST /api/storefront/appointments/book → 201 SCHEDULED, source='WEB',
 *       booked_via='storefront', walk-in contact fields persisted, a
 *       booking_confirmation notification (channel 'sse'), NO PII echo,
 *       and the slot flips to available:false,
 *   ✓ double-booking the same slot → 409,
 *   ✓ outside business hours / closed day → 400,
 *   ✓ the strict 5/h/IP rate limit fires on the 6th request,
 *   ✓ GET /api/appointments/feed.ics: 401 without/with a wrong token; after an
 *       ADMIN+step-up rotate → 200 text/calendar with the German VEVENT,
 *   ✓ rotating again invalidates the old token instantly.
 *
 * NOTE: requires Docker (testcontainers) — same as every api-cloud integration
 * test. Run via `pnpm --filter @warehouse14/api-cloud test:integration`.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { applyAllMigrations } from './_migrate.js';

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

/** Berlin wall-clock HH:MM of an instant (DST-correct, mirrors the route). */
function berlinHm(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** Next calendar date (YYYY-MM-DD) with the given JS weekday, ≥7 days out. */
function nextDateWithWeekday(weekday: number): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  for (let i = 0; i < 7; i++) {
    const probe = new Date(d.getTime() + i * 24 * 60 * 60 * 1000);
    const ymd = probe.toISOString().slice(0, 10);
    if (new Date(`${ymd}T12:00:00Z`).getUTCDay() === weekday) return ymd;
  }
  throw new Error('unreachable');
}

describe('appointment booking + iCal feed — CONTRACT 1–3 (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let adminStepUpToken: string;
  let cashierToken: string;

  const monday = nextDateWithWeekday(1);
  const sunday = nextDateWithWeekday(0);

  // Captured across the sequential tests below.
  let bookedSlotIso = '';
  let feedToken = '';

  let ipCounter = 1;
  /** A fresh client IP per call-site so the 5/h budget never bleeds across tests. */
  function freshIp(): string {
    ipCounter += 1;
    return `10.77.0.${ipCounter}`;
  }

  function getSlots(date: string, type = 'VIEWING') {
    return app.inject({
      method: 'GET',
      url: `/api/storefront/appointments/slots?date=${date}&type=${type}`,
      headers: { 'x-forwarded-for': freshIp() },
    });
  }

  function book(body: Record<string, unknown>, ip: string) {
    return app.inject({
      method: 'POST',
      url: '/api/storefront/appointments/book',
      headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
      payload: body,
    });
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
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
      WHATSAPP_PHONE_NUMBER_ID: '',
      WHATSAPP_ACCESS_TOKEN: '',
    };
    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });

    // Actors: the owner is the implicit web-booking staff assignee.
    const [admin] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`owner-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    const adminUserId = admin?.id;
    if (!adminUserId) throw new Error('admin seed failed');

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`cash-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;

    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${randomUUID().replace(/-/g, '')},
              now() - interval '1 day', now() + interval '365 days', ${adminUserId})
      RETURNING id`;
    const deviceId = dev?.id;

    adminStepUpToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminUserId}, ${adminStepUpToken}, now() + interval '8 hours', ${deviceId}, now())`;

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashier?.id}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, now())`;
  }, 180_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  // ── CONTRACT 1: slots ──────────────────────────────────────────────────

  it('slots reflect business hours: Monday 10–18 Berlin → 16 free 30-min slots', async () => {
    const res = await getSlots(monday);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      date: string;
      slots: Array<{ startsAt: string; available: boolean }>;
    };
    expect(body.date).toBe(monday);
    expect(body.slots).toHaveLength(16); // (18:00−10:00) × 2
    expect(berlinHm(body.slots[0]?.startsAt ?? '')).toBe('10:00');
    expect(berlinHm(body.slots[15]?.startsAt ?? '')).toBe('17:30');
    expect(body.slots.every((s) => s.available)).toBe(true);
  });

  it('slots on a closed day (Sunday) → empty grid', async () => {
    const res = await getSlots(sunday);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { slots: unknown[] }).slots).toHaveLength(0);
  });

  it('rejects a malformed/impossible date with 400', async () => {
    const res = await getSlots('2026-02-31');
    expect(res.statusCode).toBe(400);
  });

  // ── CONTRACT 2: book ───────────────────────────────────────────────────

  it('books a slot → 201 SCHEDULED, source=WEB, contact fields, sse confirmation, NO PII echo', async () => {
    const slotsRes = await getSlots(monday, 'BUYBACK_EVAL');
    const slots = (slotsRes.json() as { slots: Array<{ startsAt: string }> }).slots;
    bookedSlotIso = slots[2]?.startsAt ?? ''; // 11:00 Berlin
    expect(bookedSlotIso).not.toBe('');

    const res = await book(
      {
        type: 'BUYBACK_EVAL',
        startsAt: bookedSlotIso,
        name: 'Max Mustermann',
        phone: '+49 170 1234567',
        email: 'max@example.de',
        note: 'Goldmünzen, ca. 5 Stück',
      },
      freshIp(),
    );
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('SCHEDULED');
    expect(body.type).toBe('BUYBACK_EVAL');
    expect(new Date(body.startsAt as string).getTime()).toBe(new Date(bookedSlotIso).getTime());
    expect(typeof body.id).toBe('string');
    // NO PII echo beyond the booked slot (CONTRACT 2).
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('email');

    const [row] = await migratorSql<
      Array<{
        source: string;
        booked_via: string;
        status: string;
        contact_name: string;
        contact_phone: string;
        contact_email: string;
        duration_minutes: number;
      }>
    >`
      SELECT source, booked_via, status::text AS status, contact_name, contact_phone,
             contact_email, duration_minutes
      FROM appointments WHERE id = ${body.id as string}::uuid`;
    expect(row?.source).toBe('WEB');
    expect(row?.booked_via).toBe('storefront');
    expect(row?.status).toBe('SCHEDULED');
    expect(row?.contact_name).toBe('Max Mustermann');
    expect(row?.contact_phone).toBe('+49 170 1234567');
    expect(row?.contact_email).toBe('max@example.de');
    expect(row?.duration_minutes).toBe(30);

    const notif = await migratorSql<Array<{ channel: string; notification_type: string }>>`
      SELECT channel, notification_type FROM appointment_notifications
      WHERE appointment_id = ${body.id as string}::uuid`;
    expect(notif.some((n) => n.notification_type === 'booking_confirmation')).toBe(true);
    expect(notif.some((n) => n.channel === 'sse')).toBe(true);
    // WhatsApp env is empty in this suite → no whatsapp leg.
    expect(notif.some((n) => n.channel === 'whatsapp')).toBe(false);

    // The grid now reports the slot as taken.
    const after = await getSlots(monday);
    const taken = (
      after.json() as { slots: Array<{ startsAt: string; available: boolean }> }
    ).slots.find((s) => new Date(s.startsAt).getTime() === new Date(bookedSlotIso).getTime());
    expect(taken?.available).toBe(false);
  });

  it('double-booking the same slot → 409', async () => {
    const res = await book(
      {
        type: 'CONSULTATION',
        startsAt: bookedSlotIso,
        name: 'Erika Beispiel',
        phone: '+49 171 7654321',
      },
      freshIp(),
    );
    expect(res.statusCode).toBe(409);
  });

  it('outside business hours → 400 (before opening + closed Sunday)', async () => {
    // 09:00 Berlin on the open Monday (one hour before opening).
    const beforeOpening = new Date(new Date(bookedSlotIso).getTime() - 2 * 60 * 60 * 1000);
    const res1 = await book(
      {
        type: 'VIEWING',
        startsAt: beforeOpening.toISOString(),
        name: 'Foo Bar',
        phone: '+49 152 0000001',
      },
      freshIp(),
    );
    expect(res1.statusCode).toBe(400);

    // Any instant on the closed Sunday.
    const sundayInstant = new Date(new Date(bookedSlotIso).getTime() - 24 * 60 * 60 * 1000);
    const res2 = await book(
      {
        type: 'VIEWING',
        startsAt: sundayInstant.toISOString(),
        name: 'Foo Bar',
        phone: '+49 152 0000002',
      },
      freshIp(),
    );
    expect(res2.statusCode).toBe(400);
  });

  it('strict rate limit fires: 6th booking request from one IP within the hour → 429', async () => {
    const ip = freshIp();
    const past = {
      type: 'VIEWING',
      startsAt: '2000-01-01T10:00:00Z',
      name: 'RL',
      phone: '+4915200000',
    };
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await book(past, ip);
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 400)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  // ── CONTRACT 3: iCal feed + token rotation ─────────────────────────────

  it('feed.ics without a token → 401; with a wrong token → 401', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/api/appointments/feed.ics' });
    expect(noToken.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: `/api/appointments/feed.ics?token=${'0'.repeat(64)}`,
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('feed-token rotate requires ADMIN (+ the auth gate)', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/appointments/feed-token' });
    expect(anon.statusCode).toBe(401);

    const cashier = await app.inject({
      method: 'POST',
      url: '/api/appointments/feed-token',
      headers: { cookie: `warehouse14.session=${cashierToken}` },
    });
    expect(cashier.statusCode).toBe(403);
  });

  it('ADMIN+step-up rotate → 64-hex token; feed.ics then serves the German VEVENT', async () => {
    const rot = await app.inject({
      method: 'POST',
      url: '/api/appointments/feed-token',
      headers: { cookie: `warehouse14.session=${adminStepUpToken}` },
    });
    expect(rot.statusCode).toBe(200);
    const rotBody = rot.json() as { token: string; url: string };
    expect(rotBody.token).toMatch(/^[0-9a-f]{64}$/);
    expect(rotBody.url).toContain(`/api/appointments/feed.ics?token=${rotBody.token}`);
    feedToken = rotBody.token;

    const feed = await app.inject({
      method: 'GET',
      url: `/api/appointments/feed.ics?token=${feedToken}`,
    });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    const ics = feed.body;
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    // The web booking from above: German type label + shortened name + status.
    expect(ics).toContain('SUMMARY:Ankauf-Termin – Max M. (Geplant)');
    expect(ics).toContain('END:VCALENDAR');
    // RFC 5545: CRLF line endings.
    expect(ics).toContain('\r\n');
  });

  it('rotating again invalidates the old token instantly', async () => {
    const rot = await app.inject({
      method: 'POST',
      url: '/api/appointments/feed-token',
      headers: { cookie: `warehouse14.session=${adminStepUpToken}` },
    });
    expect(rot.statusCode).toBe(200);
    const fresh = (rot.json() as { token: string }).token;
    expect(fresh).not.toBe(feedToken);

    const old = await app.inject({
      method: 'GET',
      url: `/api/appointments/feed.ics?token=${feedToken}`,
    });
    expect(old.statusCode).toBe(401);

    const now = await app.inject({
      method: 'GET',
      url: `/api/appointments/feed.ics?token=${fresh}`,
    });
    expect(now.statusCode).toBe(200);
  });
});
