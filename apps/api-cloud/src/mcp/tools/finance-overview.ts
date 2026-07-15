/**
 * MCP tool: `finance_overview` — the Jarvis assistant's read-only P&L snapshot
 * over a period ("wie sieht es finanziell aus?").
 *
 * READ-ONLY. Touches no PII, mutates nothing. Every sub-query here is copied
 * verbatim (columns, tables, functions) from the verified
 * `GET /api/finance/profit` aggregator (routes/finance.ts, migration 0075), so
 * the SQL is known-good:
 *   • revenue / Wareneinkauf → SUM(t.total_eur) over transactions, split by
 *     `direction`, day-keyed on berlin_business_day(t.finalized_at).
 *   • one-off Ausgaben        → SUM(e.amount_cents) over operating_expenses,
 *     day-keyed on e.business_day.
 *   • Fixkosten (monatlich)   → SUM(f.monthly_amount_cents) over fixed_costs
 *     whose [active_from, active_to] window overlaps the current month.
 *
 * The only thing NOT taken straight from a verified query is the period window:
 * `thismonth` is exactly the verified `period=month` filter; `last30days` and
 * `thisyear` reuse the SAME columns/functions with a different date predicate.
 * The rough result is plain arithmetic on those real figures — no number is
 * invented, and the fixed-cost allocation is documented in `hinweis`.
 *
 * CONTRACT
 * ────────
 * Input:  { period?: 'thismonth' | 'last30days' | 'thisyear' }  (default thismonth)
 * Output: {
 *   period, periodLabel,
 *   revenueEur, wareneinkaufEur, expensesEur,
 *   fixedCostsMonthlyEur, fixedCostsAllocatedEur, resultEur,   // German EUR strings
 *   cents: { … },                                              // raw integer cents
 *   hinweis, asOf,
 * }
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

type Period = 'thismonth' | 'last30days' | 'thisyear';

export const FinanceOverviewArgs = Type.Object({
  period: Type.Optional(
    Type.Union(
      [Type.Literal('thismonth'), Type.Literal('last30days'), Type.Literal('thisyear')],
      {
        default: 'thismonth',
        description:
          'Time window for the snapshot. thismonth = current calendar month to date, ' +
          'last30days = rolling last 30 days, thisyear = current calendar year to date.',
      },
    ),
  ),
});

interface FinanceOverviewArgsT {
  period?: Period;
}

/** Integer cents → German euro string, e.g. 123456 → "1.234,56 EUR". */
function formatEuro(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const restStr = rest.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${grouped},${restStr} EUR`;
}

const PERIOD_LABEL: Record<Period, string> = {
  thismonth: 'dieser Monat',
  last30days: 'letzte 30 Tage',
  thisyear: 'dieses Jahr',
};

const handler: ToolHandler<FinanceOverviewArgsT> = async (
  ctx: ToolInvocationContext,
  args: FinanceOverviewArgsT,
): Promise<ToolResult> => {
  const period: Period = args.period ?? 'thismonth';

  // Transaction-day window on berlin_business_day(finalized_at) — same day key
  // the verified profit + revenue queries use.
  const txWindow =
    period === 'thismonth'
      ? sql`date_trunc('month', berlin_business_day(t.finalized_at)) = date_trunc('month', current_date)
             AND berlin_business_day(t.finalized_at) <= current_date`
      : period === 'thisyear'
        ? sql`date_trunc('year', berlin_business_day(t.finalized_at)) = date_trunc('year', current_date)
               AND berlin_business_day(t.finalized_at) <= current_date`
        : sql`berlin_business_day(t.finalized_at) > (current_date - 30)
               AND berlin_business_day(t.finalized_at) <= current_date`;

  // Expense-day window on business_day — same column the verified profit query uses.
  const exWindow =
    period === 'thismonth'
      ? sql`date_trunc('month', e.business_day) = date_trunc('month', current_date)
             AND e.business_day <= current_date`
      : period === 'thisyear'
        ? sql`date_trunc('year', e.business_day) = date_trunc('year', current_date)
               AND e.business_day <= current_date`
        : sql`e.business_day > (current_date - 30)
               AND e.business_day <= current_date`;

  // Fixed-cost overlap with the CURRENT calendar month → the monthly figure
  // (verified profit query, period=month, scale 1.0).
  const monthStart = sql`date_trunc('month', current_date)::date`;
  const monthEnd = sql`(date_trunc('month', current_date) + interval '1 month - 1 day')::date`;

  const rows = await ctx.db.execute<{
    revenue_cents: number | string;
    ankauf_cents: number | string;
    expenses_cents: number | string;
    fixed_costs_monthly_cents: number | string;
    current_month: number | string;
  }>(sql`
    WITH
      rev AS (
        SELECT COALESCE(ROUND(SUM(t.total_eur) * 100), 0)::bigint AS c
          FROM transactions t
         WHERE t.direction = 'VERKAUF'
           AND ${txWindow}
      ),
      ank AS (
        SELECT COALESCE(ROUND(SUM(t.total_eur) * 100), 0)::bigint AS c
          FROM transactions t
         WHERE t.direction = 'ANKAUF'
           AND ${txWindow}
      ),
      exp AS (
        SELECT COALESCE(SUM(e.amount_cents), 0)::bigint AS c
          FROM operating_expenses e
         WHERE ${exWindow}
      ),
      fix AS (
        SELECT COALESCE(SUM(f.monthly_amount_cents), 0)::bigint AS c
          FROM fixed_costs f
         WHERE f.active_from <= ${monthEnd}
           AND (f.active_to IS NULL OR f.active_to >= ${monthStart})
      )
    SELECT
      (SELECT c FROM rev)                     AS revenue_cents,
      (SELECT c FROM ank)                     AS ankauf_cents,
      (SELECT c FROM exp)                     AS expenses_cents,
      (SELECT c FROM fix)                     AS fixed_costs_monthly_cents,
      EXTRACT(MONTH FROM current_date)::int   AS current_month
  `);

  const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  const revenueCents = Number(r.revenue_cents ?? 0);
  const ankaufCents = Number(r.ankauf_cents ?? 0);
  const expensesCents = Number(r.expenses_cents ?? 0);
  const fixedCostsMonthlyCents = Number(r.fixed_costs_monthly_cents ?? 0);
  const currentMonth = Number(r.current_month ?? 1);

  // Rough result = Umsatz − Wareneinkauf − Ausgaben − anteilige Fixkosten.
  // thismonth / last30days ≈ one month of fixed costs; thisyear is scaled up by
  // the months elapsed so far (rough, documented in `hinweis`).
  const periodMonths = period === 'thisyear' ? currentMonth : 1;
  const fixedCostsAllocatedCents = Math.round(fixedCostsMonthlyCents * periodMonths);
  const resultCents = revenueCents - ankaufCents - expensesCents - fixedCostsAllocatedCents;

  const periodLabel = PERIOD_LABEL[period];

  const data = {
    period,
    periodLabel,
    revenueEur: formatEuro(revenueCents),
    wareneinkaufEur: formatEuro(ankaufCents),
    expensesEur: formatEuro(expensesCents),
    fixedCostsMonthlyEur: formatEuro(fixedCostsMonthlyCents),
    fixedCostsAllocatedEur: formatEuro(fixedCostsAllocatedCents),
    resultEur: formatEuro(resultCents),
    cents: {
      revenue: revenueCents,
      wareneinkauf: ankaufCents,
      expenses: expensesCents,
      fixedCostsMonthly: fixedCostsMonthlyCents,
      fixedCostsAllocated: fixedCostsAllocatedCents,
      result: resultCents,
    },
    hinweis:
      'Das Ergebnis ist eine grobe Rechnung: Umsatz minus Wareneinkauf minus Ausgaben minus ' +
      'anteilige Fixkosten. Die Fixkosten sind ein Monatswert; für das Jahr werden sie mit den ' +
      'bisher vergangenen Monaten hochgerechnet.',
    asOf: new Date().toISOString(),
  };

  // Compact German summary line the voice model can speak directly.
  const summary =
    `Finanzen (${periodLabel}): ` +
    `Umsatz ${data.revenueEur}, ` +
    `Wareneinkauf ${data.wareneinkaufEur}, ` +
    `Ausgaben ${data.expensesEur}, ` +
    `Fixkosten monatlich ${data.fixedCostsMonthlyEur}, ` +
    `Ergebnis grob ${data.resultEur}.`;

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const financeOverviewTool: ToolRegistration = {
  manifest: {
    name: 'finance_overview',
    description:
      'READ-ONLY. Returns a finance snapshot for a period (arg period: thismonth, last30days, or ' +
      'thisyear): revenue (VERKAUF), goods purchased (Wareneinkauf / ANKAUF), one-off operating ' +
      'expenses, the current monthly fixed costs, and a rough result (revenue minus purchases minus ' +
      'expenses minus allocated fixed costs). All money in EUR. Call this to answer owner questions ' +
      'like "wie sieht es finanziell aus?", "Umsatz diesen Monat?", or "machen wir Gewinn?". ' +
      'Aggregates only, no personal data. Selects only, mutates nothing.',
    inputSchema: FinanceOverviewArgs,
    requiredRoles: ['ADMIN'],
    isMutation: false,
    // Read-only aggregate financials, no personal data — safe for the assistant,
    // but owner-only (ADMIN) since it exposes the shop's P&L.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
