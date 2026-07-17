/**
 * GET /api/customers — paged customer search (Day 8, additive post-Freeze).
 *
 * Strategy:
 *   • If `q` looks like an email (contains @) → exact lookup via
 *     `email_blind_index = blind_index(q)`. Sub-millisecond, no decrypt.
 *   • Else if `q` looks like a phone (`/^[+\d\s().\-]{5,}$/`) → exact lookup
 *     via `phone_blind_index = blind_index(q)`, OR a partial match on the
 *     plaintext `customer_number` (so a typed-out Kundennummer like `000006`
 *     resolves instead of silently dead-ending on the phone blind index).
 *   • Else → fuzzy ILIKE on decrypted `full_name`, OR a partial match on
 *     `customer_number` (so `CUST-2026-000006`, `CUST`, or `2026` resolve).
 *     The decrypt happens INSIDE `withPii` so the per-request key binding is
 *     honoured. For V1 catalog size (<10k customers) sub-100 ms p95.
 *
 * `customer_number` is a plaintext, uniquely-indexed, non-PII column, so an
 * ILIKE on it is cheap and safe — and it is the identity the Owner-app shows as
 * each customer's subtitle, so search MUST honour it (Name ODER Nummer).
 *
 * Whichever strategy matches, the result rows still get full-name decrypted
 * so the operator UI can show "John Smith — ku-001023 — KYC ✓".
 *
 * Auth: ADMIN + CASHIER. Customers are read all day during retail operations,
 * so CASHIER is sufficient — the row carries no plaintext PII beyond the
 * full_name which is needed for visual confirmation at the counter.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  CustomerListQuery,
  CustomerListResponse,
  type CustomerListQuery as TCustomerListQuery,
} from '../schemas/customer-list.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const EMAIL_HINT = /@/;
const PHONE_HINT = /^[+\d\s().\-]{5,}$/;

const customersListRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TCustomerListQuery }>(
    '/api/customers',
    {
      schema: {
        tags: ['customers'],
        summary: 'Paged customer search by name / Kundennummer / email / phone (Day 8).',
        description:
          'Powers Ankauf customer-lookup + the Owner-app global search. Indexed blind-index ' +
          'match for email + phone, ILIKE on the plaintext customer_number, decrypted ILIKE ' +
          'fallback for name. Returns minimal projection — no DOB, no address.',
        querystring: CustomerListQuery,
        response: {
          200: CustomerListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const q = req.query.q?.trim() ?? '';
      const limit = req.query.limit ?? 20;
      const offset = req.query.offset ?? 0;
      const kycVerifiedOnly = req.query.kycVerifiedOnly === true;
      const excludeBlocked = req.query.excludeBlocked === true;

      const result = await app.withPii(async (tx) => {
        // Partial, case-insensitive match on the plaintext Kundennummer — the
        // identity the Owner-app renders as each customer's subtitle. ESCAPEd so
        // a typed `%`/`_` is a literal, not a wildcard.
        const numberLike = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const customerNumberClause = sql`customer_number ILIKE ${numberLike} ESCAPE '\\'`;

        // Build the strategy SQL. The single query covers all cases via a CTE so
        // the count + page come from the same plan.
        const matchClause: ReturnType<typeof sql> =
          q.length === 0
            ? sql`TRUE`
            : EMAIL_HINT.test(q)
              ? // An `@` can never be a Kundennummer → email blind index only.
                sql`email_blind_index = blind_index(${q})`
              : PHONE_HINT.test(q)
                ? // A purely-numeric query is BOTH a possible phone AND a typed-out
                  // Kundennummer (e.g. `000006`); try both so it never dead-ends.
                  sql`(phone_blind_index = blind_index(${q}) OR ${customerNumberClause})`
                : // Name fallback, OR the Kundennummer itself (`CUST-2026-000006`,
                  // `CUST`, `2026`) — honouring the UI's "Name oder Nummer".
                  sql`(decrypt_pii(full_name_encrypted) ILIKE ${'%' + q + '%'} OR ${customerNumberClause})`;

        const kycClause = kycVerifiedOnly ? sql`AND kyc_verified_at IS NOT NULL` : sql``;
        const blockedClause = excludeBlocked
          ? sql`AND sanctions_match = FALSE AND trust_level <> 'BANNED'`
          : sql``;

        const rows = await tx.execute<{
          id: string;
          customer_number: string;
          full_name: string;
          kyc_status: string;
          kyc_verified_at: Date | null;
          trust_level: string;
          sanctions_match: boolean;
          pep_match: boolean;
          cumulative_ankauf_eur: string;
          cumulative_spend_eur: string;
          created_at: Date;
          last_order_at: Date | null;
          total_count: number;
        }>(sql`
        WITH matched AS (
          SELECT
            id,
            customer_number,
            decrypt_pii(full_name_encrypted) AS full_name,
            kyc_status::text                 AS kyc_status,
            kyc_verified_at,
            trust_level::text                AS trust_level,
            sanctions_match,
            pep_match,
            cumulative_ankauf_eur,
            cumulative_spend_eur,
            created_at,
            -- Last fiscal activity (any direction) — index-backed by
            -- transactions_customer_idx (customer_id, finalized_at DESC).
            (SELECT MAX(t.finalized_at) FROM transactions t WHERE t.customer_id = customers.id)
                                             AS last_order_at,
            COUNT(*) OVER ()                 AS total_count
          FROM customers
          WHERE soft_deleted_at IS NULL
            AND ${matchClause}
            ${kycClause}
            ${blockedClause}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        )
        SELECT * FROM matched
      `);

        const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
        return {
          rows,
          total,
        };
      });

      return reply.status(200).send({
        items: result.rows.map((r) => ({
          id: r.id,
          customerNumber: r.customer_number,
          fullName: r.full_name,
          kycStatus: r.kyc_status as
            | 'NOT_REQUIRED'
            | 'PENDING'
            | 'CAPTURED'
            | 'VERIFIED'
            | 'EXPIRED'
            | 'REJECTED',
          kycVerifiedAt: r.kyc_verified_at ? new Date(r.kyc_verified_at).toISOString() : null,
          trustLevel: r.trust_level as 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED',
          sanctionsMatch: r.sanctions_match,
          pepMatch: r.pep_match,
          cumulativeAnkaufEur: r.cumulative_ankauf_eur,
          cumulativeSpendEur: r.cumulative_spend_eur,
          createdAt: new Date(r.created_at).toISOString(),
          lastOrderAt: r.last_order_at ? new Date(r.last_order_at).toISOString() : null,
        })),
        total: result.total,
        limit,
        offset,
        hasMore: offset + result.rows.length < result.total,
      });
    },
  );
};

export default customersListRoute;
