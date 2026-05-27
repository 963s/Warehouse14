/**
 * whatsapp/ — Meta Cloud API webhook idempotency (Day 21, migration 0019).
 */

import { bigserial, boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  },
  (table) => ({
    metaIdUq: uniqueIndex('whatsapp_inbound_meta_id_uq').on(table.metaMessageId),
    unprocessedIdx: index('whatsapp_inbound_unprocessed_idx')
      .on(table.receivedAt.desc())
      .where(sql`${table.processedAt} IS NULL`),
    payloadObject: check(
      'whatsapp_inbound_payload_object',
      sql`jsonb_typeof(${table.rawPayload}) = 'object'`,
    ),
  }),
);

export type WhatsAppInboundMessage = typeof whatsappInboundMessages.$inferSelect;
export type NewWhatsAppInboundMessage = typeof whatsappInboundMessages.$inferInsert;
