/**
 * tse_signatures — durable, append-only server-side record of the Fiskaly
 * SIGN DE V2 signature produced per fiscal transaction (GoBD / BSI TR-03153).
 *
 * One row per `transactions` row (UNIQUE FK). The POS POSTs the signature it
 * received from the local TSE bridge immediately after a successful
 * finalize+FINISH, via POST /api/transactions/:id/tse-signature.
 *
 * Discipline:
 *   • App role: INSERT + SELECT only — NO UPDATE, NO DELETE.
 *   • A BEFORE UPDATE/DELETE trigger hard-refuses mutation (immutable evidence).
 *   • INSERT emits a `tse.signature_recorded` ledger event (the hash chain
 *     extends to cover the signature evidence).
 *
 * See migration 0054_tse_signature_persistence.sql. This is distinct from
 * `tse_transactions` (the Fiskaly state-machine / offline-queue table,
 * migration 0010): this table is the narrow, immutable fiscal-record of the
 * signature value as printed on the customer's receipt.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { transactions } from '../transactions/transactions.js';

export const tseSignatures = pgTable(
  'tse_signatures',
  {
    id: primaryKey(),

    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),

    fiskalyTssId: uuid('fiskaly_tss_id').notNull(),
    fiskalyClientId: uuid('fiskaly_client_id').notNull(),
    fiskalyTransactionId: uuid('fiskaly_transaction_id'),
    fiskalyTransactionNumber: bigint('fiskaly_transaction_number', { mode: 'bigint' }).notNull(),

    signatureValue: text('signature_value').notNull(),
    signatureCounter: bigint('signature_counter', { mode: 'bigint' }).notNull(),
    signatureAlgorithm: text('signature_algorithm'),

    processType: text('process_type').notNull().default('Kassenbeleg-V1'),
    qrCodeData: text('qr_code_data'),

    tseStartTime: timestamp('tse_start_time', { withTimezone: true }),
    tseEndTime: timestamp('tse_end_time', { withTimezone: true }),

    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    deviceId: uuid('device_id'),
    recordedByUserId: uuid('recorded_by_user_id'),

    ...timestamps(),
  },
  (table) => ({
    transactionIdUq: uniqueIndex('tse_signatures_unique_per_transaction').on(table.transactionId),

    signatureCounterUq: uniqueIndex('tse_signatures_signature_counter_uq').on(
      table.fiskalyTssId,
      table.signatureCounter,
    ),
    txNumberUq: uniqueIndex('tse_signatures_tx_number_uq').on(
      table.fiskalyTssId,
      table.fiskalyTransactionNumber,
    ),
    fiskalyTxUq: uniqueIndex('tse_signatures_fiskaly_tx_uq')
      .on(table.fiskalyTransactionId)
      .where(sql`${table.fiskalyTransactionId} IS NOT NULL`),
    recordedBusinessDayIdx: index('tse_signatures_recorded_business_day_idx').on(
      sql`berlin_business_day(${table.recordedAt})`,
    ),

    counterPositive: check('tse_signatures_counter_positive', sql`${table.signatureCounter} > 0`),
    txNumberPositive: check(
      'tse_signatures_tx_number_positive',
      sql`${table.fiskalyTransactionNumber} > 0`,
    ),
    timeOrder: check(
      'tse_signatures_time_order',
      sql`${table.tseStartTime} IS NULL OR ${table.tseEndTime} IS NULL OR ${table.tseEndTime} >= ${table.tseStartTime}`,
    ),
  }),
);

export type TseSignature = typeof tseSignatures.$inferSelect;
export type NewTseSignature = typeof tseSignatures.$inferInsert;
