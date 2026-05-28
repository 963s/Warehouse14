/**
 * whatsapp/ — Meta Cloud API webhook idempotency + outbound log + triage.
 *
 *   • migration 0019 — inbound receiver (signature-verified store).
 *   • migration 0031 — outbound log (sent replies) + inbound triage cols
 *                      (handled_at / handled_by_user_id / linked_customer_id).
 */

import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, bigserial } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { users } from '../auth/index.js';
import { customers } from '../customers/index.js';

export const whatsappInboundMessages = pgTable(
  'whatsapp_inbound_messages',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    metaMessageId: text('meta_message_id').notNull(),
    fromPhone: text('from_phone').notNull(),
    messageType: text('message_type').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().default(sql`now()`),

    // ── Migration 0031: operator triage axes ────────────────────────────
    handledAt: timestamp('handled_at', { withTimezone: true }),
    handledByUserId: uuid('handled_by_user_id').references(() => users.id),
    linkedCustomerId: uuid('linked_customer_id').references(() => customers.id),
  },
  (table) => ({
    metaIdUq: uniqueIndex('whatsapp_inbound_meta_id_uq').on(table.metaMessageId),
    unprocessedIdx: index('whatsapp_inbound_unprocessed_idx')
      .on(table.receivedAt.desc())
      .where(sql`${table.processedAt} IS NULL`),
    unhandledIdx: index('whatsapp_inbound_unhandled_idx')
      .on(table.fromPhone, table.receivedAt.desc())
      .where(sql`${table.handledAt} IS NULL`),
    payloadObject: check(
      'whatsapp_inbound_payload_object',
      sql`jsonb_typeof(${table.rawPayload}) = 'object'`,
    ),
  }),
);

export type WhatsAppInboundMessage = typeof whatsappInboundMessages.$inferSelect;
export type NewWhatsAppInboundMessage = typeof whatsappInboundMessages.$inferInsert;

// ════════════════════════════════════════════════════════════════════════
// Outbound (migration 0031)
// ════════════════════════════════════════════════════════════════════════

/**
 * Allowed values for `whatsapp_outbound_messages.status`. The DB enforces
 * this via a TEXT CHECK so we don't pay the cost of a Postgres ENUM
 * (which would require a migration to extend).
 */
export const WHATSAPP_OUTBOUND_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export type WhatsAppOutboundStatus = (typeof WHATSAPP_OUTBOUND_STATUSES)[number];

export const whatsappOutboundMessages = pgTable(
  'whatsapp_outbound_messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    toPhone: text('to_phone').notNull(),
    body: text('body').notNull(),
    templateName: text('template_name'),
    templateParams: jsonb('template_params'),
    status: text('status').$type<WhatsAppOutboundStatus>().notNull(),
    providerMessageId: text('provider_message_id'),
    providerError: jsonb('provider_error'),
    sentByUserId: uuid('sent_by_user_id').references(() => users.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    threadIdx: index('whatsapp_outbound_thread_idx').on(table.toPhone, table.sentAt.desc()),
    bodyNonEmpty: check('whatsapp_outbound_body_nonempty', sql`length(${table.body}) > 0`),
    errorStatus: check(
      'whatsapp_outbound_error_status_check',
      sql`(${table.status} = 'failed' AND ${table.providerError} IS NOT NULL)
          OR (${table.status} <> 'failed')`,
    ),
  }),
);

export type WhatsAppOutboundMessage = typeof whatsappOutboundMessages.$inferSelect;
export type NewWhatsAppOutboundMessage = typeof whatsappOutboundMessages.$inferInsert;
