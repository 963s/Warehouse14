/**
 * @warehouse14/inventory-lock — integration tests.
 *
 * The race condition test is the centerpiece. Everything else is a
 * structural / lifecycle smoke. Per Basel's directive, no test sprawl.
 *
 * Setup: full migrations 0001-0006 applied. The test acts as the API role
 * via the same connection model the runtime uses.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import {
  ReservationOwnershipError,
  autoReleaseExpired,
  finalize,
  release,
  reserve,
} from '@warehouse14/inventory-lock';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('@warehouse14/inventory-lock', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  // Drizzle bound to the warehouse14_app connection — the runtime surface.
  let appDb: AppDb;

  /** Insert an AVAILABLE product as migrator, return its id. */
  async function makeAvailableProduct(): Promise<string> {
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status,
              'MARGIN_25A', 'gold_jewelry'::item_type,
              100, 250, 'Race Test', now())
      RETURNING id
    `;
    return row.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 6);
    await setAppPasswordForTest(migratorSql);

    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 20, // headroom for the race tests
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. The race — the entire reason this package exists
  // ────────────────────────────────────────────────────────────────────

  describe('reserve() race condition', () => {
    it('100 concurrent reservations on one product → exactly one wins', async () => {
      const productId = await makeAvailableProduct();

      const attempts = Array.from({ length: 100 }, () =>
        reserve(appDb, {
          productId,
          channel: 'STOREFRONT',
          sessionId: crypto.randomUUID(),
        }),
      );
      const results = await Promise.all(attempts);

      const winners = results.filter((r) => r !== null);
      const losers = results.filter((r) => r === null);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(99);

      // The DB row reflects the winner's session.
      const [row] = await migratorSql<
        {
          status: string;
          reserved_by_session_id: string;
          reserved_by_channel: string;
        }[]
      >`
        SELECT status, reserved_by_session_id, reserved_by_channel FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('RESERVED');
      expect(row.reserved_by_channel).toBe('STOREFRONT');
      expect(row.reserved_by_session_id).toBe(winners[0]!.sessionId);
    });

    it('mixed-channel race (POS + STOREFRONT + EBAY all bid for the same item) → exactly one wins', async () => {
      const productId = await makeAvailableProduct();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`race-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);

      const channels = ['POS', 'STOREFRONT', 'EBAY', 'STOREFRONT', 'EBAY'] as const;
      const attempts = channels.map((channel) =>
        reserve(appDb, {
          productId,
          channel,
          sessionId: crypto.randomUUID(),
          userId: channel === 'POS' ? userId : null,
        }),
      );
      const results = await Promise.all(attempts);
      const winners = results.filter((r) => r !== null);
      expect(winners).toHaveLength(1);
    });

    it('reserving a DRAFT product fails (status filter is strict)', async () => {
      const [row] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name)
        VALUES (${`DRAFT-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, 100, 250, 'Draft Item')
        RETURNING id
      `;
      const result = await reserve(appDb, {
        productId: row.id,
        channel: 'POS',
        sessionId: crypto.randomUUID(),
      });
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. TTL discipline per channel (ADR-0016 §3)
  // ────────────────────────────────────────────────────────────────────

  describe('reserve() TTL per channel', () => {
    it('POS → expiresAt is null (held indefinitely)', async () => {
      const productId = await makeAvailableProduct();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`pos-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);
      const r = await reserve(appDb, {
        productId,
        channel: 'POS',
        sessionId: crypto.randomUUID(),
        userId,
      });
      expect(r).not.toBeNull();
      expect(r!.expiresAt).toBeNull();
    });

    it('STOREFRONT → expiresAt ≈ reservedAt + 15 minutes', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'STOREFRONT',
        sessionId: crypto.randomUUID(),
      });
      expect(r).not.toBeNull();
      expect(r!.expiresAt).toBeInstanceOf(Date);
      const delta = r!.expiresAt!.getTime() - r!.reservedAt.getTime();
      expect(delta).toBeGreaterThan(14 * 60 * 1000);
      expect(delta).toBeLessThan(16 * 60 * 1000);
    });

    it('EBAY → expiresAt ≈ reservedAt + 10 minutes', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'EBAY',
        sessionId: crypto.randomUUID(),
      });
      expect(r).not.toBeNull();
      expect(r!.expiresAt).toBeInstanceOf(Date);
      const delta = r!.expiresAt!.getTime() - r!.reservedAt.getTime();
      expect(delta).toBeGreaterThan(9 * 60 * 1000);
      expect(delta).toBeLessThan(11 * 60 * 1000);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Lifecycle: release + finalize
  // ────────────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('release() returns a reserved product to AVAILABLE', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'STOREFRONT',
        sessionId: crypto.randomUUID(),
      });
      await release(appDb, {
        productId,
        sessionId: r!.sessionId,
        userId: null,
        reason: 'storefront_checkout_abandoned',
      });
      const [row] = await migratorSql<
        {
          status: string;
          reserved_by_channel: string | null;
          reserved_at: Date | null;
        }[]
      >`
        SELECT status, reserved_by_channel, reserved_at FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('AVAILABLE');
      expect(row.reserved_by_channel).toBeNull();
      expect(row.reserved_at).toBeNull();
    });

    it('release() with wrong session id throws ReservationOwnershipError', async () => {
      const productId = await makeAvailableProduct();
      await reserve(appDb, {
        productId,
        channel: 'STOREFRONT',
        sessionId: crypto.randomUUID(),
      });
      await expect(
        release(appDb, {
          productId,
          sessionId: crypto.randomUUID(), // different session
          userId: null,
          reason: 'admin_manual_release',
        }),
      ).rejects.toBeInstanceOf(ReservationOwnershipError);
    });

    it('finalize() moves RESERVED → SOLD with sold_at set', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'EBAY',
        sessionId: crypto.randomUUID(),
      });
      await finalize(appDb, { productId, sessionId: r!.sessionId, userId: null });
      const [row] = await migratorSql<{ status: string; sold_at: Date | null }[]>`
        SELECT status, sold_at FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('SOLD');
      expect(row.sold_at).toBeInstanceOf(Date);
    });

    it('finalize() with wrong session id throws ReservationOwnershipError', async () => {
      const productId = await makeAvailableProduct();
      await reserve(appDb, {
        productId,
        channel: 'EBAY',
        sessionId: crypto.randomUUID(),
      });
      await expect(
        finalize(appDb, { productId, sessionId: crypto.randomUUID(), userId: null }),
      ).rejects.toBeInstanceOf(ReservationOwnershipError);
    });

    it('finalize() on a non-RESERVED product (AVAILABLE) throws', async () => {
      const productId = await makeAvailableProduct();
      await expect(
        finalize(appDb, { productId, sessionId: crypto.randomUUID(), userId: null }),
      ).rejects.toBeInstanceOf(ReservationOwnershipError);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. autoReleaseExpired
  // ────────────────────────────────────────────────────────────────────

  describe('autoReleaseExpired()', () => {
    it('releases STOREFRONT/EBAY rows whose expiry is in the past', async () => {
      // Insert an artificially-expired reservation via the migrator (so we
      // sidestep the CASE-based TTL inside reserve()).
      const productId = await makeAvailableProduct();
      await migratorSql`
        UPDATE products
           SET status                 = 'RESERVED',
               reserved_by_channel    = 'STOREFRONT'::reservation_channel,
               reserved_by_session_id = gen_random_uuid(),
               reserved_at            = now() - interval '20 minutes',
               reservation_expires_at = now() - interval '5 minutes'
         WHERE id = ${productId}
      `;

      const released = await autoReleaseExpired(appDb);
      expect(released).toContain(productId);

      const [row] = await migratorSql<{ status: string }[]>`
        SELECT status FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('AVAILABLE');
    });

    it('does NOT release POS reservations (expires_at is NULL)', async () => {
      const productId = await makeAvailableProduct();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`pos2-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);
      await reserve(appDb, {
        productId,
        channel: 'POS',
        sessionId: crypto.randomUUID(),
        userId,
      });
      const released = await autoReleaseExpired(appDb);
      expect(released).not.toContain(productId);
    });

    it('idempotent — running twice releases nothing the second time', async () => {
      // Re-run the sweep; nothing should be expired now.
      const released = await autoReleaseExpired(appDb);
      expect(released).toEqual([]);
    });
  });
});
