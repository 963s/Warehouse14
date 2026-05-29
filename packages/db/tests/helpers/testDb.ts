/**
 * Test-database bootstrapping via @testcontainers/postgresql.
 *
 * Spins up a single `pgvector/pgvector:pg17` container per test run (singleFork
 * in vitest.config.ts) so all migration suites share one container. Each suite
 * applies migrations 0001..N against a fresh schema.
 *
 * The migrator role is created in the initdb step so migration 0003 can
 * assume it exists — matching the production discipline (see
 * infrastructure/docker/postgres/initdb.d/README.md).
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');

/**
 * Initdb fragment that creates the warehouse14_migrator role before any
 * migration runs. Matches the dev script
 * infrastructure/docker/postgres/initdb.d/00-create-migrator-role.sh.
 */
const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

export interface TestDb {
  container: StartedPostgreSqlContainer;
  /** Connection as warehouse14_migrator — use to apply migrations and inspect state. */
  migratorSql: Sql;
  /**
   * Lazy constructor for a warehouse14_app connection.
   *
   * The app role does not exist until migration 0003 has run. Tests that need
   * to assert "the app role cannot DELETE" call appSql() AFTER migrating up
   * past 0003 AND after `setAppPasswordForTest(migratorSql)`.
   *
   * Each call returns a fresh `postgres` Sql tag; the caller is responsible
   * for `.end()` when done.
   */
  appSql: () => Sql;
  /** Tear down: close migrator connection + stop the container. Safe to call multiple times. */
  cleanup: () => Promise<void>;
}

/**
 * Start a fresh Postgres container with pgvector + pg_stat_statements
 * preloaded, plus the warehouse14_migrator role pre-created.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase('warehouse14_test')
    .withUsername('postgres')
    .withPassword('postgres_test_pw')
    .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
    .withCopyContentToContainer([
      {
        content: INITDB_SQL,
        target: '/docker-entrypoint-initdb.d/00-create-migrator-role.sql',
      },
    ])
    .start();

  const migratorSql = postgres({
    host: container.getHost(),
    port: container.getPort(),
    database: 'warehouse14_test',
    username: 'warehouse14_migrator',
    password: 'warehouse14_migrator_test_pw',
    max: 1,
    onnotice: () => {},
  });

  const host = container.getHost();
  const port = container.getPort();

  const appSqlFactory = (): Sql =>
    postgres({
      host,
      port,
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 1,
      onnotice: () => {},
    });

  let stopped = false;
  return {
    container,
    migratorSql,
    appSql: appSqlFactory,
    cleanup: async () => {
      if (stopped) return;
      stopped = true;
      await migratorSql.end({ timeout: 5 }).catch(() => {});
      await container.stop().catch(() => {});
    },
  };
}

/**
 * Apply migrations 0001 .. upTo (inclusive) against the test DB.
 *
 * `upTo` is the integer migration number (e.g. 3 for `0003_roles.sql`).
 * The runner reads every file matching `NNNN_*.sql`, sorts numerically, and
 * skips files whose number exceeds `upTo`.
 *
 * Re-runnable: idempotent migrations can be applied repeatedly. Non-idempotent
 * migrations will fail on the second run — that is the migration's bug, not
 * the runner's.
 */
export async function applyMigrations(sql: Sql, upTo: number): Promise<void> {
  const all = await readdir(MIGRATIONS_DIR);
  const files = all
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .filter((name) => Number.parseInt(name.slice(0, 4), 10) <= upTo)
    .sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await sql.unsafe(sqlText);
  }
}

/**
 * After migration 0003 runs, warehouse14_app exists with no password set.
 * This sets a known dev/test password so the app-role connection factory can
 * authenticate. Production uses Oracle Vault and is out of scope here.
 */
export async function setAppPasswordForTest(migratorSql: Sql): Promise<void> {
  await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);
}
