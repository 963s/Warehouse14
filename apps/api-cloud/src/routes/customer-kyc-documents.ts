/**
 * POST /api/customers/:id/kyc-documents — Day 12 additive.
 *
 * Closes Phase 1.5 #I-47. Creates a kyc_documents row binding a customer
 * to:
 *   • a document type + issuing country + optional authority
 *   • an encrypted document number (PII RED LINE — encrypt_pii inside withPii)
 *   • an R2-uploaded photo (key + SHA-256 integrity hash)
 *   • the capturing actor + terminal + timestamp
 *
 * Step-up REQUIRED — identity-recording write is owner-sensitive.
 *
 * The actual photo bytes live in R2; the row carries the key + 32-byte
 * SHA-256 so any tampering with the R2 object is detectable post-hoc.
 *
 * Audit_log carries a REDACTED payload (document type + country + r2 key
 * + sha256 + retention years) — never the plaintext document number.
 */

import { Type } from '@sinclair/typebox';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, customers, kycDocuments } from '@warehouse14/db/schema';

import { DomainError, type ApiErrorCode } from '../plugins/error-handler.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import {
  KycDocumentBody,
  KycDocumentResponse,
  type KycDocumentBody as TBody,
} from '../schemas/kyc-document.js';

class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class KycValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: { field: string; reason: string };
  public constructor(field: string, reason: string) {
    super(`KYC document validation failed for "${field}": ${reason}`);
    this.details = { field, reason };
  }
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const customerKycDocumentsRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: TBody }>(
    '/api/customers/:id/kyc-documents',
    {
      schema: {
        tags: ['customers'],
        summary: 'Bind an R2-uploaded ID-document photo to a customer (Day 12, #I-47).',
        description:
          'Creates a kyc_documents row with encrypted document number + R2 key + ' +
          'SHA-256 integrity hash. ADMIN-only + step-up REQUIRED. The photo must ' +
          'already be uploaded to R2 via POST /api/photos/upload-url.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: KycDocumentBody,
        response: {
          200: KycDocumentResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const { id: customerId } = req.params;
      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;
      const retentionYears = body.retentionYears ?? 5;

      // Validity-range CHECK is duplicated by DB constraint; client-friendly
      // error message lands here.
      if (body.issuedOn && body.issuedOn >= body.expiresOn) {
        throw new KycValidationError('expiresOn', 'expires_on must be strictly after issued_on');
      }

      const outcome = await app.withPii(async (tx) => {
        // 1. Customer must exist (FK would refuse anyway; explicit 404 is nicer).
        const [exists] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, customerId))
          .limit(1);
        if (!exists) {
          throw new CustomerNotFoundError(`Customer ${customerId} not found.`);
        }

        // 2. Convert 64-hex sha256 to BYTEA literal — Drizzle doesn't model
        //    pgcrypto BYTEA from a hex string cleanly so we use raw SQL.
        const inserted = await tx.execute<{
          id: string;
          captured_at: Date;
          retention_until: string;
        }>(sql`
          INSERT INTO kyc_documents (
            customer_id,
            document_type,
            issuing_country_iso2,
            issuing_authority,
            document_number_encrypted,
            issued_on,
            expires_on,
            document_photo_r2_key,
            document_photo_sha256,
            captured_by_user_id,
            captured_at_terminal_id,
            retention_until
          )
          VALUES (
            ${customerId},
            ${body.documentType}::id_document_type,
            ${body.issuingCountryIso2},
            ${body.issuingAuthority ?? null},
            encrypt_pii(${body.documentNumber}),
            ${body.issuedOn ?? null}::date,
            ${body.expiresOn}::date,
            ${body.r2Key},
            decode(${body.sha256Hex}, 'hex'),
            ${actorId},
            ${deviceId},
            (now() + (${retentionYears} || ' years')::interval)::date
          )
          RETURNING id, captured_at, retention_until::text AS retention_until
        `);
        const row = inserted[0];
        if (!row) throw new Error('kyc_documents INSERT returned no row');

        // 3. Audit log — REDACTED. Never the plaintext document number.
        await tx.insert(auditLog).values({
          eventType: 'customer.kyc_document_added',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            customerId,
            kycDocumentId: row.id,
            documentType: body.documentType,
            issuingCountryIso2: body.issuingCountryIso2,
            r2Key: body.r2Key,
            sha256Hex: body.sha256Hex,
            issuedOn: body.issuedOn ?? null,
            expiresOn: body.expiresOn,
            retentionYears,
          },
        });

        // 4. Touch the customer's kyc_completed_at so the catalog list
        //    surfaces the change. The Owner still has to explicitly stamp
        //    kyc_verified_at via PATCH /kyc — that gate is operator-set
        //    confirmation, not just "we have a photo".
        await tx
          .update(customers)
          .set({ kycCompletedAt: new Date() })
          .where(eq(customers.id, customerId));

        return {
          id: row.id,
          capturedAt: row.captured_at,
          retentionUntil: row.retention_until,
        };
      });

      // Silence the unused-import warning — kycDocuments helps reviewers find
      // the table being modified by the raw SQL.
      void kycDocuments;

      return reply.status(200).send({
        id: outcome.id,
        customerId,
        documentType: body.documentType,
        capturedAt: outcome.capturedAt.toISOString(),
        expiresOn: body.expiresOn,
        retentionUntil: outcome.retentionUntil,
      });
    },
  );
};

export default customerKycDocumentsRoute;
