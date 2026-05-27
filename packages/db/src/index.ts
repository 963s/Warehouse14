/**
 * @warehouse14/db
 *
 * Drizzle ORM schema, hand-written SQL migrations, and connection clients for Warehouse14.
 *
 * Public surface:
 *   import { connectApp, connectMigrator } from '@warehouse14/db/client';
 *   import * as schema                      from '@warehouse14/db/schema';
 *   import { withPiiKey }                   from '@warehouse14/db';
 *
 * Migrations live in `./migrations` and are applied via `pnpm db:migrate`
 * (delegates to `drizzle-kit migrate`). Migrations MUST run as the
 * `warehouse14_migrator` role — see ADR-0008 §3 + ADR-0018 §10.
 */

export * from './client.js';
export * from './pii.js';
