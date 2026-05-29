/**
 * intake/ — AI Intake Pipeline staging tables (ADR-0015, migration 0037).
 *
 *   • staffPhoneNumbers — E.164 identity layer (phone IS the identity).
 *   • intakeSessions    — RECEIVED→…→PUBLISHED/REJECTED state machine.
 *   • intakeMessages    — inbound/outbound WhatsApp log (wamid = idempotency).
 *   • intakeDrafts      — AI outputs + deterministic enrichment + overrides.
 *
 * NEVER deleted — terminal status via UPDATE, full audit trail preserved.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { vector } from '../_shared/columnTypes.js';
import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from '../auth/index.js';
import { products } from '../products/index.js';
import { taxTreatmentCodes } from '../reference/index.js';

export const INTAKE_STATUSES = [
  'RECEIVED',
  'GROUPED',
  'PROCESSING',
  'ENRICHED',
  'READY_FOR_REVIEW',
  'PUBLISHED',
  'REJECTED',
  'NEEDS_MORE_INFO',
  'FAILED',
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const intakeStatus = pgEnum('intake_status', INTAKE_STATUSES);

export const STAFF_PHONE_ROLES = ['INTAKE_FIELD_BUYER', 'INTAKE_IN_SHOP', 'BOTH'] as const;
export type StaffPhoneRole = (typeof STAFF_PHONE_ROLES)[number];

export const STAFF_LANGUAGES = ['de', 'en', 'ar'] as const;
export type StaffLanguage = (typeof STAFF_LANGUAGES)[number];

export const staffPhoneNumbers = pgTable(
  'staff_phone_numbers',
  {
    id: primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    phoneE164: text('phone_e164').notNull(),
    role: text('role').$type<StaffPhoneRole>().notNull(),
    preferredLanguage: char('preferred_language', { length: 2 })
      .$type<StaffLanguage>()
      .notNull()
      .default('de'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    phoneUq: uniqueIndex('staff_phone_numbers_phone_uq').on(table.phoneE164),
    activeIdx: index('idx_staff_phone_active')
      .on(table.phoneE164)
      .where(sql`${table.active} = TRUE`),
    roleCheck: check(
      'staff_phone_role_check',
      sql`${table.role} IN ('INTAKE_FIELD_BUYER','INTAKE_IN_SHOP','BOTH')`,
    ),
    langCheck: check('staff_phone_lang_check', sql`${table.preferredLanguage} IN ('de','en','ar')`),
  }),
);

export type StaffPhoneNumber = typeof staffPhoneNumbers.$inferSelect;
export type NewStaffPhoneNumber = typeof staffPhoneNumbers.$inferInsert;

export const intakeSessions = pgTable(
  'intake_sessions',
  {
    id: primaryKey(),
    staffPhoneId: uuid('staff_phone_id')
      .notNull()
      .references(() => staffPhoneNumbers.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
    groupingClosesAt: timestamp('grouping_closes_at', { withTimezone: true }).notNull(),
    status: intakeStatus('status').notNull().default('RECEIVED'),
    productId: uuid('product_id').references(() => products.id),
    rejectedReason: text('rejected_reason'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processingCompletedAt: timestamp('processing_completed_at', { withTimezone: true }),
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id),
    reviewerDecidedAt: timestamp('reviewer_decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    statusIdx: index('idx_intake_sessions_status').on(table.status),
    groupingIdx: index('idx_intake_sessions_grouping')
      .on(table.groupingClosesAt)
      .where(sql`${table.status} = 'RECEIVED'`),
    phoneIdx: index('idx_intake_sessions_phone').on(table.staffPhoneId, table.startedAt.desc()),
  }),
);

export type IntakeSession = typeof intakeSessions.$inferSelect;
export type NewIntakeSession = typeof intakeSessions.$inferInsert;

export const INTAKE_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type IntakeMessageDirection = (typeof INTAKE_MESSAGE_DIRECTIONS)[number];

export const intakeMessages = pgTable(
  'intake_messages',
  {
    id: primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => intakeSessions.id),
    whatsappMessageId: text('whatsapp_message_id').notNull(),
    direction: text('direction').$type<IntakeMessageDirection>().notNull(),
    messageType: text('message_type').notNull(),
    mediaR2Key: text('media_r2_key'),
    textBody: text('text_body'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    wamidUq: uniqueIndex('intake_messages_wamid_uq').on(table.whatsappMessageId),
    sessionIdx: index('idx_intake_messages_session').on(table.sessionId, table.receivedAt),
    directionCheck: check(
      'intake_messages_direction_check',
      sql`${table.direction} IN ('inbound','outbound')`,
    ),
  }),
);

export type IntakeMessage = typeof intakeMessages.$inferSelect;
export type NewIntakeMessage = typeof intakeMessages.$inferInsert;

const embedding1536 = vector(1536);

export const intakeDrafts = pgTable(
  'intake_drafts',
  {
    id: primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => intakeSessions.id),

    bgRemovedPhotoKeys: text('bg_removed_photo_keys').array(),
    visionClassification: jsonb('vision_classification'),
    visionHallmarkDetection: jsonb('vision_hallmark_detection'),
    visionScaleReading: jsonb('vision_scale_reading'),

    lbmaPriceSnapshotEurPerG: numeric('lbma_price_snapshot_eur_per_g', { precision: 15, scale: 4 }),
    taxTreatmentCode: text('tax_treatment_code').references(() => taxTreatmentCodes.code),
    classifierExplanation: text('classifier_explanation'),
    suggestedAcquisitionEur: numeric('suggested_acquisition_eur', { precision: 18, scale: 2 }),
    suggestedSaleEur: numeric('suggested_sale_eur', { precision: 18, scale: 2 }),

    germanDescription: text('german_description'),
    marketingAngles: jsonb('marketing_angles'),
    embedding: embedding1536('embedding'),

    finalData: jsonb('final_data'),

    pipelineErrors: jsonb('pipeline_errors'),
    ...timestamps(),
  },
  (table) => ({
    sessionUq: uniqueIndex('intake_drafts_session_uq').on(table.sessionId),
  }),
);

export type IntakeDraft = typeof intakeDrafts.$inferSelect;
export type NewIntakeDraft = typeof intakeDrafts.$inferInsert;
