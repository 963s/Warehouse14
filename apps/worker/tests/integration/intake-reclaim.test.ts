/**
 * Phase-0 B — the intake sweep reclaims sessions stuck in PROCESSING.
 *
 * A worker crash/abort between the PROCESSING flip and the terminal flip would
 * strand a session forever (the batch only picks GROUPED). The sweep now first
 * reclaims `status='PROCESSING' AND processing_started_at < now() - 10min` back
 * to GROUPED. Real Postgres via testcontainers; mirrors the cart-sweeper test.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { WorkerDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The proven per-statement migration applier (sets check_function_bodies off +
// honours psql -f autocommit semantics — both required, see its header).
import { applyAllMigrations } from '../../../api-cloud/tests/integration/_migrate.js';
import { intakeSweepJob } from '../../src/jobs/intake-sweep.js';
import type { JobContext } from '../../src/lib/job-runner.js';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT CREATEROLE SUPERUSER
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

describe('intake_sweep — stuck-PROCESSING reclaim (Phase-0 B)', () => {
  let container: StartedPostgreSqlContainer;
  let sql: Sql;
  let db: WorkerDb;
  let staffPhoneId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();
    sql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
      // Production applies migrations with check_function_bodies off (migrate.sh
      // PGOPTIONS); some helper bodies (0007 blind_index → pgcrypto hmac) only
      // resolve at call time, so CREATE FUNCTION fails with body-checking ON.
      connection: { options: '-c check_function_bodies=off' },
    });
    await applyAllMigrations(sql);
    db = drizzle(sql, { schema });
  }, 120_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  beforeEach(async () => {
    await sql`DELETE FROM intake_sessions`;
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${randomUUID()}@x.test`}, 'Intake', 'ADMIN'::user_role) RETURNING id::text AS id`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO staff_phone_numbers (user_id, phone_e164, role, verified_at)
      VALUES (${u!.id}::uuid, ${`+49${Math.floor(Math.random() * 1e9)}`}, 'BOTH', now())
      RETURNING id::text AS id`;
    staffPhoneId = p!.id;
  });

  function ctx(): JobContext {
    return {
      db,
      sql,
      runId: 'test-run',
      jobRunId: 1n,
      signal: new AbortController().signal,
      log: noopLog,
    };
  }

  async function seedProcessing(minutesAgo: number): Promise<string> {
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO intake_sessions (staff_phone_id, grouping_closes_at, status, processing_started_at)
      VALUES (${staffPhoneId}::uuid, now(), 'PROCESSING'::intake_status,
              now() - make_interval(mins => ${minutesAgo}))
      RETURNING id::text AS id`;
    return s!.id;
  }

  it('reclaims a session stuck in PROCESSING past the 10-minute floor', async () => {
    const id = await seedProcessing(20);
    const res = (await intakeSweepJob().run(ctx())) as { stuckReclaimed: number };
    expect(res.stuckReclaimed).toBe(1);
    // Reclaimed to GROUPED then driven to a TERMINAL state this tick — never
    // left stranded in PROCESSING.
    const [row] = await sql<{ status: string }[]>`
      SELECT status::text AS status FROM intake_sessions WHERE id = ${id}::uuid`;
    expect(row!.status).not.toBe('PROCESSING');
  });

  it('does NOT reclaim a recently-started PROCESSING session', async () => {
    const id = await seedProcessing(1);
    const res = (await intakeSweepJob().run(ctx())) as { stuckReclaimed: number };
    expect(res.stuckReclaimed).toBe(0);
    const [row] = await sql<{ status: string }[]>`
      SELECT status::text AS status FROM intake_sessions WHERE id = ${id}::uuid`;
    expect(row!.status).toBe('PROCESSING'); // untouched — still actively processing
  });
});
