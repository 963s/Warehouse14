/**
 * Customer Management routes (Day 17).
 *
 *   POST   /api/customers                  — create with encrypted PII (withPii)
 *   GET    /api/customers/:id              — read with decrypted PII (ADMIN)
 *   GET    /api/customers/:id/products     — Ankauf history (products bought from this customer)
 *   GET    /api/customers/:id/transactions — sales history (latest 200)
 *
 * PII discipline (ADR-0022 §5 RED LINE):
 *   Every read/write of *_encrypted columns goes through `req.server.withPii(fn)`.
 *   The key is `set_config(..., true)` LOCAL to the transaction; commit/rollback
 *   clears it. Zero cross-request leakage.
 *
 * Auth:
 *   • POST  : ADMIN-only (Owner registers customers from Control Desktop)
 *   • GET   : ADMIN-only (decrypts PII)
 *   • GET history : ADMIN-only
 *
 * Audit:
 *   POST writes `customer.created` to audit_log (payload = customer_number + redacted PII fields).
 */

import { Type } from '@sinclair/typebox';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, products, transactions } from '@warehouse14/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { loadSmurfingThresholds } from '../lib/smurfing.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CreateCustomerBody,
  CreateCustomerResponse,
  CustomerDetailResponse,
  CustomerProductsResponse,
  CustomerTransactionsResponse,
  type CreateCustomerBody as TCreateCustomerBody,
} from '../schemas/customer.js';

class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const customersRoutes: FastifyPluginAsync = async (app) => {
  // ══════════════════════════════════════════════════════════════════════
  // POST /api/customers
  // ══════════════════════════════════════════════════════════════════════
  app.post<{ Body: TCreateCustomerBody }>(
    '/api/customers',
    {
      schema: {
        tags: ['customers'],
        summary: 'Register a customer (Owner-only). PII encrypted at rest.',
        description:
          'Wraps every PII write inside withPii() — the warehouse14.pii_key is ' +
          'bound to the transaction via set_config(..., true). Commit clears it. ' +
          'Sets retention_until = today + retentionYears (default 5y). ' +
          'customer_number defaults via DB sequence.',
        body: CreateCustomerBody,
        response: {
          200: CreateCustomerResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;
      const years = body.retentionYears ?? 5;

      const inserted = await app.withPii(async (tx) => {
        // Build the encrypted INSERT in raw SQL to use encrypt_pii() + blind_index()
        // helpers from migration 0007 — Drizzle doesn't model these.
        const rows = await tx.execute<{
          id: string;
          customer_number: string;
          created_at: Date;
        }>(sql`
        INSERT INTO customers (
          full_name_encrypted,
          date_of_birth_encrypted,
          email_encrypted,
          phone_encrypted,
          address_encrypted,
          notes_encrypted,
          email_blind_index,
          phone_blind_index,
          preferred_language,
          customer_tags,
          retention_until,
          vat_id
        )
        VALUES (
          encrypt_pii(${body.fullName}),
          ${body.dateOfBirth != null ? sql`encrypt_pii(${body.dateOfBirth})` : sql`NULL`},
          ${body.email != null ? sql`encrypt_pii(${body.email})` : sql`NULL`},
          ${body.phone != null ? sql`encrypt_pii(${body.phone})` : sql`NULL`},
          ${body.address != null ? sql`encrypt_pii(${body.address})` : sql`NULL`},
          ${body.notes != null ? sql`encrypt_pii(${body.notes})` : sql`NULL`},
          ${body.email != null ? sql`blind_index(${body.email})` : sql`NULL`},
          ${body.phone != null ? sql`blind_index(${body.phone})` : sql`NULL`},
          ${body.preferredLanguage ?? 'de'},
          ${
            (body.customerTags ?? []).length > 0
              ? sql`ARRAY[${sql.join(
                  (body.customerTags ?? []).map((t) => sql`${t}`),
                  sql`, `,
                )}]::text[]`
              : sql`ARRAY[]::text[]`
          },
          (now() + (${years} || ' years')::interval)::date,
          ${body.vatId ?? null}
        )
        RETURNING id, customer_number, created_at
      `);
        const row = rows[0];
        if (!row) throw new Error('customer INSERT returned no row');

        // Audit log — never log the plaintext PII; log only redacted shape.
        await tx.insert(auditLog).values({
          eventType: 'customer.created',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            customerId: row.id,
            customerNumber: row.customer_number,
            fieldsSet: {
              fullName: true,
              dateOfBirth: body.dateOfBirth != null,
              email: body.email != null,
              phone: body.phone != null,
              address: body.address != null,
              notes: body.notes != null,
              vatId: body.vatId != null,
            },
            preferredLanguage: body.preferredLanguage ?? 'de',
            retentionYears: years,
          },
        });

        return row;
      });

      return reply.status(200).send({
        id: inserted.id,
        customerNumber: inserted.customer_number,
        // postgres-js returns RETURNING timestamps as strings on raw execute,
        // so normalise via Date (was `.toISOString()` on a string → 500).
        createdAt: new Date(inserted.created_at as string | Date).toISOString(),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // GET /api/customers/:id
  // ══════════════════════════════════════════════════════════════════════
  app.get<{ Params: { id: string }; Querystring: { includeDeleted?: boolean } }>(
    '/api/customers/:id',
    {
      schema: {
        tags: ['customers'],
        summary: 'Customer detail with decrypted PII (ADMIN-only).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({ includeDeleted: Type.Optional(Type.Boolean()) }),
        response: {
          200: CustomerDetailResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id } = req.params;
      // Ein Grabstein wird nur auf ausdrückliche Anfrage gezeigt. Sonst bleibt
      // eine gelöschte Zeile unauffindbar, wie bisher.
      const includeDeleted = req.query.includeDeleted === true;

      const row = await app.withPii(async (tx) => {
        const rows = await tx.execute<{
          id: string;
          customer_number: string;
          full_name: string;
          date_of_birth: string | null;
          email: string | null;
          phone: string | null;
          address: string | null;
          notes: string | null;
          vat_id: string | null;
          preferred_language: 'de' | 'en' | 'ar';
          customer_tags: string[];
          kyc_status: string;
          kyc_completed_at: Date | null;
          kyc_verified_at: Date | null;
          trust_level: string;
          sanctions_match: boolean;
          pep_match: boolean;
          cumulative_spend_eur: string;
          cumulative_ankauf_eur: string;
          cumulative_debt_eur: string;
          retention_until: string;
          created_at: Date;
          soft_deleted_at: Date | null;
          erasure_initiated_by: string | null;
        }>(sql`
        SELECT
          id,
          customer_number,
          decrypt_pii(full_name_encrypted)            AS full_name,
          ${sql`decrypt_pii(date_of_birth_encrypted)`} AS date_of_birth,
          ${sql`decrypt_pii(email_encrypted)`}        AS email,
          ${sql`decrypt_pii(phone_encrypted)`}        AS phone,
          ${sql`decrypt_pii(address_encrypted)`}      AS address,
          ${sql`decrypt_pii(notes_encrypted)`}        AS notes,
          vat_id,
          preferred_language,
          customer_tags,
          kyc_status::text                            AS kyc_status,
          kyc_completed_at,
          kyc_verified_at,
          trust_level::text                           AS trust_level,
          sanctions_match,
          pep_match,
          cumulative_spend_eur,
          cumulative_ankauf_eur,
          cumulative_debt_eur,
          retention_until::text                       AS retention_until,
          created_at,
          soft_deleted_at,
          erasure_initiated_by
        FROM customers
        WHERE id = ${id}
          ${includeDeleted ? sql`` : sql`AND soft_deleted_at IS NULL`}
        LIMIT 1
      `);
        return rows[0] ?? null;
      });

      if (!row) {
        throw new CustomerNotFoundError(`Customer ${id} not found.`);
      }

      // §10 GwG rolling-window ANKAUF aggregate (prior finalized buys only — the
      // cart being built now is not yet a transaction). The POS KYC gate adds the
      // current cart and requires ID when the running window crosses the line.
      const thresholds = await loadSmurfingThresholds(app.db);
      const aggRows = await app.db.execute<{ prior: string }>(sql`
        SELECT COALESCE(SUM(total_eur), 0)::numeric(18,2)::text AS prior
          FROM transactions
         WHERE customer_id = ${id}::uuid
           AND direction = 'ANKAUF'
           AND storno_of_transaction_id IS NULL
           AND finalized_at >= now() - (${thresholds.windowDays} || ' days')::interval`);
      const priorAnkaufEur = aggRows[0]?.prior ?? '0.00';

      // Registration method — derived from the linked storefront `shoppers` row
      // (1:1 with customers). A Google sign-in stamps `google_sub`; an e-mail
      // sign-up stamps `password_hash`; no shopper row at all means the customer
      // was created at the counter. This is how a Google/online customer is
      // recognised in the cashier's customer file.
      const shopperRows = await app.db.execute<{
        google_sub: string | null;
        has_password: boolean;
      }>(sql`
        SELECT google_sub, (password_hash IS NOT NULL) AS has_password
          FROM shoppers
         WHERE customer_id = ${id}::uuid AND soft_deleted_at IS NULL
         LIMIT 1`);
      const shopper = shopperRows[0] ?? null;
      const registrationMethod: 'GOOGLE' | 'EMAIL' | 'IN_STORE' = shopper
        ? shopper.google_sub
          ? 'GOOGLE'
          : 'EMAIL'
        : 'IN_STORE';

      return reply.status(200).send({
        id: row.id,
        customerNumber: row.customer_number,
        fullName: row.full_name,
        dateOfBirth: row.date_of_birth,
        email: row.email,
        phone: row.phone,
        address: row.address,
        notes: row.notes,
        vatId: row.vat_id,
        preferredLanguage: row.preferred_language,
        customerTags: row.customer_tags,
        kycStatus: row.kyc_status as
          | 'NOT_REQUIRED'
          | 'PENDING'
          | 'CAPTURED'
          | 'VERIFIED'
          | 'EXPIRED'
          | 'REJECTED',
        kycCompletedAt: row.kyc_completed_at ? new Date(row.kyc_completed_at).toISOString() : null,
        kycVerifiedAt: row.kyc_verified_at ? new Date(row.kyc_verified_at).toISOString() : null,
        trustLevel: row.trust_level as 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED',
        sanctionsMatch: row.sanctions_match,
        pepMatch: row.pep_match,
        cumulativeSpendEur: row.cumulative_spend_eur,
        cumulativeAnkaufEur: row.cumulative_ankauf_eur,
        cumulativeDebtEur: row.cumulative_debt_eur,
        gwgRollingAnkauf: { windowDays: thresholds.windowDays, priorAnkaufEur },
        retentionUntil: row.retention_until,
        createdAt: new Date(row.created_at).toISOString(),
        registration: { method: registrationMethod, online: shopper !== null },
        deletedAt: row.soft_deleted_at ? new Date(row.soft_deleted_at).toISOString() : null,
        // Roh durchgereicht, aber nur die beiden bekannten Werte: ein
        // unbekannter Wert wird zu null statt als Kürzel in die Oberfläche zu
        // lecken. Die CHECK-Bedingung aus 0103 lässt nichts anderes zu; diese
        // Zeile ist der Gürtel zum Hosenträger.
        erasureInitiatedBy:
          row.erasure_initiated_by === 'CUSTOMER' || row.erasure_initiated_by === 'STAFF'
            ? row.erasure_initiated_by
            : null,
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // GET /api/customers/:id/products — Ankauf history
  // ══════════════════════════════════════════════════════════════════════
  app.get<{ Params: { id: string } }>(
    '/api/customers/:id/products',
    {
      schema: {
        tags: ['customers'],
        summary: 'Products acquired from this customer (Ankauf history).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: CustomerProductsResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id } = req.params;
      const rows = await app.db
        .select({
          id: products.id,
          sku: products.sku,
          status: products.status,
          name: products.name,
          acquisitionCostEur: products.acquisitionCostEur,
          listPriceEur: products.listPriceEur,
          createdAt: products.createdAt,
          soldAt: products.soldAt,
        })
        .from(products)
        .where(eq(products.acquiredFromCustomerId, id))
        .orderBy(desc(products.createdAt))
        .limit(500);

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          sku: r.sku,
          status: r.status,
          name: r.name,
          acquisitionCostEur: r.acquisitionCostEur,
          listPriceEur: r.listPriceEur,
          createdAt: r.createdAt.toISOString(),
          soldAt: r.soldAt ? r.soldAt.toISOString() : null,
        })),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // GET /api/customers/:id/transactions — sales history
  // ══════════════════════════════════════════════════════════════════════
  app.get<{ Params: { id: string } }>(
    '/api/customers/:id/transactions',
    {
      schema: {
        tags: ['customers'],
        summary: 'Sales + Ankauf transactions for this customer (latest 200).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: CustomerTransactionsResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id } = req.params;
      const rows = await app.db
        .select({
          id: transactions.id,
          direction: transactions.direction,
          totalEur: transactions.totalEur,
          taxTreatmentCode: transactions.taxTreatmentCode,
          receiptLocator: transactions.receiptLocator,
          salesChannel: transactions.salesChannel,
          finalizedAt: transactions.finalizedAt,
          stornoOfTransactionId: transactions.stornoOfTransactionId,
        })
        .from(transactions)
        .where(eq(transactions.customerId, id))
        .orderBy(desc(transactions.finalizedAt))
        .limit(200);

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          direction: r.direction,
          totalEur: r.totalEur,
          taxTreatmentCode: r.taxTreatmentCode,
          receiptLocator: r.receiptLocator,
          salesChannel: r.salesChannel,
          finalizedAt: r.finalizedAt.toISOString(),
          stornoOfTransactionId: r.stornoOfTransactionId,
        })),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // GET /api/customers/:id/orders — the customer's WEB orders (staff view)
  // ══════════════════════════════════════════════════════════════════════
  // Owner directive 2026-07-20: the owner/cashier apps must show a customer's
  // full shop history — reservation number, status, items, totals — not only
  // POS transactions. Mirrors the shopper-side /api/storefront/orders slice
  // (carts RESERVED/CONVERTED/CANCELLED via the customer's shoppers), with
  // line items aggregated in the same query. Read-only; no PII decrypt needed
  // (names on cart items are product names).
  app.get<{ Params: { id: string } }>(
    '/api/customers/:id/orders',
    {
      schema: {
        tags: ['customers'],
        summary: "The customer's web-shop orders with items (staff view).",
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: Type.Object({
            items: Type.Array(
              Type.Object({
                id: Type.String(),
                /** BST-2026-000001 — what the customer reads off their letter. */
                orderNumber: Type.Union([Type.String(), Type.Null()]),
                status: Type.String(),
                createdAt: Type.String(),
                expiresAt: Type.Union([Type.String(), Type.Null()]),
                /**
                 * Contact, so the cashier can actually reach the person whose
                 * pickup deadline is running out. Without it the counter can
                 * see a lapsing reservation and do nothing about it.
                 */
                contactName: Type.Union([Type.String(), Type.Null()]),
                contactPhone: Type.Union([Type.String(), Type.Null()]),
                contactEmail: Type.Union([Type.String(), Type.Null()]),
                itemCount: Type.Integer(),
                totalEur: Type.String(),
                lines: Type.Array(
                  Type.Object({
                    productId: Type.Union([Type.String(), Type.Null()]),
                    name: Type.String(),
                    sku: Type.Union([Type.String(), Type.Null()]),
                    quantity: Type.Integer(),
                    unitPriceEur: Type.String(),
                  }),
                ),
              }),
            ),
          }),
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const rows = await app.withPii(async (tx) => tx.execute<{
        id: string;
        order_number: string | null;
        status: string;
        created_at: string;
        expires_at: string | null;
        contact_name: string | null;
        contact_phone: string | null;
        contact_email: string | null;
        item_count: number;
        total_eur: string;
        lines: unknown;
      }>(sql`
        SELECT c.id,
               c.order_number,
               c.status::text AS status,
               to_char(COALESCE(c.reserved_at, c.created_at) AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
               (SELECT to_char(MAX(pr.reservation_expires_at) AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                  FROM products pr
                 WHERE pr.reserved_by_session_id = c.reservation_session_id) AS expires_at,
               decrypt_pii(cu.full_name_encrypted) AS contact_name,
               decrypt_pii(cu.phone_encrypted)     AS contact_phone,
               decrypt_pii(cu.email_encrypted)     AS contact_email,
               COUNT(ci.id)::int AS item_count,
               COALESCE(SUM(ci.unit_price_eur * ci.quantity), 0)::text AS total_eur,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'productId', ci.product_id,
                     'name', p.name,
                     'sku', p.sku,
                     'quantity', ci.quantity,
                     'unitPriceEur', ci.unit_price_eur::text
                   ) ORDER BY ci.added_at
                 ) FILTER (WHERE ci.id IS NOT NULL),
                 '[]'::json
               ) AS lines
          FROM carts c
          JOIN shoppers s ON s.id = c.shopper_id
          JOIN customers cu ON cu.id = s.customer_id
          LEFT JOIN cart_items ci ON ci.cart_id = c.id
          LEFT JOIN products p ON p.id = ci.product_id
         WHERE s.customer_id = ${req.params.id}
           AND c.status IN ('RESERVED', 'CONVERTED', 'CANCELLED')
         GROUP BY c.id, c.order_number, c.reserved_at, c.created_at,
                  c.reservation_session_id, c.status,
                  cu.full_name_encrypted, cu.phone_encrypted, cu.email_encrypted
         ORDER BY COALESCE(c.reserved_at, c.created_at) DESC
         LIMIT 50`));

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          orderNumber: r.order_number,
          status: r.status,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          contactName: r.contact_name,
          contactPhone: r.contact_phone,
          contactEmail: r.contact_email,
          itemCount: r.item_count,
          totalEur: r.total_eur,
          lines: (typeof r.lines === 'string' ? JSON.parse(r.lines) : r.lines) as {
            productId: string | null;
            name: string;
            sku: string | null;
            quantity: number;
            unitPriceEur: string;
          }[],
        })),
      });
    },
  );
};

export default customersRoutes;
