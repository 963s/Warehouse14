/**
 * MCP tool: `list_products` — the Jarvis assistant's read-only catalog BROWSE.
 *
 * READ-ONLY, no PII. Where find_product does a single fuzzy lookup and
 * inventory_overview gives aggregate counts, this offers a FILTERED, RANKED
 * browse of the catalog so Jarvis can answer "zeig mir die Produkte", "welche
 * Goldmünzen haben wir", "was ist das teuerste Stück", "verfügbare Silberbarren
 * unter 1000 Euro". All filters are optional and AND together. Returns up to 25
 * rows (default 15) sorted by list price descending. Live-channel flags use the
 * TRUE predicates (is_published_to_web AND AVAILABLE for web; ebay_state ONLINE
 * for eBay), never the stale intent flags. acquisition_cost is NOT selected here
 * — the browse never exposes purchase price / margin.
 *
 * CONTRACT
 * ────────
 * Input:  { status?, metal?, itemType?, minPrice?, maxPrice?, query?, limit? }
 * Output: { count, products: Array<{id,name,sku,status,itemType,metal,weightGrams,
 *           listPriceEur,liveWeb,liveEbay,location}>, filters, asOf }
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';
import { ITEM_TYPE_DE, PRODUCT_STATUS_DE, eurDE, labelDe } from './labels-de.js';

export const ListProductsArgs = Type.Object({
  status: Type.Optional(
    Type.Union(
      [Type.Literal('DRAFT'), Type.Literal('AVAILABLE'), Type.Literal('RESERVED'), Type.Literal('SOLD')],
      { description: 'Filter by product status.' },
    ),
  ),
  metal: Type.Optional(
    Type.Union(
      [Type.Literal('gold'), Type.Literal('silver'), Type.Literal('platinum'), Type.Literal('palladium')],
      { description: 'Filter by metal.' },
    ),
  ),
  itemType: Type.Optional(
    Type.Union(
      [
        Type.Literal('gold_jewelry'), Type.Literal('gold_coin'), Type.Literal('gold_bar'),
        Type.Literal('silver_jewelry'), Type.Literal('silver_coin'), Type.Literal('silver_bar'),
        Type.Literal('platinum_jewelry'), Type.Literal('platinum_coin'), Type.Literal('platinum_bar'),
        Type.Literal('antique'), Type.Literal('watch'), Type.Literal('other'),
      ],
      { description: 'Category/kind filter. "Goldmünzen" = gold_coin, "Silberbarren" = silver_bar, etc.' },
    ),
  ),
  minPrice: Type.Optional(Type.Number({ minimum: 0, description: 'Minimum list price in EUR.' })),
  maxPrice: Type.Optional(Type.Number({ minimum: 0, description: 'Maximum list price in EUR.' })),
  query: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Free text over name + SKU.' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, default: 15 })),
});

type ListProductsArgs = {
  status?: 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';
  metal?: 'gold' | 'silver' | 'platinum' | 'palladium';
  itemType?: string;
  minPrice?: number;
  maxPrice?: number;
  query?: string;
  limit?: number;
};

type Row = {
  id: string;
  name: string;
  sku: string;
  status: string;
  item_type: string;
  metal: string | null;
  weight_grams: string | null;
  list_price_eur: string | null;
  live_web: boolean | null;
  live_ebay: boolean | null;
  location: string | null;
}

const handler: ToolHandler<ListProductsArgs> = async (
  ctx: ToolInvocationContext,
  args: ListProductsArgs,
): Promise<ToolResult> => {
  const status = args.status ?? null;
  const metal = args.metal ?? null;
  const itemType = args.itemType ?? null;
  const minPrice = args.minPrice ?? null;
  const maxPrice = args.maxPrice ?? null;
  const q = args.query?.trim();
  const like = q && q.length > 0 ? `%${q}%` : null;
  const limit = Math.min(25, Math.max(1, args.limit ?? 15));

  const result = await ctx.db.execute<Row>(sql`
    SELECT
      p.id::text             AS id,
      p.name                 AS name,
      p.sku                  AS sku,
      p.status::text         AS status,
      p.item_type::text      AS item_type,
      p.metal                AS metal,
      p.weight_grams::text   AS weight_grams,
      p.list_price_eur::text AS list_price_eur,
      (p.is_published_to_web AND p.status = 'AVAILABLE') AS live_web,
      (p.ebay_state = 'ONLINE')                          AS live_ebay,
      NULLIF(concat_ws(', ', p.location_storage_unit, p.location_drawer, p.location_position), '') AS location
    FROM products p
    WHERE p.archived_at IS NULL
      AND (${status}::text    IS NULL OR p.status::text    = ${status}::text)
      AND (${metal}::text     IS NULL OR p.metal           = ${metal}::text)
      AND (${itemType}::text  IS NULL OR p.item_type::text = ${itemType}::text)
      AND (${minPrice}::numeric IS NULL OR p.list_price_eur >= ${minPrice}::numeric)
      AND (${maxPrice}::numeric IS NULL OR p.list_price_eur <= ${maxPrice}::numeric)
      AND (${like}::text      IS NULL OR p.name ILIKE ${like}::text OR p.sku ILIKE ${like}::text)
    ORDER BY p.list_price_eur DESC NULLS LAST, p.created_at DESC, p.id ASC
    LIMIT ${limit}
  `);

  const rows = result as unknown as Row[];
  const products = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    status: r.status,
    statusDe: labelDe(PRODUCT_STATUS_DE, r.status),
    itemType: r.item_type,
    itemTypeDe: labelDe(ITEM_TYPE_DE, r.item_type),
    metal: r.metal ?? null,
    weightGrams: r.weight_grams ?? null,
    listPriceEur: r.list_price_eur ?? '0.00',
    liveWeb: r.live_web === true,
    liveEbay: r.live_ebay === true,
    location: r.location ?? null,
  }));

  let summary: string;
  if (products.length === 0) {
    summary = 'Keine Produkte zu diesen Kriterien gefunden.';
  } else {
    const top = products.slice(0, 3).map((p) => {
      const st = p.statusDe ? ` (${p.statusDe})` : '';
      return `${p.name} für ${eurDE(p.listPriceEur)} EUR${st}`;
    });
    summary = `${products.length} Produkte gefunden. Die teuersten: ${top.join(', ')}.`;
  }

  return {
    content: [{ type: 'text', text: summary }],
    data: {
      count: products.length,
      products,
      filters: { status, metal, itemType, minPrice, maxPrice, query: q ?? null, limit },
      asOf: new Date().toISOString(),
    },
  };
};

export const listProductsTool: ToolRegistration = {
  manifest: {
    name: 'list_products',
    description:
      'READ-ONLY. Browses/filters the inventory catalog and returns up to 25 products (default 15) ' +
      'sorted by list price descending. Optional filters (all AND together): status ' +
      '(DRAFT/AVAILABLE/RESERVED/SOLD), metal (gold/silver/platinum/palladium), itemType (e.g. ' +
      'gold_coin for Goldmünzen, silver_bar for Silberbarren), minPrice, maxPrice, query (free text ' +
      'over name+SKU). Each row has name, sku, status, itemType, metal, weight, list price EUR, ' +
      'whether it is live on the web shop / eBay, and storage location. Use this to SHOW/BROWSE ' +
      'products: "zeig mir die Produkte", "welche Goldmünzen haben wir", "was ist das teuerste ' +
      'Stück". Purchase price is not exposed. No personal data.',
    inputSchema: ListProductsArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only catalog browse, no personal data and no purchase price — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
