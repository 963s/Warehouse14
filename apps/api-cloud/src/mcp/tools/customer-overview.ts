/**
 * MCP tool: `customer_overview` — the Jarvis assistant's read-only answer to
 * "wie viele Kunden haben wir?".
 *
 * READ-ONLY and PII-FREE. This returns only aggregate COUNTS over the customers
 * table; it never decrypts a name, phone or address, so it needs no `withPii`
 * scope. The predicates mirror the verified customer queries (soft_deleted_at IS
 * NULL is the active-customer predicate used everywhere; trust_level
 * SUSPICIOUS/BANNED is the watchlist, same as situation_report). Individual
 * customer lookups stay in `find_customer`, which is the only tool that touches
 * personal data.
 *
 * CONTRACT
 * ────────
 * Input:  {}  (no arguments)
 * Output: {
 *   totalActive: number,          // not soft-deleted
 *   watchlist: number,            // SUSPICIOUS or BANNED
 *   kycVerified: number,          // kyc_status VERIFIED
 *   pepMatches: number,
 *   sanctionsMatches: number,
 *   asOf: string,                 // ISO timestamp
 * }
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const CustomerOverviewArgs = Type.Object({});

const handler: ToolHandler<Record<string, never>> = async (
  ctx: ToolInvocationContext,
): Promise<ToolResult> => {
  const rows = await ctx.db.execute<{
    total_active: number;
    watchlist: number;
    kyc_verified: number;
    pep_matches: number;
    sanctions_matches: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE soft_deleted_at IS NULL)::int                                        AS total_active,
      COUNT(*) FILTER (WHERE soft_deleted_at IS NULL AND trust_level IN ('SUSPICIOUS','BANNED'))::int AS watchlist,
      COUNT(*) FILTER (WHERE soft_deleted_at IS NULL AND kyc_status = 'VERIFIED')::int             AS kyc_verified,
      COUNT(*) FILTER (WHERE soft_deleted_at IS NULL AND pep_match)::int                           AS pep_matches,
      COUNT(*) FILTER (WHERE soft_deleted_at IS NULL AND sanctions_match)::int                     AS sanctions_matches
      FROM customers
  `);

  const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  const data = {
    totalActive: Number(r.total_active ?? 0),
    watchlist: Number(r.watchlist ?? 0),
    kycVerified: Number(r.kyc_verified ?? 0),
    pepMatches: Number(r.pep_matches ?? 0),
    sanctionsMatches: Number(r.sanctions_matches ?? 0),
    asOf: new Date().toISOString(),
  };

  const summary =
    `Kunden: ${data.totalActive} aktiv. ` +
    `KYC verifiziert: ${data.kycVerified}. ` +
    `Auf der Beobachtungsliste: ${data.watchlist}. ` +
    `PEP-Treffer: ${data.pepMatches}, Sanktions-Treffer: ${data.sanctionsMatches}.`;

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const customerOverviewTool: ToolRegistration = {
  manifest: {
    name: 'customer_overview',
    description:
      'READ-ONLY. Returns aggregate customer counts: total active customers, how many are ' +
      'KYC-verified, how many are on the watchlist (suspicious or banned), and PEP / sanctions ' +
      'match counts. No arguments and no personal data — only totals. Use this to answer "wie viele ' +
      'Kunden haben wir?". For one specific customer, use find_customer instead.',
    inputSchema: CustomerOverviewArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Aggregate customer counts only — no PII decrypted, no row-level data — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
