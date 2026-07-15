/**
 * MCP tool: `sales_breakdown` — the Jarvis assistant's read-only SALES DEPTH for
 * a reporting window (today / this week / this month).
 *
 * READ-ONLY, no PII. Returns the biggest individual sales, an item-type
 * (category) breakdown, and totals (items sold, gross revenue, net-of-VAT, VAT,
 * number of sales, average sale). VERKAUF direction only. It excludes both the
 * storno/return mirror rows AND the original sale each one reverses (NOT EXISTS
 * storno), so totals reconcile with the daily-closing net revenue. Period bounds
 * use berlin_business_day() (DST-correct), matching closing-export.ts.
 *
 * This is a second-hand shop where each product is unique and sold at most once,
 * so units-per-product is ~1; the meaningful "best seller" signal is the
 * item-type breakdown, and topProducts surfaces the highest-value single sales.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';
import { ITEM_TYPE_DE, eurDE, labelDe } from './labels-de.js';

export const SalesBreakdownArgs = Type.Object({
  period: Type.Optional(
    Type.Union([Type.Literal('today'), Type.Literal('week'), Type.Literal('month')], {
      default: 'today',
      description:
        'Reporting window. today = current Berlin business day; week = current calendar week (from ' +
        'Monday); month = current calendar month. Default today.',
    }),
  ),
});

type SalesBreakdownArgs = { period?: 'today' | 'week' | 'month' };

interface TopProduct {
  name: string;
  itemType: string;
  units: number;
  revenueEur: string;
}
interface ByItemType {
  itemType: string;
  units: number;
  revenueEur: string;
}
type Row = {
  total_units: number;
  sale_count: number;
  total_revenue_eur: string;
  total_net_eur: string;
  total_vat_eur: string;
  top_products: TopProduct[];
  by_item_type: ByItemType[];
}

const PERIOD_LABEL: Record<string, string> = { today: 'Heute', week: 'Diese Woche', month: 'Diesen Monat' };

const handler: ToolHandler<SalesBreakdownArgs> = async (
  ctx: ToolInvocationContext,
  args: SalesBreakdownArgs,
): Promise<ToolResult> => {
  const period = args.period ?? 'today';

  const result = await ctx.db.execute<Row>(sql`
    WITH bounds AS (
      SELECT CASE ${period}
               WHEN 'today' THEN berlin_business_day(now())
               WHEN 'week'  THEN date_trunc('week',  berlin_business_day(now()))::date
               WHEN 'month' THEN date_trunc('month', berlin_business_day(now()))::date
               ELSE berlin_business_day(now())
             END AS start_day
    ),
    sales AS (
      SELECT ti.product_id, ti.line_total_eur, ti.line_subtotal_eur, ti.line_vat_eur,
             ti.transaction_id, p.name AS product_name, p.item_type::text AS item_type
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.transaction_id
        JOIN products p ON p.id = ti.product_id
        CROSS JOIN bounds b
       WHERE t.direction = 'VERKAUF'
         AND t.storno_of_transaction_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM transactions s WHERE s.storno_of_transaction_id = t.id)
         AND berlin_business_day(t.finalized_at) >= b.start_day
         AND berlin_business_day(t.finalized_at) <= berlin_business_day(now())
    )
    SELECT
      (SELECT COUNT(*)::int FROM sales)                            AS total_units,
      (SELECT COUNT(DISTINCT transaction_id)::int FROM sales)      AS sale_count,
      (SELECT COALESCE(SUM(line_total_eur),0)::text FROM sales)    AS total_revenue_eur,
      (SELECT COALESCE(SUM(line_subtotal_eur),0)::text FROM sales) AS total_net_eur,
      (SELECT COALESCE(SUM(line_vat_eur),0)::text FROM sales)      AS total_vat_eur,
      (SELECT COALESCE(json_agg(json_build_object('name',name,'itemType',item_type,'units',units,'revenueEur',revenue_eur) ORDER BY revenue_num DESC),'[]'::json)
         FROM (SELECT product_name AS name, item_type, COUNT(*)::int AS units,
                      SUM(line_total_eur)::text AS revenue_eur, SUM(line_total_eur) AS revenue_num
                 FROM sales GROUP BY product_id, product_name, item_type
                ORDER BY SUM(line_total_eur) DESC LIMIT 5) tp)     AS top_products,
      (SELECT COALESCE(json_agg(json_build_object('itemType',item_type,'units',units,'revenueEur',revenue_eur) ORDER BY revenue_num DESC),'[]'::json)
         FROM (SELECT item_type, COUNT(*)::int AS units,
                      SUM(line_total_eur)::text AS revenue_eur, SUM(line_total_eur) AS revenue_num
                 FROM sales GROUP BY item_type) it)                AS by_item_type
  `);

  const rows = result as unknown as Row[];
  const r = rows[0] ?? {
    total_units: 0,
    sale_count: 0,
    total_revenue_eur: '0',
    total_net_eur: '0',
    total_vat_eur: '0',
    top_products: [],
    by_item_type: [],
  };

  const saleCount = Number(r.sale_count ?? 0);
  const revenueNum = Number(r.total_revenue_eur ?? 0);
  const avgSale = saleCount > 0 ? (revenueNum / saleCount).toFixed(2) : '0';
  const byItemType = (r.by_item_type ?? []).map((b) => ({
    itemType: b.itemType,
    itemTypeDe: labelDe(ITEM_TYPE_DE, b.itemType),
    units: Number(b.units ?? 0),
    revenueEur: String(b.revenueEur ?? '0'),
  }));
  const topProducts = (r.top_products ?? []).map((t) => ({
    name: t.name,
    itemType: t.itemType,
    itemTypeDe: labelDe(ITEM_TYPE_DE, t.itemType),
    units: Number(t.units ?? 0),
    revenueEur: String(t.revenueEur ?? '0'),
  }));

  const data = {
    period,
    totalUnits: Number(r.total_units ?? 0),
    saleCount,
    totalRevenueEur: String(r.total_revenue_eur ?? '0'),
    totalNetEur: String(r.total_net_eur ?? '0'),
    totalVatEur: String(r.total_vat_eur ?? '0'),
    avgSaleEur: avgSale,
    topProducts,
    byItemType,
    asOf: new Date().toISOString(),
  };

  let summary: string;
  if (saleCount === 0) {
    summary = `${PERIOD_LABEL[period] ?? 'Im Zeitraum'} wurden noch keine Verkäufe verbucht.`;
  } else {
    const cats = byItemType
      .slice(0, 3)
      .map((c) => `${c.itemTypeDe} ${c.units} Stück (${eurDE(c.revenueEur)} EUR)`)
      .join(', ');
    let text =
      `${PERIOD_LABEL[period]}: ${saleCount} Verkäufe, ${data.totalUnits} Artikel, ` +
      `Umsatz ${eurDE(data.totalRevenueEur)} EUR, Durchschnittsbon ${eurDE(avgSale)} EUR.`;
    if (cats) text += ` Bestseller nach Kategorie: ${cats}.`;
    const top = topProducts[0];
    if (top) text += ` Größter Einzelverkauf: ${top.name} für ${eurDE(top.revenueEur)} EUR.`;
    summary = text;
  }

  return { content: [{ type: 'text', text: summary }], data };
};

export const salesBreakdownTool: ToolRegistration = {
  manifest: {
    name: 'sales_breakdown',
    description:
      'READ-ONLY. Sales depth for a period (argument: period = today | week | month, default today). ' +
      'Returns the best-selling categories (item types), the highest-value single sales, and totals ' +
      '(number of sales, items, gross revenue, net, VAT, average sale). VERKAUF only; storno/returns ' +
      'and the sales they reverse are excluded, so totals match the daily closing. Use for "was ' +
      'verkauft sich am besten", "wie lief diese Woche", "was war der größte Verkauf". No personal ' +
      'data. For a single period total only, sales_report is lighter.',
    inputSchema: SalesBreakdownArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only sales aggregate (products + money), no personal data — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
