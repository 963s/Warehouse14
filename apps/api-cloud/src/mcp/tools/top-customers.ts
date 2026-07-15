/**
 * MCP tool: `top_customers` — the Jarvis assistant's read-only ranking of the
 * best customers.
 *
 * READ-ONLY and PII-FREE. Ranks active customers by cumulative sales revenue
 * (cumulative_spend_eur) descending and returns the top 10 by customer_number
 * (a non-PII business key, CUST-YYYY-NNNNNN) with their spend, buy-in total, and
 * trust level. No name is ever decrypted — reading a top spender's real name
 * aloud in a shop is a privacy/commercial leak, so identity stays behind the
 * ADMIN-gated find_customer tool, which the owner can call with the number.
 * Only real buyers (cumulative_spend_eur > 0) are listed, so the answer is
 * meaningful rather than an arbitrary zero-spend list.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';
import { TRUST_LEVEL_DE, eurDE, labelDe } from './labels-de.js';

export const TopCustomersArgs = Type.Object({});

type Row = {
  customer_number: string;
  cumulative_spend_eur: string;
  cumulative_ankauf_eur: string;
  trust_level: string;
  total_with_revenue: number;
}

const handler: ToolHandler<Record<string, never>> = async (
  ctx: ToolInvocationContext,
): Promise<ToolResult> => {
  const result = await ctx.db.execute<Row>(sql`
    SELECT
      customer_number,
      cumulative_spend_eur::text  AS cumulative_spend_eur,
      cumulative_ankauf_eur::text AS cumulative_ankauf_eur,
      trust_level::text           AS trust_level,
      COUNT(*) OVER ()::int       AS total_with_revenue
    FROM customers
    WHERE soft_deleted_at IS NULL
      AND cumulative_spend_eur > 0
    ORDER BY cumulative_spend_eur DESC, customer_number ASC
    LIMIT 10
  `);

  const rows = result as unknown as Row[];
  const customers = rows.map((r, i) => ({
    rank: i + 1,
    customerNumber: r.customer_number,
    cumulativeSpendEur: String(r.cumulative_spend_eur ?? '0'),
    cumulativeAnkaufEur: String(r.cumulative_ankauf_eur ?? '0'),
    trustLevel: r.trust_level,
    trustLevelDe: labelDe(TRUST_LEVEL_DE, r.trust_level),
  }));

  // The real number of revenue customers (window count, evaluated before LIMIT),
  // so the spoken "Insgesamt" is honest even when more than 10 customers exist.
  const totalWithRevenue = Number(rows[0]?.total_with_revenue ?? customers.length);
  const data = {
    count: customers.length,
    totalWithRevenue,
    customers,
    asOf: new Date().toISOString(),
  };

  let summary: string;
  if (customers.length === 0) {
    summary =
      'Es sind noch keine Umsätze bei aktiven Kunden erfasst, daher gibt es aktuell keine ' +
      'Rangliste der besten Kunden.';
  } else {
    const top = customers
      .slice(0, 3)
      .map(
        (c) =>
          `Platz ${c.rank}, Kundennummer ${c.customerNumber}, ${eurDE(c.cumulativeSpendEur)} EUR Umsatz` +
          (c.trustLevelDe ? `, Vertrauensstufe ${c.trustLevelDe}` : ''),
      )
      .join('. ');
    summary = `Ihre umsatzstärksten Kunden: ${top}. Insgesamt ${totalWithRevenue} Kunden mit Umsatz.`;
  }

  return { content: [{ type: 'text', text: summary }], data };
};

export const topCustomersTool: ToolRegistration = {
  manifest: {
    name: 'top_customers',
    description:
      'READ-ONLY, PII-FREE. Ranks active customers by total sales revenue and returns the top 10 by ' +
      'customer number (not name) with spend, buy-in total, and trust level. Use for "wer sind ' +
      'unsere besten Kunden". Names are never read aloud; to identify a number, call find_customer. ' +
      'Only customers with revenue > 0 are listed.',
    inputSchema: TopCustomersArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only ranking by non-PII customer number, no name decrypted — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
