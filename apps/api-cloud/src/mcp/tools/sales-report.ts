/**
 * MCP tool: `sales_report` — the Jarvis assistant's read-only revenue view
 * over a chosen period.
 *
 * READ-ONLY. Touches no PII, mutates nothing. Every sub-query here is copied
 * from verified routes so the columns + functions are known-good:
 *   • The VERKAUF / ANKAUF SUM(total_eur) aggregation and the
 *     `berlin_business_day(finalized_at)` period boundaries come straight from
 *     `/api/finance/profit` and `/api/finance/revenue` (routes/finance.ts).
 *   • The `total_eur`, `direction`, `storno_of_transaction_id IS NULL` guard is
 *     the same shape the `situation_report` shift_rev CTE uses (routes/dashboard.ts).
 *
 * The voice assistant calls this to answer "wie viel Umsatz hatten wir in den
 * letzten sieben Tagen?" with real numbers instead of guessing.
 *
 * CONTRACT
 * ────────
 * Input:  { period: 'today' | 'last7days' | 'last30days' | 'thismonth' }
 * Output: {
 *   period: string,
 *   verkaufRevenueEur: string,   // gross VERKAUF revenue, EUR
 *   verkaufCount: number,        // number of VERKAUF transactions
 *   ankaufValueEur: string,      // gross ANKAUF buy-in value, EUR
 *   ankaufCount: number,         // number of ANKAUF transactions
 *   asOf: string,                // ISO timestamp
 * }
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const SalesReportArgs = Type.Object({
  period: Type.Union(
    [
      Type.Literal('today'),
      Type.Literal('last7days'),
      Type.Literal('last30days'),
      Type.Literal('thismonth'),
    ],
    {
      description:
        'Time window for the revenue figures. One of: today, last7days, last30days, thismonth.',
    },
  ),
});

type SalesReportArgsT = {
  period: 'today' | 'last7days' | 'last30days' | 'thismonth';
};

/**
 * Period → SQL boundary on `berlin_business_day(finalized_at)`. These are the
 * exact expressions used by routes/finance.ts for VERKAUF/ANKAUF revenue by
 * period (Berlin business-day, the fiscally correct day boundary). The rolling
 * windows use `current_date - interval` math so today and the prior N-1 days
 * are covered.
 */
const PERIOD_FILTERS = {
  today: sql`berlin_business_day(t.finalized_at) = current_date`,
  last7days: sql`berlin_business_day(t.finalized_at) > current_date - interval '7 days'`,
  last30days: sql`berlin_business_day(t.finalized_at) > current_date - interval '30 days'`,
  thismonth: sql`date_trunc('month', berlin_business_day(t.finalized_at)) = date_trunc('month', current_date)`,
} as const;

/** German (Sie-Form) period labels for the speakable summary line. */
const PERIOD_LABELS: Record<SalesReportArgsT['period'], string> = {
  today: 'heute',
  last7days: 'letzte 7 Tage',
  last30days: 'letzte 30 Tage',
  thismonth: 'dieser Monat',
};

const handler: ToolHandler<SalesReportArgsT> = async (
  ctx: ToolInvocationContext,
  args: SalesReportArgsT,
): Promise<ToolResult> => {
  const periodFilter = PERIOD_FILTERS[args.period];

  const rows = await ctx.db.execute<{
    verkauf_revenue_eur: string;
    verkauf_count: number;
    ankauf_value_eur: string;
    ankauf_count: number;
  }>(sql`
    WITH
      verkauf AS (
        SELECT COALESCE(SUM(t.total_eur), 0)::text AS revenue,
               COUNT(*)::int                       AS cnt
          FROM transactions t
         WHERE t.direction = 'VERKAUF'
           AND t.storno_of_transaction_id IS NULL
           AND ${periodFilter}
      ),
      ankauf AS (
        SELECT COALESCE(SUM(t.total_eur), 0)::text AS value,
               COUNT(*)::int                       AS cnt
          FROM transactions t
         WHERE t.direction = 'ANKAUF'
           AND t.storno_of_transaction_id IS NULL
           AND ${periodFilter}
      )
    SELECT
      (SELECT revenue FROM verkauf) AS verkauf_revenue_eur,
      (SELECT cnt     FROM verkauf) AS verkauf_count,
      (SELECT value   FROM ankauf)  AS ankauf_value_eur,
      (SELECT cnt     FROM ankauf)  AS ankauf_count
  `);

  const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  const data = {
    period: args.period,
    verkaufRevenueEur: (r.verkauf_revenue_eur as string) ?? '0',
    verkaufCount: Number(r.verkauf_count ?? 0),
    ankaufValueEur: (r.ankauf_value_eur as string) ?? '0',
    ankaufCount: Number(r.ankauf_count ?? 0),
    asOf: new Date().toISOString(),
  };

  const label = PERIOD_LABELS[args.period];

  // A compact German summary line so the voice model can speak it directly.
  const summary =
    `Umsatz (${label}): ${data.verkaufRevenueEur} EUR aus ${data.verkaufCount} Verkäufen. ` +
    `Ankauf (${label}): ${data.ankaufValueEur} EUR aus ${data.ankaufCount} Ankäufen.`;

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const salesReportTool: ToolRegistration = {
  manifest: {
    name: 'sales_report',
    description:
      'READ-ONLY. Returns revenue over a chosen period: total VERKAUF (sales) revenue in EUR and ' +
      'transaction count, plus total ANKAUF (buy-in) value in EUR and count. Takes one argument ' +
      "`period` (one of 'today', 'last7days', 'last30days', 'thismonth'). Use this to answer " +
      'questions like "wie viel Umsatz hatten wir in den letzten sieben Tagen?" with real numbers. ' +
      'Touches no personal data and mutates nothing.',
    inputSchema: SalesReportArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only revenue aggregate, no personal data — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
