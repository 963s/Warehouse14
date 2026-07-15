/**
 * MCP tool: `inventory_overview` — the Jarvis assistant's read-only answer to
 * "wie viele Artikel / Produkte haben wir?" and "was ist der Bestand wert?".
 *
 * READ-ONLY. Touches no PII, mutates nothing. This closes the coverage gap that
 * made the assistant open a developer ticket for a plain count question: the
 * search tool `find_product` answers "find me X", but nothing answered "how
 * many, by status, and what is it worth". Every filter here mirrors the verified
 * inventory queries in routes/products.ts + routes/inventory-sessions.ts
 * (archived_at IS NULL is the live-catalog predicate; list_price_eur is the sell
 * price; status is AVAILABLE / RESERVED / SOLD).
 *
 * CONTRACT
 * ────────
 * Input:  {}  (no arguments)
 * Output: {
 *   totalActive: number,                    // products not archived
 *   availableCount: number,
 *   reservedCount: number,
 *   soldCount: number,
 *   availableValueEur: string,              // sum of list_price_eur of AVAILABLE
 *   byStatus: Array<{ status, count, valueEur }>,
 *   publishedCount: number,                 // live on the web storefront
 *   ebayCount: number,                      // listed on eBay
 *   asOf: string,                           // ISO timestamp
 * }
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const InventoryOverviewArgs = Type.Object({});

/** German money for the spoken summary line; data keeps raw decimals. */
function eur(raw: string | number | null): string {
  const n = Number(raw ?? 0);
  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return `${formatted} EUR`;
}

const handler: ToolHandler<Record<string, never>> = async (
  ctx: ToolInvocationContext,
): Promise<ToolResult> => {
  const rows = await ctx.db.execute<{
    by_status: Array<{ status: string; count: number; valueEur: string }>;
    total_active: number;
    available_count: number;
    reserved_count: number;
    sold_count: number;
    available_value_eur: string;
    published_count: number;
    ebay_count: number;
  }>(sql`
    SELECT
      (SELECT COALESCE(
                json_agg(json_build_object('status', status, 'count', n, 'valueEur', value_eur)
                         ORDER BY status),
                '[]'::json)
         FROM (
           SELECT status::text AS status,
                  COUNT(*)::int AS n,
                  COALESCE(SUM(list_price_eur), 0)::text AS value_eur
             FROM products
            WHERE archived_at IS NULL
            GROUP BY status
         ) s
      )                                                                              AS by_status,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL)                 AS total_active,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND status = 'AVAILABLE') AS available_count,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND status = 'RESERVED')  AS reserved_count,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND status = 'SOLD')      AS sold_count,
      (SELECT COALESCE(SUM(list_price_eur), 0)::text FROM products
         WHERE archived_at IS NULL AND status = 'AVAILABLE')                          AS available_value_eur,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND published_at IS NOT NULL) AS published_count,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND listed_on_ebay)  AS ebay_count
  `);

  const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  const byStatusRaw = (r.by_status as Array<{ status: string; count: number; valueEur: string }>) ?? [];
  const data = {
    totalActive: Number(r.total_active ?? 0),
    availableCount: Number(r.available_count ?? 0),
    reservedCount: Number(r.reserved_count ?? 0),
    soldCount: Number(r.sold_count ?? 0),
    availableValueEur: (r.available_value_eur as string) ?? '0',
    byStatus: byStatusRaw.map((b) => ({
      status: b.status,
      count: Number(b.count ?? 0),
      valueEur: String(b.valueEur ?? '0'),
    })),
    publishedCount: Number(r.published_count ?? 0),
    ebayCount: Number(r.ebay_count ?? 0),
    asOf: new Date().toISOString(),
  };

  // A compact German line the voice model can speak directly.
  const summary =
    `Bestand: ${data.totalActive} Artikel insgesamt. ` +
    `Verfügbar: ${data.availableCount} (Wert ${eur(data.availableValueEur)}), ` +
    `reserviert: ${data.reservedCount}, verkauft: ${data.soldCount}. ` +
    `Im Webshop: ${data.publishedCount}, bei eBay: ${data.ebayCount}.`;

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const inventoryOverviewTool: ToolRegistration = {
  manifest: {
    name: 'inventory_overview',
    description:
      'READ-ONLY. Returns the inventory at a glance: total number of products, counts by status ' +
      '(AVAILABLE, RESERVED, SOLD), the value of available stock in EUR, and how many are live on ' +
      'the web shop and eBay. No arguments. Use this to answer "wie viele Artikel/Produkte haben ' +
      'wir?", "was ist auf Lager?" or "was ist der Bestand wert?" with real numbers. Touches no ' +
      'personal data.',
    inputSchema: InventoryOverviewArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
