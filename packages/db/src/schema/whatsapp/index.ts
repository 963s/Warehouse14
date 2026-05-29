/**
 * whatsapp/ — Meta Cloud API webhook idempotency + outbound log + triage.
 *
 *   • migration 0019 — inbound receiver (signature-verified store).
 *   • migration 0031 — outbound log (sent replies) + inbound triage cols
 *                      (handled_at / handled_by_user_id / linked_customer_id).
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/index.js';
import { customers } from '../customers/index.js';

/** Postgres `bytea` — pgcrypto ciphertext (encrypt_pii / decrypt_pii). */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const whatsappInboundMessages = pgTable(
  'whatsapp_inbound_messages',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    metaMessageId: text('meta_message_id').notNull(),
    fromPhone: text('from_phone').notNull(),
    messageType: text('message_type').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    /** Epic E: pgcrypto-encrypted message body at rest (nullable until backfilled). */
    bodyEncrypted: bytea('body_encrypted'),
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
export const WHATSAPP_OUTBOUND_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export type WhatsAppOutboundStatus = (typeof WHATSAPP_OUTBOUND_STATUSES)[number];

export const whatsappOutboundMessages = pgTable(
  'whatsapp_outbound_messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    toPhone: text('to_phone').notNull(),
    body: text('body').notNull(),
    /** Epic E: pgcrypto-encrypted body at rest (nullable until backfilled). */
    bodyEncrypted: bytea('body_encrypted'),
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

// ════════════════════════════════════════════════════════════════════════
// Conversations + AI cost ledger (Epic E, migration 0036)
// ════════════════════════════════════════════════════════════════════════

/**
 * One row per WhatsApp phone — the bot on/off switch + human-takeover cooldown.
 * `ai_active=false` + `cooldown_until` in the future means a cashier replied
 * and the bot stays quiet; once `cooldown_until` lapses the orchestrator
 * re-enables it. GDPR: 5-year retention, `anonymized_at` stamped on erasure.
 */
export const whatsappConversations = pgTable(
  'whatsapp_conversations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    customerPhoneE164: text('customer_phone_e164').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    aiActive: boolean('ai_active').notNull().default(true),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    retentionUntil: timestamp('retention_until', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '5 years'`),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    phoneUq: uniqueIndex('whatsapp_conversations_phone_uq').on(table.customerPhoneE164),
    cooldownIdx: index('whatsapp_conversations_cooldown_idx').on(
      table.aiActive,
      table.cooldownUntil,
    ),
  }),
);

export type WhatsAppConversation = typeof whatsappConversations.$inferSelect;
export type NewWhatsAppConversation = typeof whatsappConversations.$inferInsert;

/** Allowed `ai_calls.kind` values (mirror of the SQL CHECK). */
export const AI_CALL_KINDS = ['classify', 'compose', 'tool'] as const;
export type AiCallKind = (typeof AI_CALL_KINDS)[number];

/** One row per Claude call — cost tracking + per-conversation daily budget. */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    conversationId: uuid('conversation_id').references(() => whatsappConversations.id),
    kind: text('kind').$type<AiCallKind>().notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costEur: numeric('cost_eur', { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    conversationDayIdx: index('ai_calls_conversation_day_idx').on(
      table.conversationId,
      table.createdAt.desc(),
    ),
    knownKind: check('ai_calls_kind_check', sql`${table.kind} IN ('classify','compose','tool')`),
  }),
);

export type AiCall = typeof aiCalls.$inferSelect;
export type NewAiCall = typeof aiCalls.$inferInsert;
