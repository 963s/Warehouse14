/**
 * email_outbox — transactional mail queue (migration 0088).
 *
 * Composed at the moment of the business event (welcome, reservation
 * confirmation, cancellation notice) and delivered by the worker's SMTP job
 * when the SMTP env is configured. Recipient is PII → encrypted bytea like
 * every other address in this schema; the worker decrypts inside withPii at
 * send time only.
 */

import { sql } from 'drizzle-orm';
import { char, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { customers } from '../customers/customers.js';
import { bytea } from './shoppers.js';

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    recipientEncrypted: bytea('recipient_encrypted').notNull(),
    template: text('template').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    status: text('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Which of the thirteen languages this letter was rendered in (0092). */
    locale: char('locale', { length: 2 }).notNull().default('de'),
    /**
     * Who the letter is about (0096). Nullable, and null means erasure can
     * never withdraw it — every row written before 0096 is in exactly that
     * state, which is how an erased customer got mail on 2026-07-22.
     */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  },
  (table) => ({
    pendingIdx: index('email_outbox_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'PENDING'`),
    customerIdx: index('email_outbox_customer_idx')
      .on(table.customerId)
      .where(sql`${table.customerId} IS NOT NULL`),
    statusDomain: check(
      'email_outbox_status_domain',
      sql`${table.status} IN ('PENDING', 'SENT', 'FAILED')`,
    ),
    attemptsNonneg: check('email_outbox_attempts_nonneg', sql`${table.attempts} >= 0`),
    sentHasTimestamp: check(
      'email_outbox_sent_has_timestamp',
      sql`${table.status} <> 'SENT' OR ${table.sentAt} IS NOT NULL`,
    ),
  }),
);

export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
export type NewEmailOutboxRow = typeof emailOutbox.$inferInsert;
