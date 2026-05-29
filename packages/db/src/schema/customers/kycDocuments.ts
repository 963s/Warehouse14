/**
 * kyc_documents — ID-document evidence for GwG / §259 StGB defense.
 *
 * Each row is a piece of *legal evidence* that we did good-faith due diligence
 * before an Ankauf. The encrypted document number + the SHA-256-hashed photo
 * stored in R2 together prove "this customer presented this ID at this terminal
 * at this time, captured by this user."
 *
 * Discipline:
 *   • NEVER deleted by app role.
 *   • App can only UPDATE the verification chain + AI OCR result + retention.
 *   • The document itself (number, photo, type, validity range) is INSERT-once.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { devices } from '../auth/devices.js';
import { users } from '../auth/users.js';
import { customers } from './customers.js';
import { idDocumentType } from './enums.js';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const kycDocuments = pgTable(
  'kyc_documents',
  {
    id: primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),

    documentType: idDocumentType('document_type').notNull(),
    issuingCountryIso2: char('issuing_country_iso2', { length: 2 }).notNull(),
    issuingAuthority: text('issuing_authority'),

    // Nullable since migration 0041 — NULLed when the document is purged
    // (GDPR #I-5). The purge-consistency CHECK keeps these in lock-step with
    // `purged_at` / `purged_by_user_id`.
    documentNumberEncrypted: bytea('document_number_encrypted'),

    issuedOn: date('issued_on'),
    expiresOn: date('expires_on').notNull(),

    documentPhotoR2Key: text('document_photo_r2_key'),
    documentPhotoSha256: bytea('document_photo_sha256'),

    capturedByUserId: uuid('captured_by_user_id')
      .notNull()
      .references(() => users.id),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    capturedAtTerminalId: uuid('captured_at_terminal_id').references(() => devices.id),

    aiOcrUsed: boolean('ai_ocr_used').notNull().default(false),
    aiOcrConfidence: numeric('ai_ocr_confidence', { precision: 3, scale: 2 }),

    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),

    retentionUntil: date('retention_until').notNull(),

    // GDPR #I-5 purge evidence. Set together when a row becomes a shell.
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    purgedByUserId: uuid('purged_by_user_id').references(() => users.id),

    ...timestamps(),
  },
  (table) => ({
    customerIdIdx: index('kyc_documents_customer_id_idx').on(table.customerId),
    expiresOnIdx: index('kyc_documents_expires_on_idx').on(table.expiresOn),
    retentionIdx: index('kyc_documents_retention_idx').on(table.retentionUntil),
    unverifiedIdx: index('kyc_documents_unverified_idx')
      .on(table.createdAt.desc())
      .where(sql`${table.verifiedAt} IS NULL`),

    issuingCountryFormat: check(
      'kyc_documents_issuing_country_format',
      sql`${table.issuingCountryIso2} ~ '^[A-Z]{2}$'`,
    ),
    validityRange: check(
      'kyc_documents_validity_range',
      sql`${table.issuedOn} IS NULL OR ${table.expiresOn} > ${table.issuedOn}`,
    ),
    sha256Length: check(
      'kyc_documents_sha256_length',
      sql`octet_length(${table.documentPhotoSha256}) = 32`,
    ),
    confidenceRange: check(
      'kyc_documents_confidence_range',
      sql`${table.aiOcrConfidence} IS NULL OR (${table.aiOcrConfidence} >= 0 AND ${table.aiOcrConfidence} <= 1)`,
    ),
    verifiedHasVerifier: check(
      'kyc_documents_verified_has_verifier',
      sql`(${table.verifiedAt} IS NULL) = (${table.verifiedByUserId} IS NULL)`,
    ),
    // GDPR #I-5 — a row is either LIVE (PII present, not purged) or a purged
    // SHELL (PII nulled, purge stamped). No in-between state is valid.
    purgedConsistency: check(
      'kyc_documents_purged_consistency',
      sql`(
        ${table.purgedAt} IS NULL
          AND ${table.documentNumberEncrypted} IS NOT NULL
          AND ${table.documentPhotoSha256} IS NOT NULL
          AND ${table.documentPhotoR2Key} IS NOT NULL
          AND ${table.purgedByUserId} IS NULL
      ) OR (
        ${table.purgedAt} IS NOT NULL
          AND ${table.documentNumberEncrypted} IS NULL
          AND ${table.documentPhotoSha256} IS NULL
          AND ${table.documentPhotoR2Key} IS NULL
          AND ${table.purgedByUserId} IS NOT NULL
      )`,
    ),
  }),
);

export type KycDocument = typeof kycDocuments.$inferSelect;
export type NewKycDocument = typeof kycDocuments.$inferInsert;
