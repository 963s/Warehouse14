/**
 * PUT /api/customers/:id — Day 10 additive.
 *
 * Updates PII fields of an existing customer. Step-up is ENFORCED when
 * `customer.kyc_verified_at IS NOT NULL` — once the Owner has physically
 * inspected a customer's ID, rewriting their PII could mask a sanctions
 * match or alter the audit chain. A fresh PIN-confirmed session is
 * required for that case; first-time edits on un-verified customers
 * proceed without step-up.
 *
 * Every accepted field is encrypted via `encrypt_pii(...)` inside the
 * `withPii(tx)` envelope — same RED-LINE discipline as POST. The route
 * computes the diff against the existing row at the field-NAME level
 * only and writes `customer.updated` to `audit_log` with that redacted
 * payload. Plaintext PII NEVER lands in audit_log.
 *
 * Auth: ADMIN-only (Owner action). Day-10 UI gates this behind the
 * detail-panel "Bearbeiten" CTA.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@warehouse14/db/schema';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  type UpdateCustomerBody as TBody,
  UpdateCustomerBody,
  UpdateCustomerResponse,
} from '../schemas/customer.js';

class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class NothingToUpdateError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details = {
    reason: 'no changes detected — body had no diff against current row',
  };
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const customerUpdateRoute: FastifyPluginAsync = async (app) => {
  app.put<{ Params: { id: string }; Body: TBody }>(
    '/api/customers/:id',
    {
      schema: {
        tags: ['customers'],
        summary: 'Update customer PII fields (ADMIN). Step-up when kyc_verified.',
        description:
          'Wraps every PII write inside withPii() — same RED-LINE envelope as POST. ' +
          'Step-up required when customers.kyc_verified_at IS NOT NULL (the Owner ' +
          'has previously stamped this customer; PII rewrites could mask sanctions ' +
          'matches or rewrite audit). Audit_log carries field-name diff only — ' +
          'never plaintext PII.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: UpdateCustomerBody,
        response: {
          200: UpdateCustomerResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id } = req.params;
      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // Gate the step-up check inside withPii — we need the existing row
      // to know if kyc_verified_at is set. The whole thing runs in one
      // DB transaction so the row state at gate-check matches the state
      // at UPDATE time (no TOCTOU window).
      const outcome = await app.withPii(async (tx) => {
        const rows = await tx.execute<{
          id: string;
          kyc_verified_at: Date | null;
          full_name: string | null;
          date_of_birth: string | null;
          email: string | null;
          phone: string | null;
          address: string | null;
          notes: string | null;
          vat_id: string | null;
          preferred_language: 'de' | 'en' | 'ar';
          customer_tags: string[];
        }>(sql`
          SELECT
            id,
            kyc_verified_at,
            ${sql`decrypt_pii(full_name_encrypted)`}     AS full_name,
            ${sql`decrypt_pii(date_of_birth_encrypted)`} AS date_of_birth,
            ${sql`decrypt_pii(email_encrypted)`}         AS email,
            ${sql`decrypt_pii(phone_encrypted)`}         AS phone,
            ${sql`decrypt_pii(address_encrypted)`}       AS address,
            ${sql`decrypt_pii(notes_encrypted)`}         AS notes,
            vat_id,
            preferred_language,
            customer_tags
          FROM customers
          WHERE id = ${id}
            AND soft_deleted_at IS NULL
          FOR UPDATE
          LIMIT 1
        `);
        const before = rows[0];
        if (!before) throw new CustomerNotFoundError(`Customer ${id} not found.`);

        const stepUpEnforced = before.kyc_verified_at !== null;
        if (stepUpEnforced) {
          // Throws STEP_UP_REQUIRED if the session is not fresh enough.
          requireStepUp(req);
        }

        // Compute the field-name diff. Null in the body means "clear this
        // column" (encrypted column → NULL). Undefined means "leave alone".
        const changedFields: string[] = [];
        const setFragments: Array<ReturnType<typeof sql>> = [];

        if (body.fullName !== undefined && body.fullName !== before.full_name) {
          changedFields.push('fullName');
          setFragments.push(sql`full_name_encrypted = encrypt_pii(${body.fullName})`);
        }
        if (body.dateOfBirth !== undefined && body.dateOfBirth !== before.date_of_birth) {
          changedFields.push('dateOfBirth');
          if (body.dateOfBirth === null) {
            setFragments.push(sql`date_of_birth_encrypted = NULL`);
          } else {
            setFragments.push(sql`date_of_birth_encrypted = encrypt_pii(${body.dateOfBirth})`);
          }
        }
        if (body.email !== undefined && body.email !== before.email) {
          changedFields.push('email');
          if (body.email === null) {
            setFragments.push(sql`email_encrypted = NULL, email_blind_index = NULL`);
          } else {
            setFragments.push(
              sql`email_encrypted = encrypt_pii(${body.email}), email_blind_index = blind_index(${body.email})`,
            );
          }
        }
        if (body.phone !== undefined && body.phone !== before.phone) {
          changedFields.push('phone');
          if (body.phone === null) {
            setFragments.push(sql`phone_encrypted = NULL, phone_blind_index = NULL`);
          } else {
            setFragments.push(
              sql`phone_encrypted = encrypt_pii(${body.phone}), phone_blind_index = blind_index(${body.phone})`,
            );
          }
        }
        if (body.address !== undefined && body.address !== before.address) {
          changedFields.push('address');
          if (body.address === null) {
            setFragments.push(sql`address_encrypted = NULL`);
          } else {
            setFragments.push(sql`address_encrypted = encrypt_pii(${body.address})`);
          }
        }
        if (body.notes !== undefined && body.notes !== before.notes) {
          changedFields.push('notes');
          if (body.notes === null) {
            setFragments.push(sql`notes_encrypted = NULL`);
          } else {
            setFragments.push(sql`notes_encrypted = encrypt_pii(${body.notes})`);
          }
        }
        if (body.vatId !== undefined && body.vatId !== before.vat_id) {
          changedFields.push('vatId');
          if (body.vatId === null) {
            setFragments.push(sql`vat_id = NULL`);
          } else {
            setFragments.push(sql`vat_id = ${body.vatId}`);
          }
        }
        if (
          body.preferredLanguage !== undefined &&
          body.preferredLanguage !== before.preferred_language
        ) {
          changedFields.push('preferredLanguage');
          setFragments.push(sql`preferred_language = ${body.preferredLanguage}`);
        }
        if (
          body.customerTags !== undefined &&
          !arraysEqual(body.customerTags, before.customer_tags)
        ) {
          changedFields.push('customerTags');
          setFragments.push(sql`customer_tags = ${body.customerTags}::text[]`);
        }

        if (changedFields.length === 0) {
          throw new NothingToUpdateError('No diff between body and current customer row.');
        }

        // Apply the UPDATE. The unique partial indexes on email_blind_index
        // and phone_blind_index will throw 23505 if the new value collides
        // with another active customer — the error-handler maps that to
        // 409 CONFLICT.
        await tx.execute(sql`
          UPDATE customers
          SET ${sql.join(setFragments, sql`, `)}
          WHERE id = ${id}
        `);

        // Audit log — field NAMES only, never plaintext PII values.
        await tx.insert(auditLog).values({
          eventType: 'customer.updated',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            customerId: id,
            changedFields,
            stepUpEnforced,
          },
        });

        return { changedFields, stepUpEnforced };
      });

      return reply.status(200).send({
        id,
        changedFields: outcome.changedFields,
        stepUpEnforced: outcome.stepUpEnforced,
      });
    },
  );
};

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

export default customerUpdateRoute;
