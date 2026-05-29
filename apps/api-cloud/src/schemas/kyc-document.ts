/**
 * TypeBox schemas for POST /api/customers/:id/kyc-documents — Day 12
 * (closes Phase 1.5 #I-47).
 *
 * The body carries everything the kyc_documents row needs:
 *   • document classification (type, issuing country, optional authority)
 *   • document number (plaintext on the wire — encrypted at rest via
 *     `encrypt_pii()` inside withPii)
 *   • validity window
 *   • R2 key + SHA-256 hex of the uploaded photo (client computed via
 *     `crypto.subtle.digest`)
 *   • optional retention years (default 5 — GwG-aligned, see ADR-0007)
 */

import { type Static, Type } from '@sinclair/typebox';

export const KycDocumentType = Type.Union(
  [
    Type.Literal('PERSONALAUSWEIS'),
    Type.Literal('REISEPASS'),
    Type.Literal('ID_CARD_EU'),
    Type.Literal('PASSPORT_EU'),
    Type.Literal('PASSPORT_NON_EU'),
  ],
  { description: 'Migration 0007 id_document_type enum (DE biased).' },
);

export const KycDocumentBody = Type.Object({
  documentType: KycDocumentType,
  issuingCountryIso2: Type.String({
    pattern: '^[A-Z]{2}$',
    description: 'ISO 3166-1 alpha-2, uppercase.',
  }),
  issuingAuthority: Type.Optional(Type.String({ maxLength: 256 })),
  documentNumber: Type.String({ minLength: 1, maxLength: 64 }),
  issuedOn: Type.Optional(Type.String({ format: 'date' })),
  expiresOn: Type.String({ format: 'date' }),
  /** R2 key returned by POST /api/photos/upload-url (intent='kyc'). */
  r2Key: Type.String({ minLength: 1, maxLength: 1024 }),
  /** 64-hex-char SHA-256 of the uploaded photo bytes (lowercase). */
  sha256Hex: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  retentionYears: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 5 })),
});
export type KycDocumentBody = Static<typeof KycDocumentBody>;

export const KycDocumentResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  customerId: Type.String({ format: 'uuid' }),
  documentType: KycDocumentType,
  capturedAt: Type.String({ format: 'date-time' }),
  expiresOn: Type.String({ format: 'date' }),
  retentionUntil: Type.String({ format: 'date' }),
});
export type KycDocumentResponse = Static<typeof KycDocumentResponse>;
