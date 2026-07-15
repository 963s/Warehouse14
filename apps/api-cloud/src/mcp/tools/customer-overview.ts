/**
 * MCP tool: `customer_overview` — the Jarvis assistant's read-only snapshot of
 * the whole customer base.
 *
 * READ-ONLY and PII-FREE. Returns only aggregate COUNTS and SUMS over the
 * customers table; it never decrypts a name, phone or address, so it needs no
 * `withPii` scope. Answers "wie viele Kunden haben wir?" and "wie sieht unser
 * Kundenstamm aus?": total active customers, breakdown by trust level, how many
 * are buyers (spend > 0) vs sellers (buy-in > 0), how many are KYC-verified, the
 * watchlist / PEP / sanctions counts, and the total cumulative spend and buy-in
 * across the base. For a specific customer use find_customer; for a ranking of
 * the best buyers use top_customers.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';
import { TRUST_LEVEL_DE, eurDE, labelDe } from './labels-de.js';

export const CustomerOverviewArgs = Type.Object({});

interface TrustRow {
  trustLevel: string;
  count: number;
}
type Row = {
  total_active: number;
  by_trust: TrustRow[];
  buyers: number;
  sellers: number;
  kyc_verified: number;
  watchlist: number;
  pep_matches: number;
  sanctions_matches: number;
  total_spend: string;
  total_ankauf: string;
}

const ALL_TRUST_LEVELS = ['NEW', 'VERIFIED', 'VIP', 'SUSPICIOUS', 'BANNED'] as const;

const handler: ToolHandler<Record<string, never>> = async (
  ctx: ToolInvocationContext,
): Promise<ToolResult> => {
  const result = await ctx.db.execute<Row>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM customers WHERE soft_deleted_at IS NULL) AS total_active,
      (SELECT COALESCE(
                json_agg(json_build_object('trustLevel', trust_level, 'count', n) ORDER BY trust_level),
                '[]'::json)
         FROM (SELECT trust_level::text AS trust_level, COUNT(*)::int AS n
                 FROM customers WHERE soft_deleted_at IS NULL
                GROUP BY trust_level) s)                                                        AS by_trust,
      (SELECT COUNT(*)::int FROM customers WHERE soft_deleted_at IS NULL AND cumulative_spend_eur > 0)  AS buyers,
      (SELECT COUNT(*)::int FROM customers WHERE soft_deleted_at IS NULL AND cumulative_ankauf_eur > 0) AS sellers,
      (SELECT COUNT(*)::int FROM customers WHERE soft_deleted_at IS NULL AND kyc_status = 'VERIFIED')   AS kyc_verified,
      (SELECT COUNT(*)::int FROM customers WHERE soft_deleted_at IS NULL AND trust_level IN ('SUSPICIOUS','BANNED')) AS watchlist,
      (SELECT COUNT(*)::int FROM customers WHERE soft_deleted_at IS NULL AND pep_match)              AS pep_matches,
      (SELECT COUNT(*)::int FROM customers WHERE soft_deleted_at IS NULL AND sanctions_match)        AS sanctions_matches,
      (SELECT COALESCE(SUM(cumulative_spend_eur),0)::text  FROM customers WHERE soft_deleted_at IS NULL) AS total_spend,
      (SELECT COALESCE(SUM(cumulative_ankauf_eur),0)::text FROM customers WHERE soft_deleted_at IS NULL) AS total_ankauf
  `);

  const rows = result as unknown as Row[];
  const r = rows[0] ?? ({} as Partial<Row>);

  // Default every trust level to 0 so the spoken breakdown always names all five.
  const trustCounts: Record<string, number> = {};
  for (const lvl of ALL_TRUST_LEVELS) trustCounts[lvl] = 0;
  for (const t of (r.by_trust as TrustRow[]) ?? []) trustCounts[t.trustLevel] = Number(t.count ?? 0);
  const byTrust = ALL_TRUST_LEVELS.map((lvl) => ({
    trustLevel: lvl,
    trustLevelDe: labelDe(TRUST_LEVEL_DE, lvl),
    count: trustCounts[lvl] ?? 0,
  }));

  const data = {
    totalActive: Number(r.total_active ?? 0),
    byTrust,
    buyers: Number(r.buyers ?? 0),
    sellers: Number(r.sellers ?? 0),
    kycVerified: Number(r.kyc_verified ?? 0),
    watchlist: Number(r.watchlist ?? 0),
    pepMatches: Number(r.pep_matches ?? 0),
    sanctionsMatches: Number(r.sanctions_matches ?? 0),
    totalSpendEur: String(r.total_spend ?? '0'),
    totalAnkaufEur: String(r.total_ankauf ?? '0'),
    asOf: new Date().toISOString(),
  };

  const trustPhrase = byTrust.map((t) => `${t.count} ${t.trustLevelDe}`).join(', ');
  const summary =
    `Ihr Kundenstamm umfasst ${data.totalActive} aktive Kunden. ` +
    `Davon ${data.buyers} mit Umsatz und ${data.sellers} mit Ankauf. ` +
    `Nach Vertrauensstufe: ${trustPhrase}. ` +
    `KYC verifiziert: ${data.kycVerified}. Auf der Beobachtungsliste: ${data.watchlist}. ` +
    `PEP-Treffer: ${data.pepMatches}, Sanktions-Treffer: ${data.sanctionsMatches}. ` +
    `Gesamtumsatz ${eurDE(data.totalSpendEur)} EUR, Gesamtankauf ${eurDE(data.totalAnkaufEur)} EUR.`;

  return { content: [{ type: 'text', text: summary }], data };
};

export const customerOverviewTool: ToolRegistration = {
  manifest: {
    name: 'customer_overview',
    description:
      'READ-ONLY, PII-FREE. Aggregate snapshot of the customer base: total active customers, ' +
      'breakdown by trust level, how many are buyers vs sellers, KYC-verified count, watchlist and ' +
      'PEP / sanctions counts, and the total cumulative spend and buy-in in EUR. No arguments, no ' +
      'personal data. Use for "wie viele Kunden haben wir?" and "wie sieht unser Kundenstamm aus?". ' +
      'For one specific customer use find_customer; for the best buyers use top_customers.',
    inputSchema: CustomerOverviewArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Aggregate customer counts + sums only — no PII decrypted, no row-level data — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
