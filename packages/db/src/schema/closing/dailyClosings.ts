/**
 * daily_closings — the Z-report per Berlin business day.
 *
 * Immutable once FINALIZED (Basel Day-9 directive). The BEFORE UPDATE trigger
 * locks every numeric, count, anchor, and finalization marker — only `notes`
 * remains editable after.
 *
 * Carries the daily checkpoint anchor (ADR-0008 §Known limits #2):
 * `ledgerAnchorId` + `ledgerAnchorHash` snapshot the chain head at close so
 * verify_ledger_chain() above this point can be skipped on future audits.
 */

import { bigint, check, customType, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { ledgerEvents } from '../audit/ledgerEvents.js';
import { users } from '../auth/users.js';
import { closingState } from './enums.js';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const dailyClosings = pgTable(
  'daily_closings',
  {
    id: primaryKey(),
    shopId: uuid('shop_id'),
    businessDay: date('business_day').notNull(),

    state: closingState('state').notNull().default('COUNTING'),

    verkaufCount: integer('verkauf_count').notNull().default(0),
    ankaufCount: integer('ankauf_count').notNull().default(0),
    stornoCount: integer('storno_count').notNull().default(0),

    grossVerkaufEur: numeric('gross_verkauf_eur', { precision: 18, scale: 2 }).notNull().default('0'),
    grossAnkaufEur: numeric('gross_ankauf_eur', { precision: 18, scale: 2 }).notNull().default('0'),
    netVerkaufEur: numeric('net_verkauf_eur', { precision: 18, scale: 2 }).notNull().default('0'),
    netAnkaufEur: numeric('net_ankauf_eur', { precision: 18, scale: 2 }).notNull().default('0'),

    vatByTreatment: jsonb('vat_by_treatment').notNull().default(sql`'{}'::jsonb`),
    paymentsByMethod: jsonb('payments_by_method').notNull().default(sql`'{}'::jsonb`),

    cashDrawerExpectedEur: numeric('cash_drawer_expected_eur', { precision: 18, scale: 2 }),
    cashDrawerCountedEur: numeric('cash_drawer_counted_eur', { precision: 18, scale: 2 }),
    cashDrawerVarianceEur: numeric('cash_drawer_variance_eur', { precision: 18, scale: 2 }),

    tseFinishedCount: integer('tse_finished_count').notNull().default(0),
    tsePendingCount: integer('tse_pending_count').notNull().default(0),
    tseFailedCount: integer('tse_failed_count').notNull().default(0),

    ledgerAnchorId: bigint('ledger_anchor_id', { mode: 'bigint' }).references(() => ledgerEvents.id),
    ledgerAnchorHash: bytea('ledger_anchor_hash'),

    countedByUserId: uuid('counted_by_user_id').references(() => users.id),
    countedAt: timestamp('counted_at', { withTimezone: true }),
    finalizedByUserId: uuid('finalized_by_user_id').references(() => users.id),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    notes: text('notes'),

    ...timestamps(),
  },
  table => ({
    businessDayShopUq: uniqueIndex('daily_closings_business_day_shop_uq').on(table.businessDay, table.shopId),
    stateIdx: index('daily_closings_state_idx').on(table.state, table.businessDay.desc()),
    businessDayIdx: index('daily_closings_business_day_idx').on(table.businessDay.desc()),
    finalizedIdx: index('daily_closings_finalized_idx')
      .on(table.finalizedAt.desc())
      .where(sql`${table.state} = 'FINALIZED'`),

    finalizedHasEvidence: check(
      'daily_closings_finalized_has_evidence',
      sql`${table.state} <> 'FINALIZED' OR (
        ${table.finalizedByUserId}     IS NOT NULL AND
        ${table.finalizedAt}           IS NOT NULL AND
        ${table.countedByUserId}       IS NOT NULL AND
        ${table.countedAt}             IS NOT NULL AND
        ${table.cashDrawerCountedEur}  IS NOT NULL AND
        ${table.cashDrawerExpectedEur} IS NOT NULL AND
        ${table.cashDrawerVarianceEur} IS NOT NULL AND
        ${table.ledgerAnchorId}        IS NOT NULL AND
        ${table.ledgerAnchorHash}      IS NOT NULL AND
        octet_length(${table.ledgerAnchorHash}) = 32
      )`,
    ),
    varianceMath: check(
      'daily_closings_variance_math',
      sql`${table.cashDrawerVarianceEur} IS NULL OR (
        ${table.cashDrawerCountedEur}  IS NOT NULL AND
        ${table.cashDrawerExpectedEur} IS NOT NULL AND
        ${table.cashDrawerVarianceEur} = ${table.cashDrawerCountedEur} - ${table.cashDrawerExpectedEur}
      )`,
    ),
    countsNonNegative: check(
      'daily_closings_counts_non_negative',
      sql`${table.verkaufCount} >= 0 AND ${table.ankaufCount} >= 0 AND ${table.stornoCount} >= 0
          AND ${table.tseFinishedCount} >= 0 AND ${table.tsePendingCount} >= 0 AND ${table.tseFailedCount} >= 0`,
    ),
    vatObject: check('daily_closings_vat_object', sql`jsonb_typeof(${table.vatByTreatment}) = 'object'`),
    paymentsObject: check('daily_closings_payments_object', sql`jsonb_typeof(${table.paymentsByMethod}) = 'object'`),
    grossNonNegative: check(
      'daily_closings_gross_non_negative',
      sql`${table.grossVerkaufEur} >= 0 AND ${table.grossAnkaufEur} >= 0`,
    ),
  }),
);

export type DailyClosing = typeof dailyClosings.$inferSelect;
export type NewDailyClosing = typeof dailyClosings.$inferInsert;
