/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Fiscal-export E2E — GET /api/closings/:id/export/{datev,dsfinvk}
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The systematic regression suite for the German tax-audit export surface. It
 * is the test that would have caught the recent LIVE-ONLY bugs:
 *   • the drizzle array-spread 42846/22P02 on the DSFinV-K item/payment/tse
 *     reads + the DATEV per-line read (every non-empty closing 500'd);
 *   • a §25a / §25c portion of a MIXED receipt collapsing onto the 19 % bucket
 *     (8400) instead of its own SKR03 Gegenkonto.
 *
 * It boots the REAL Fastify app against a REAL Postgres (testcontainers,
 * pgvector:pg17) with EVERY production migration applied via the shared
 * fidelity applier, seeds a FINALIZED daily_closing for one Berlin business day
 * whose transactions span ALL FOUR tax treatments + a MIXED-treatment receipt +
 * a storno, then drives the two export routes through `app.inject()`.
 *
 * Coverage matrix:
 *   DATEV
 *     ✓ auth gating: no session → 401; CASHIER → 403; ADMIN no step-up → 403
 *     ✓ ADMIN + step-up → 200 + the fixed EXTF Buchungsstapel header (line 1)
 *     ✓ per-treatment Gegenkonto + BU-Schlüssel:
 *         STANDARD_19→8400/BU3 · REDUCED_7→8300/BU2 · MARGIN_25A→8200 · §25c→8150
 *     ✓ ANKAUF → Wareneingang 3200 an Kasse 1000 (no output VAT key)
 *     ✓ MIXED receipt splits into per-treatment lines that RECONCILE to the
 *       receipt total in integer cents (8400 portion + 8150 portion = total)
 *     ✓ storno line carries the negated amount (German comma decimal)
 *   DSFinV-K
 *     ✓ auth gating mirrors DATEV
 *     ✓ 200 → a real ZIP that unzips to the 9 DFKA files (8 CSV + index.xml)
 *       with the correct DSFinV-K headers
 *     ✓ USt-Schlüssel by treatment (1/2/5/7) in bon_pos / bon_pos_ust
 *     ✓ VAT-by-treatment balances: per-line netto+ust = brutto, integer cents
 *     ✓ TSE fields present for a signed receipt (counter, signature, TSS id)
 *     ✓ ?encoding=base64 returns the SAME bytes, base64-encoded
 *     ✓ empty day (a finalized closing with zero transactions) → 200, no 500
 *       (the array-spread bug's exact blast radius — proven gone)
 *
 * Seeding goes straight through the migrator role (not the finalize route): we
 * need exact, hand-computed integer-cent figures spanning every treatment, and
 * the route paths under test are the EXPORTS, not finalize. The DB's own CHECK
 * constraints (subtotal+vat=total, storno mirror, KYC gate) still validate every
 * seeded row, so the fixtures are fiscally well-formed.
 *
 * TEST ONLY — never edits production source; the DB lives in a throwaway
 * container.
 */

import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@warehouse14/db/client';
import * as schema from '@warehouse14/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

// ── Minimal ZIP reader (central-directory walk; STORE + DEFLATE) ─────────────
//
// The producer (dsfinvk-export.ts zipDsfinvkBundle) writes a deterministic ZIP
// with one local header per file + a central directory + EOCD. We read it back
// here to assert the bundle truly unzips (not just "looks like a zip"). Only the
// two methods the producer emits are supported: 0 = STORE, 8 = raw DEFLATE.

interface UnzippedFile {
  name: string;
  content: string;
}

function readZip(buf: Buffer): UnzippedFile[] {
  // Find EOCD (end of central directory) — scan from the end for the signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('readZip: no EOCD record found — not a ZIP');

  const total = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16); // central-dir offset

  const files: UnzippedFile[] = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) {
      throw new Error('readZip: bad central-directory header signature');
    }
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);

    // Local header: 30 fixed bytes + name + extra, then the data.
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    const raw = method === 8 ? inflateRawSync(comp) : Buffer.from(comp);
    files.push({ name, content: raw.toString('utf8') });

    cd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Parse a semicolon-delimited CSV body (DSFinV-K convention) into rows. */
function parseCsv(body: string): string[][] {
  return body
    .split(/\r\n|\n/)
    .filter((l) => l.length > 0)
    .map((line) => line.split(';'));
}

/** "123.45" → 12345n cents (test-side integer check; mirrors the route). */
function cents(eur: string): bigint {
  const v = eur.trim();
  const sign = v.startsWith('-') ? -1n : 1n;
  const abs = v.startsWith('-') ? v.slice(1) : v;
  const [whole = '0', frac = ''] = abs.split('.');
  const frac2 = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(frac2 || '0'));
}

describe('GET /api/closings/:id/export/{datev,dsfinvk} — fiscal-export E2E', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  // Actors / device / session tokens (fresh per test).
  let adminUserId: string;
  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let adminStepUpToken: string; // ADMIN, fresh step-up
  let adminNoStepUpToken: string; // ADMIN, no step-up
  let cashierToken: string; // CASHIER, fresh step-up

  // The seeded closing for the populated business day.
  let closingId: string;
  let emptyClosingId: string;
  const businessDay = '2026-05-04'; // a fixed Berlin business day for the suite
  const emptyBusinessDay = '2026-05-05';

  // Receipt locators we assert on (captured at seed time).
  let rcpStandard: string;
  let rcpReduced: string;
  let rcpMargin: string;
  let rcpGold: string;
  let rcpMixed: string;
  let rcpStorno: string;

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
      EBAY_API_TOKEN: '',
    };
    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  // ── Per-test seeding ─────────────────────────────────────────────────────

  /** Insert a finalized transaction + items (+ optional payment/TSE). Returns id+locator. */
  async function seedTransaction(opts: {
    direction: 'VERKAUF' | 'ANKAUF';
    treatment: string; // tx-level tax_treatment_code (must be a real code)
    subtotal: string;
    vat: string;
    total: string;
    customerId: string | null;
    finalizedAt: string; // ISO inside the Berlin business day
    items: Array<{
      productId: string;
      treatment: string;
      vatRate: string | null;
      lineSubtotal: string;
      lineVat: string;
      lineTotal: string;
      acquisition?: string | null;
      margin?: string | null;
      displayOrder: number;
    }>;
    /** Payment leg(s). MUST sum to the header total (deferred balance trigger). */
    payment: { method: string; amount: string };
    tse?: boolean;
    stornoOf?: string | null;
  }): Promise<{ id: string; locator: string }> {
    // A `transactions` row is INCOMPLETE on its own: a DEFERRABLE INITIALLY
    // DEFERRED constraint trigger (migration 0016) verifies at COMMIT that it
    // has ≥1 item, ≥1 payment, and that items + payments balance the header.
    // So the whole receipt (header + items + payment [+ tse]) MUST land inside
    // ONE database transaction — exactly how the finalize route writes it.
    return migratorSql.begin(async (tx) => {
      const [row] = await tx<{ id: string; receipt_locator: string }[]>`
        INSERT INTO transactions (
          direction, storno_of_transaction_id, customer_id, device_id, cashier_user_id,
          subtotal_eur, vat_eur, total_eur, tax_treatment_code, finalized_at
        ) VALUES (
          ${opts.direction}::transaction_direction,
          ${opts.stornoOf ?? null},
          ${opts.customerId},
          ${deviceId},
          ${cashierUserId},
          ${opts.subtotal}, ${opts.vat}, ${opts.total},
          ${opts.treatment},
          ${opts.finalizedAt}::timestamptz
        ) RETURNING id, receipt_locator`;
      const id = row!.id;

      for (const it of opts.items) {
        await tx`
          INSERT INTO transaction_items (
            transaction_id, product_id,
            line_subtotal_eur, line_vat_eur, line_total_eur,
            applied_tax_treatment_code, applied_vat_rate,
            acquisition_cost_eur_snapshot, margin_eur, display_order
          ) VALUES (
            ${id}, ${it.productId},
            ${it.lineSubtotal}, ${it.lineVat}, ${it.lineTotal},
            ${it.treatment}, ${it.vatRate},
            ${it.acquisition ?? null}, ${it.margin ?? null}, ${it.displayOrder}
          )`;
      }

      await tx`
        INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
        VALUES (${id}, ${opts.payment.method}::payment_method, ${opts.payment.amount})`;

      if (opts.tse) {
        await tx`
          INSERT INTO tse_signatures (
            transaction_id, fiskaly_tss_id, fiskaly_client_id,
            fiskaly_transaction_number, signature_value, signature_counter,
            signature_algorithm, process_type, tse_start_time, tse_end_time
          ) VALUES (
            ${id}, ${randomUUID()}, ${randomUUID()},
            ${Math.floor(Math.random() * 1_000_000) + 1},
            ${`sig-${randomUUID()}`}, ${Math.floor(Math.random() * 1_000_000) + 1},
            'ecdsa-plain-SHA256', 'Kassenbeleg-V1',
            ${opts.finalizedAt}::timestamptz, ${opts.finalizedAt}::timestamptz
          )`;
      }

      return { id, locator: row!.receipt_locator };
    });
  }

  /** Create a product available for sale; returns its id. */
  async function seedProduct(): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '10.00', '100.00', ${`Posten ${randomUUID().slice(0, 8)}`}, now())
      RETURNING id`;
    return p!.id;
  }

  beforeEach(async () => {
    // Reset the fiscal + actor tables between tests. TRUNCATE (not DELETE) is
    // required: tse_signatures + transactions are append-only with BEFORE
    // DELETE triggers that hard-refuse row deletion (fiscal immutability).
    // TRUNCATE is a table-level op that bypasses per-row triggers, and the
    // migrator role (superuser) may TRUNCATE despite the app-role grant model.
    // CASCADE follows the FK graph; ledger_events is left intact (append-only
    // evidence — the closing anchors to whatever head exists).
    await migratorSql.unsafe(
      'TRUNCATE tse_signatures, transaction_payments, transaction_items, ' +
        'transactions, daily_closings, sessions, devices, customers CASCADE',
    );
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE OR role <> 'ADMIN'`;

    // Actors.
    const [admin] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`admin-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    adminUserId = admin!.id;

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`cash-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    // mTLS device.
    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${adminUserId})
      RETURNING id`;
    deviceId = dev!.id;

    // Sessions: ADMIN+step-up, ADMIN-no-step-up, CASHIER+step-up.
    adminStepUpToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminUserId}, ${adminStepUpToken}, now() + interval '8 hours', ${deviceId}, now())`;

    adminNoStepUpToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminUserId}, ${adminNoStepUpToken}, now() + interval '8 hours', ${deviceId}, NULL)`;

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, now())`;

    // A KYC-verified customer (needed for ANKAUF + any ≥ €2.000 sale).
    const [cust] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until, kyc_verified_at, kyc_verified_by_user_id)
      SELECT encrypt_pii('Audit Kunde'), (now() + interval '5 years')::date, now(), ${adminUserId} FROM s
      RETURNING id`;
    const customerId = cust!.id;

    // ── Seed the day's transactions, one per treatment + MIXED + storno. ──
    // All VERKAUF totals stay < €2.000 so the KYC gate is satisfied without a
    // customer where convenient; the ANKAUF attaches the verified customer.
    const ts = (h: number, m: number) =>
      `${businessDay}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;

    // 1) STANDARD_19 — 119,00 brutto = 100,00 netto + 19,00 USt.
    const pStd = await seedProduct();
    const std = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '100.00',
      vat: '19.00',
      total: '119.00',
      customerId: null,
      finalizedAt: ts(9, 0),
      items: [
        {
          productId: pStd,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '119.00' },
      tse: true,
    });
    rcpStandard = std.locator;

    // 2) REDUCED_7 — 107,00 brutto = 100,00 netto + 7,00 USt.
    const pRed = await seedProduct();
    const red = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'REDUCED_7',
      subtotal: '100.00',
      vat: '7.00',
      total: '107.00',
      customerId: null,
      finalizedAt: ts(10, 0),
      items: [
        {
          productId: pRed,
          treatment: 'REDUCED_7',
          vatRate: '0.0700',
          lineSubtotal: '100.00',
          lineVat: '7.00',
          lineTotal: '107.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'ZVT_CARD', amount: '107.00' },
      tse: true,
    });
    rcpReduced = red.locator;

    // 3) MARGIN_25A — 200,00 brutto; acquisition 138,00 → margin 62,00;
    //    VAT-on-margin = round(62 * 19/119) = 9,90 → netto 190,10.
    const pMar = await seedProduct();
    const mar = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '190.10',
      vat: '9.90',
      total: '200.00',
      customerId: null,
      finalizedAt: ts(11, 0),
      items: [
        {
          productId: pMar,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '190.10',
          lineVat: '9.90',
          lineTotal: '200.00',
          acquisition: '138.00',
          margin: '62.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '200.00' },
      tse: true,
    });
    rcpMargin = mar.locator;

    // 4) INVESTMENT_GOLD_25C — 500,00 brutto = 500,00 netto + 0,00 USt (exempt).
    const pGold = await seedProduct();
    const gold = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'INVESTMENT_GOLD_25C',
      subtotal: '500.00',
      vat: '0.00',
      total: '500.00',
      customerId: null,
      finalizedAt: ts(12, 0),
      items: [
        {
          productId: pGold,
          treatment: 'INVESTMENT_GOLD_25C',
          vatRate: '0.0000',
          lineSubtotal: '500.00',
          lineVat: '0.00',
          lineTotal: '500.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '500.00' },
      tse: true,
    });
    rcpGold = gold.locator;

    // 5) MIXED receipt — STANDARD_19 line (119,00) + INVESTMENT_GOLD_25C line
    //    (500,00). tx total 619,00 = netto 600,00 + USt 19,00. tx-level code is
    //    STANDARD_19 (a real code); items span 2 treatments → DATEV must SPLIT.
    const pMixA = await seedProduct();
    const pMixB = await seedProduct();
    const mixed = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '600.00',
      vat: '19.00',
      total: '619.00',
      customerId: null,
      finalizedAt: ts(13, 0),
      items: [
        {
          productId: pMixA,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 0,
        },
        {
          productId: pMixB,
          treatment: 'INVESTMENT_GOLD_25C',
          vatRate: '0.0000',
          lineSubtotal: '500.00',
          lineVat: '0.00',
          lineTotal: '500.00',
          displayOrder: 1,
        },
      ],
      payment: { method: 'CASH', amount: '619.00' },
      tse: true,
    });
    rcpMixed = mixed.locator;

    // 6) ANKAUF — buy from a KYC-verified customer (300,00; no output VAT).
    const pAnk = await seedProduct();
    await seedTransaction({
      direction: 'ANKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '300.00',
      vat: '0.00',
      total: '300.00',
      customerId,
      finalizedAt: ts(14, 0),
      items: [
        {
          productId: pAnk,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '300.00',
          lineVat: '0.00',
          lineTotal: '300.00',
          acquisition: '300.00',
          margin: '0.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '300.00' },
      tse: true,
    });

    // 7) STORNO of the STANDARD_19 sale — negated mirror (trigger-validated).
    const storno = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '-100.00',
      vat: '-19.00',
      total: '-119.00',
      customerId: null,
      finalizedAt: ts(15, 0),
      items: [
        {
          productId: pStd,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '-100.00',
          lineVat: '-19.00',
          lineTotal: '-119.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '-119.00' }, // negative payment mirrors the refund
      stornoOf: std.id,
      tse: true,
    });
    rcpStorno = storno.locator;

    // Anchor the closing to the current chain head (the seed INSERTs above each
    // emitted a ledger_event, so the head is well-defined).
    const [head] = await migratorSql<{ id: string; row_hash: Buffer }[]>`
      SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;

    // ── The FINALIZED daily_closing for the populated business day. ──
    // gross/net are illustrative day rollups; the export routes read the
    // transactions table for the per-receipt lines (not these aggregates), so
    // exact reconciliation of these fields is asserted at the row level.
    const [closing] = await migratorSql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state,
        verkauf_count, ankauf_count, storno_count,
        gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
        vat_by_treatment, payments_by_method,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        tse_finished_count, tse_pending_count, tse_failed_count,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at
      ) VALUES (
        ${businessDay}::date, 'FINALIZED'::closing_state,
        5, 1, 1,
        '1545.00', '300.00', '1426.00', '300.00',
        ${migratorSql.json({ STANDARD_19: '19.00', REDUCED_7: '7.00', MARGIN_25A: '9.90', INVESTMENT_GOLD_25C: '0.00' })},
        ${migratorSql.json({ CASH: '1019.00', ZVT_CARD: '107.00' })},
        '1019.00', '1019.00', '0.00',
        6, 0, 0,
        ${head!.id}, ${head!.row_hash},
        ${adminUserId}, now(), ${adminUserId}, now()
      ) RETURNING id`;
    closingId = closing!.id;

    // An EMPTY FINALIZED closing (different day, zero transactions) — the exact
    // shape the array-spread bug exploded on the FIRST non-empty day, here the
    // mirror case proving an empty day also exports cleanly.
    const [head2] = await migratorSql<{ id: string; row_hash: Buffer }[]>`
      SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;
    const [emptyClosing] = await migratorSql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at
      ) VALUES (
        ${emptyBusinessDay}::date, 'FINALIZED'::closing_state,
        '0.00', '0.00', '0.00',
        ${head2!.id}, ${head2!.row_hash},
        ${adminUserId}, now(), ${adminUserId}, now()
      ) RETURNING id`;
    emptyClosingId = emptyClosing!.id;
  });

  // ── inject() helpers ───────────────────────────────────────────────────────

  function get(url: string, opts: { token?: string | null; fingerprint?: string | null } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token !== null) {
      headers.cookie = `warehouse14.session=${opts.token ?? adminStepUpToken}`;
    }
    if (opts.fingerprint !== null) {
      headers['x-dev-device-fingerprint'] = opts.fingerprint ?? deviceFingerprint;
    }
    return app.inject({ method: 'GET', url, headers });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  DATEV
  // ════════════════════════════════════════════════════════════════════════

  describe('DATEV export', () => {
    it('rejects with 401 when no session is presented', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`, { token: null });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('rejects a CASHIER with 403 (ADMIN/READONLY only)', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`, { token: cashierToken });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('rejects an ADMIN without a fresh step-up with 403 STEP_UP_REQUIRED', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`, {
        token: adminNoStepUpToken,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } });
    });

    it('404 for an unknown closing id (ADMIN + step-up)', async () => {
      const res = await get(`/api/closings/${randomUUID()}/export/datev`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('ADMIN + step-up → 200 with the fixed EXTF Buchungsstapel header', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      const csv = res.payload;
      const firstLine = csv.split('\r\n')[0] ?? '';
      expect(firstLine.startsWith('EXTF;700;21;Buchungsstapel;')).toBe(true);
      // The column header is line 2.
      const secondLine = csv.split('\r\n')[1] ?? '';
      expect(secondLine).toContain('Umsatz');
      expect(secondLine).toContain('Gegenkonto');
      expect(secondLine).toContain('BU-Schlüssel');
    });

    it('maps each treatment to the correct SKR03 Gegenkonto + BU-Schlüssel', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`);
      expect(res.statusCode).toBe(200);
      const lines = res.payload.split('\r\n');
      // Column indices (0-based): 0 Umsatz, 1 Soll/Haben, 6 Konto, 7 Gegenkonto,
      // 8 BU-Schlüssel, 10 Belegfeld1.
      type Booking = {
        umsatz: string;
        sh: string;
        konto: string;
        gegenkonto: string;
        bu: string;
        ref: string;
      };
      const bookings: Booking[] = lines
        .slice(2) // skip EXTF + column header
        .filter((l) => l.length > 0)
        .map((l) => {
          const cols = l.split(';').map((c) => c.replace(/^"|"$/g, ''));
          return {
            umsatz: cols[0] ?? '',
            sh: cols[1] ?? '',
            konto: cols[6] ?? '',
            gegenkonto: cols[7] ?? '',
            bu: cols[8] ?? '',
            ref: cols[10] ?? '',
          };
        });

      const byRef = (ref: string) => bookings.filter((b) => b.ref === ref);

      // STANDARD_19 → Kasse(1000) an Erlöse 8400, BU 3, posted to the Soll side.
      const std = byRef(rcpStandard);
      expect(std).toHaveLength(1);
      expect(std[0]).toMatchObject({
        konto: '1000',
        gegenkonto: '8400',
        bu: '3',
        umsatz: '119,00',
        sh: 'S',
      });

      // REDUCED_7 → 8300, BU 2.
      const red = byRef(rcpReduced);
      expect(red[0]).toMatchObject({
        konto: '1000',
        gegenkonto: '8300',
        bu: '2',
        umsatz: '107,00',
      });

      // MARGIN_25A → 8200, BU empty (the Konto carries the §25a treatment).
      const mar = byRef(rcpMargin);
      expect(mar[0]).toMatchObject({ konto: '1000', gegenkonto: '8200', bu: '', umsatz: '200,00' });

      // INVESTMENT_GOLD_25C → 8150, BU empty (0 % exempt).
      const gold = byRef(rcpGold);
      expect(gold[0]).toMatchObject({
        konto: '1000',
        gegenkonto: '8150',
        bu: '',
        umsatz: '500,00',
      });

      // ANKAUF → Wareneingang 3200 an Kasse 1000, no output VAT key.
      const ankauf = bookings.find((b) => b.konto === '3200');
      expect(ankauf).toBeDefined();
      expect(ankauf).toMatchObject({ konto: '3200', gegenkonto: '1000', bu: '' });

      // STORNO → DATEV-conforming reversal: same accounts/BU as the original,
      // POSITIVE Umsatz magnitude, Soll→Haben flipped (a negative Umsatz with S
      // would be non-conforming). This locks the §-correct storno polarity.
      const storno = byRef(rcpStorno);
      expect(storno).toHaveLength(1);
      expect(storno[0]).toMatchObject({ gegenkonto: '8400', bu: '3', umsatz: '119,00', sh: 'H' });
      // The original sits on the opposite side — the pair nets to zero revenue.
      expect(std[0]!.sh).toBe('S');
    });

    it('splits a MIXED receipt into per-treatment lines reconciling to the total (integer cents)', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`);
      const lines = res.payload.split('\r\n');
      const mixedRows = lines
        .slice(2)
        .filter((l) => l.includes(rcpMixed))
        .map((l) => {
          const cols = l.split(';').map((c) => c.replace(/^"|"$/g, ''));
          return { umsatz: cols[0] ?? '', gegenkonto: cols[7] ?? '', bu: cols[8] ?? '' };
        });

      // Two booking lines: one per treatment, NOT a single collapsed 8400 row.
      expect(mixedRows).toHaveLength(2);
      const byKonto = new Map(mixedRows.map((r) => [r.gegenkonto, r]));

      // STANDARD_19 portion on 8400/BU3 = 119,00.
      expect(byKonto.get('8400')).toMatchObject({ umsatz: '119,00', bu: '3' });
      // §25c portion on 8150, exempt = 500,00 — NOT taxed at 19 %.
      expect(byKonto.get('8150')).toMatchObject({ umsatz: '500,00', bu: '' });

      // The split reconciles to the receipt total 619,00 in integer cents.
      const sum = mixedRows.reduce((acc, r) => acc + cents(r.umsatz.replace(',', '.')), 0n);
      expect(sum).toBe(cents('619.00'));
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  DSFinV-K
  // ════════════════════════════════════════════════════════════════════════

  describe('DSFinV-K export', () => {
    it('rejects with 401 / 403 / 403 mirroring DATEV auth gating', async () => {
      const url = `/api/closings/${closingId}/export/dsfinvk`;
      expect((await get(url, { token: null })).statusCode).toBe(401);
      expect((await get(url, { token: cashierToken })).statusCode).toBe(403);
      const noStep = await get(url, { token: adminNoStepUpToken });
      expect(noStep.statusCode).toBe(403);
      expect(noStep.json()).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } });
    });

    it('404 for an unknown closing id', async () => {
      const res = await get(`/api/closings/${randomUUID()}/export/dsfinvk`);
      expect(res.statusCode).toBe(404);
    });

    it('ADMIN + step-up → 200 ZIP that unzips to the 9 DFKA files', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/zip');

      const zip = res.rawPayload; // Buffer
      expect(Buffer.isBuffer(zip)).toBe(true);
      const files = readZip(zip);
      const names = files.map((f) => f.name).sort();
      expect(names).toEqual(
        [
          'bon_kopf.csv',
          'bon_pos.csv',
          'bon_pos_preise.csv',
          'bon_pos_ust.csv',
          'bon_ust.csv',
          'cashpointclosing.csv',
          'datapayment.csv',
          'index.xml',
          'tse.csv',
        ].sort(),
      );

      // Headers of the core files match the DSFinV-K taxonomy column names.
      const fileMap = new Map(files.map((f) => [f.name, f.content]));
      const cpc = parseCsv(fileMap.get('cashpointclosing.csv') ?? '');
      expect(cpc[0]).toEqual([
        'Z_KASSE_ID',
        'Z_NR',
        'Z_BUCHUNGSTAG',
        'Z_ERSTELLUNG',
        'KASSE_SERIENNR',
        'KASSE_BRAND',
        'KASSE_MODELL',
        'GESAMT_BRUTTO_VERKAUF',
        'GESAMT_BRUTTO_ANKAUF',
        'GESAMT_NETTO_VERKAUF',
        'GESAMT_NETTO_ANKAUF',
        'BARGELD_GEZAEHLT',
      ]);
      // The closing row carries the seeded business day + gross totals.
      expect(cpc[1]?.[2]).toBe(businessDay);
      expect(cpc[1]?.[7]).toBe('1545.00'); // gross verkauf

      const bonKopf = parseCsv(fileMap.get('bon_kopf.csv') ?? '');
      expect(bonKopf[0]).toContain('BON_ID');
      expect(bonKopf[0]).toContain('BON_GESAMT_BRUTTO');
      // 7 receipts seeded (5 sales + ANKAUF + storno) → 7 bon_kopf data rows.
      expect(bonKopf.length - 1).toBe(7);

      const tse = parseCsv(fileMap.get('tse.csv') ?? '');
      expect(tse[0]).toEqual([
        'Z_KASSE_ID',
        'Z_NR',
        'BON_ID',
        'TSE_ID',
        'TSE_TA_NUMMER',
        'TSE_TA_SIGZ',
        'TSE_TA_SIG',
        'TSE_TA_START',
        'TSE_TA_ENDE',
        'TSE_TA_SIGALGO',
        'TSE_TA_VORGANGSART',
      ]);
    });

    it('assigns the correct USt-Schlüssel per treatment in bon_pos / bon_pos_ust', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const files = readZip(res.rawPayload);
      const fileMap = new Map(files.map((f) => [f.name, f.content]));

      // bon_pos: columns Z_KASSE_ID;Z_NR;BON_ID;POS_ZEILE;GV_TYP;ARTIKELTEXT;MENGE;UST_SCHLUESSEL
      const bonPos = parseCsv(fileMap.get('bon_pos.csv') ?? '');
      const bonIdIdx = bonPos[0]!.indexOf('BON_ID');
      const ustIdx = bonPos[0]!.indexOf('UST_SCHLUESSEL');
      const gvIdx = bonPos[0]!.indexOf('GV_TYP');
      const rows = bonPos.slice(1);

      const ustFor = (locator: string) =>
        rows.filter((r) => r[bonIdIdx] === locator).map((r) => r[ustIdx]);

      expect(ustFor(rcpStandard)).toEqual(['1']); // STANDARD_19 → 1 (19 %)
      expect(ustFor(rcpReduced)).toEqual(['2']); // REDUCED_7 → 2 (7 %)
      expect(ustFor(rcpMargin)).toEqual(['7']); // MARGIN_25A → 7 (§25a)
      expect(ustFor(rcpGold)).toEqual(['5']); // §25c → 5 (exempt)
      // MIXED receipt's two lines carry their own keys: 1 then 5.
      expect(ustFor(rcpMixed)).toEqual(['1', '5']);

      // ANKAUF lines are GV_TYP Einkauf.
      const einkaufRows = rows.filter((r) => r[gvIdx] === 'Einkauf');
      expect(einkaufRows.length).toBeGreaterThanOrEqual(1);
    });

    it('per-line VAT balances: netto + ust = brutto, integer cents, by treatment', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const files = readZip(res.rawPayload);
      const fileMap = new Map(files.map((f) => [f.name, f.content]));

      // bon_pos_ust carries the per-line VAT breakdown keyed by USt-Schlüssel:
      //   …;UST_SCHLUESSEL;POS_BRUTTO;POS_NETTO;POS_UST
      const ust = parseCsv(fileMap.get('bon_pos_ust.csv') ?? '');
      const h = ust[0]!;
      const bIdx = h.indexOf('POS_BRUTTO');
      const nIdx = h.indexOf('POS_NETTO');
      const uIdx = h.indexOf('POS_UST');
      const keyIdx = h.indexOf('UST_SCHLUESSEL');
      const bonIdIdx = h.indexOf('BON_ID');
      expect(bIdx).toBeGreaterThanOrEqual(0);
      expect(nIdx).toBeGreaterThanOrEqual(0);
      expect(uIdx).toBeGreaterThanOrEqual(0);

      const dataRows = ust.slice(1);
      expect(dataRows.length).toBeGreaterThan(0);
      for (const row of dataRows) {
        // The DB balance equation (netto + ust = brutto) must survive the export
        // verbatim, in integer cents, for EVERY line including the storno (signed).
        expect(cents(row[nIdx]!) + cents(row[uIdx]!)).toBe(cents(row[bIdx]!));
      }

      // §25c (key 5) line is genuinely exempt: brutto = netto, ust = 0.
      const goldLine = dataRows.find((r) => r[bonIdIdx] === rcpGold)!;
      expect(goldLine[keyIdx]).toBe('5');
      expect(cents(goldLine[uIdx]!)).toBe(0n);
      expect(cents(goldLine[nIdx]!)).toBe(cents(goldLine[bIdx]!));

      // §25a (key 7) margin line carries VAT-on-margin 9,90 — not 0, and not the
      // full-price 19 % VAT. This is the exact distinction the per-treatment
      // routing protects.
      const marLine = dataRows.find((r) => r[bonIdIdx] === rcpMargin)!;
      expect(marLine[keyIdx]).toBe('7');
      expect(cents(marLine[uIdx]!)).toBe(cents('9.90'));

      // Cross-check bon_pos_preise's own price columns also balance.
      const preise = parseCsv(fileMap.get('bon_pos_preise.csv') ?? '');
      const ph = preise[0]!;
      const pB = ph.indexOf('BRUTTO');
      const pN = ph.indexOf('NETTO');
      const pU = ph.indexOf('POS_UST');
      for (const row of preise.slice(1)) {
        expect(cents(row[pN]!) + cents(row[pU]!)).toBe(cents(row[pB]!));
      }
    });

    it('records the TSE signature fields for a signed receipt', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const files = readZip(res.rawPayload);
      const fileMap = new Map(files.map((f) => [f.name, f.content]));
      const tse = parseCsv(fileMap.get('tse.csv') ?? '');
      const h = tse[0]!;
      const bonIdx = h.indexOf('BON_ID');
      const sigIdx = h.indexOf('TSE_TA_SIG');
      const sigzIdx = h.indexOf('TSE_TA_SIGZ');
      const tseIdIdx = h.indexOf('TSE_ID');
      const algoIdx = h.indexOf('TSE_TA_SIGALGO');

      const stdTse = tse.slice(1).find((r) => r[bonIdx] === rcpStandard);
      expect(stdTse).toBeDefined();
      expect(stdTse![sigIdx]).toMatch(/^sig-/); // signature value present
      expect(BigInt(stdTse![sigzIdx]!)).toBeGreaterThan(0n); // counter > 0
      expect(stdTse![tseIdIdx]).toMatch(/^[0-9a-f-]{36}$/); // TSS uuid
      expect(stdTse![algoIdx]).toBe('ecdsa-plain-SHA256');
    });

    it('?encoding=base64 returns the same ZIP bytes, base64-encoded', async () => {
      const raw = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const b64 = await get(`/api/closings/${closingId}/export/dsfinvk?encoding=base64`);
      expect(b64.statusCode).toBe(200);
      expect(b64.headers['content-type']).toContain('text/plain');
      const decoded = Buffer.from(b64.payload, 'base64');
      expect(decoded.equals(raw.rawPayload)).toBe(true);
    });

    it('an EMPTY finalized day exports cleanly — 200, valid ZIP, no 500 (array-spread blast radius)', async () => {
      const res = await get(`/api/closings/${emptyClosingId}/export/dsfinvk`);
      expect(res.statusCode).toBe(200);
      const files = readZip(res.rawPayload);
      // All 9 files still present; the data sections are header-only.
      expect(files).toHaveLength(9);
      const bonKopf = parseCsv(
        new Map(files.map((f) => [f.name, f.content])).get('bon_kopf.csv') ?? '',
      );
      expect(bonKopf.length - 1).toBe(0); // zero receipts
    });

    it('the DATEV route ALSO survives an empty day (no array-spread 500)', async () => {
      const res = await get(`/api/closings/${emptyClosingId}/export/datev`);
      expect(res.statusCode).toBe(200);
      // Header + column row only — no booking lines.
      const lines = res.payload.split('\r\n').filter((l) => l.length > 0);
      expect(lines[0]!.startsWith('EXTF;700;21;Buchungsstapel;')).toBe(true);
    });
  });

  // ── POST /api/closings/finalize — the Z-Bon WRITER (the missing keystone) ──
  describe('POST /api/closings/finalize — Z-Bon writer', () => {
    const freshDay = '2026-05-07';
    const tsFresh = (h: number) => `${freshDay}T${String(h).padStart(2, '0')}:00:00+02:00`;

    async function seedFreshDay(): Promise<void> {
      // One VERKAUF (119,00 brutto cash, TSE-signed) on a clean day.
      const p = await seedProduct();
      await seedTransaction({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: tsFresh(9),
        items: [
          {
            productId: p,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '119.00' },
        tse: true,
      });
      // A CLOSED shift for the day: float 100 + 119 cash sale = 219 expected,
      // counted 219 → variance 0.
      await migratorSql`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status,
                            blind_count_eur, system_expected_eur, closed_by_user_id,
                            opened_at, closed_at)
        VALUES (${deviceId}, ${adminUserId}, '100.00', 'CLOSED'::shift_status,
                '219.00', '219.00', ${adminUserId},
                ${`${freshDay}T08:00:00+02:00`}::timestamptz,
                ${`${freshDay}T18:00:00+02:00`}::timestamptz)`;
    }

    function finalize(token: string, businessDay?: string) {
      return app.inject({
        method: 'POST',
        url: '/api/closings/finalize',
        headers: { cookie: `warehouse14.session=${token}`, 'content-type': 'application/json' },
        payload: businessDay ? { businessDay } : {},
      });
    }

    it('writes a correct FINALIZED Z-Bon, then the export chain reads it', async () => {
      await seedFreshDay();
      const res = await finalize(adminStepUpToken, freshDay);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe('FINALIZED');
      expect(body.businessDay).toBe(freshDay);
      expect(body.verkaufCount).toBe(1);
      expect(body.grossVerkaufEur).toBe('119.00');
      expect(body.netVerkaufEur).toBe('100.00');
      expect(body.cashExpectedEur).toBe('219.00');
      expect(body.cashCountedEur).toBe('219.00');
      expect(body.cashVarianceEur).toBe('0.00');

      // The row really landed + the Kassenbericht reads it (the whole point).
      const kb = await get(`/api/closings/${body.id}/export/kassenbericht`);
      expect(kb.statusCode).toBe(200);
      expect(kb.payload).toContain('119,00 EUR'); // Verkauf brutto
      expect(kb.payload).toContain('STANDARD_19'); // USt block

      // VAT + payments jsonb aggregated correctly.
      const [row] = await migratorSql<
        { vat_by_treatment: Record<string, string>; payments_by_method: Record<string, string> }[]
      >`SELECT vat_by_treatment, payments_by_method FROM daily_closings WHERE id = ${body.id}`;
      expect(row!.vat_by_treatment.STANDARD_19).toBe('19.00');
      expect(row!.payments_by_method.CASH).toBe('119.00');
    });

    it('refuses to re-finalize the same day (409)', async () => {
      await seedFreshDay();
      expect((await finalize(adminStepUpToken, freshDay)).statusCode).toBe(200);
      const again = await finalize(adminStepUpToken, freshDay);
      expect(again.statusCode).toBe(409);
    });

    it('requires a fresh PIN step-up (403 without)', async () => {
      const res = await finalize(adminNoStepUpToken, freshDay);
      expect(res.statusCode).toBe(403);
    });

    it('refuses a day with sales but no closed shift (409)', async () => {
      const p = await seedProduct();
      await seedTransaction({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: tsFresh(10),
        items: [
          {
            productId: p,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '119.00' },
        tse: true,
      });
      const res = await finalize(adminStepUpToken, freshDay);
      expect(res.statusCode).toBe(409); // no Kassensturz
    });
  });
});
