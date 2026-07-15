/**
 * MCP tool: `product_details` — the Jarvis assistant's read-only DEEP-DIVE on
 * one product.
 *
 * READ-ONLY, no PII. Resolves a single product by SKU, barcode, or name
 * fragment (same relevance ranking as find_product, LIMIT 1) and returns the
 * full record: classification, metal / fineness / weight / Feingewicht,
 * acquisition cost, list price, computed margin (EUR + percent), collector
 * premium, storage location, live channel state, and collector facts. Answers
 * "erzähl mir alles über Artikel X", "wie hoch ist die Marge beim ...".
 *
 * Products are NOT personal data. acquisition_cost_eur + the derived margin are
 * commercially sensitive (the §25a purchase price) but owner-facing and already
 * shown on the mobile product-detail screen, so they are included for the
 * ADMIN/CASHIER assistant. The spoken summary skips any field that is null
 * rather than voicing "null".
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';
import {
  CONDITION_DE,
  EBAY_STATE_DE,
  ITEM_TYPE_DE,
  METAL_DE,
  PRODUCT_STATUS_DE,
  eurDE,
  labelDe,
} from './labels-de.js';

export const ProductDetailsArgs = Type.Object({
  query: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'A SKU, barcode, or product-name fragment, e.g. "E2E-MQ5H3Q32-02" or "Krügerrand".',
  }),
});

type ProductDetailsArgs = { query: string };

type Row = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  status: string;
  item_type: string;
  condition: string | null;
  is_commission: boolean | null;
  metal: string | null;
  karat_code: string | null;
  fineness_decimal: string | null;
  weight_grams: string | null;
  feingewicht_grams: string | null;
  acquisition_cost_eur: string | null;
  list_price_eur: string | null;
  margin_eur: string | null;
  margin_pct: string | null;
  collector_premium_eur: string | null;
  location: string | null;
  is_published_to_web: boolean | null;
  ebay_state: string | null;
  live_web: boolean | null;
  live_ebay: boolean | null;
  category_name: string | null;
}

const handler: ToolHandler<ProductDetailsArgs> = async (
  ctx: ToolInvocationContext,
  args: ProductDetailsArgs,
): Promise<ToolResult> => {
  const term = args.query.trim();
  if (term.length === 0) {
    return {
      content: [{ type: 'text', text: 'Bitte nennen Sie einen Artikelnamen oder eine Artikelnummer.' }],
      data: { query: args.query, found: false, product: null, asOf: new Date().toISOString() },
    };
  }
  const like = `%${term}%`;
  const prefix = `${term}%`;

  const result = await ctx.db.execute<Row>(sql`
    SELECT
      p.id::text AS id,
      p.name, p.sku, p.barcode,
      p.status::text     AS status,
      p.item_type::text  AS item_type,
      p.condition::text  AS condition,
      p.is_commission,
      p.metal, p.karat_code,
      p.fineness_decimal::text   AS fineness_decimal,
      p.weight_grams::text       AS weight_grams,
      p.feingewicht_grams::text  AS feingewicht_grams,
      p.acquisition_cost_eur::text AS acquisition_cost_eur,
      p.list_price_eur::text       AS list_price_eur,
      (p.list_price_eur - p.acquisition_cost_eur)::text AS margin_eur,
      CASE WHEN p.acquisition_cost_eur > 0
           THEN round((p.list_price_eur - p.acquisition_cost_eur) / p.acquisition_cost_eur * 100, 1)::text
           ELSE NULL END AS margin_pct,
      p.collector_premium_eur::text AS collector_premium_eur,
      NULLIF(concat_ws(', ', p.location_storage_unit, p.location_drawer, p.location_position), '') AS location,
      p.is_published_to_web,
      p.ebay_state::text AS ebay_state,
      (p.is_published_to_web AND p.status = 'AVAILABLE') AS live_web,
      (p.ebay_state = 'ONLINE')                          AS live_ebay,
      c.name_de AS category_name
    FROM products p
    LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.is_primary = TRUE
    LEFT JOIN categories c ON c.id = pc.category_id
    WHERE p.archived_at IS NULL
      AND (p.name ILIKE ${like} OR p.sku ILIKE ${like} OR (p.barcode IS NOT NULL AND p.barcode ILIKE ${like}))
    ORDER BY
      CASE
        WHEN lower(p.sku) = lower(${term}) THEN 0
        WHEN p.barcode IS NOT NULL AND lower(p.barcode) = lower(${term}) THEN 0
        WHEN lower(p.sku)  LIKE lower(${prefix}) THEN 1
        WHEN lower(p.name) LIKE lower(${prefix}) THEN 2
        ELSE 3
      END,
      p.created_at DESC, p.id ASC
    LIMIT 1
  `);

  const rows = result as unknown as Row[];
  const r = rows[0];
  if (!r) {
    return {
      content: [{ type: 'text', text: `Zu „${term}" habe ich keinen Artikel gefunden.` }],
      data: { query: term, found: false, product: null, asOf: new Date().toISOString() },
    };
  }

  const product = {
    id: r.id,
    name: r.name,
    sku: r.sku,
    barcode: r.barcode ?? null,
    status: r.status,
    statusDe: labelDe(PRODUCT_STATUS_DE, r.status),
    itemType: r.item_type,
    itemTypeDe: labelDe(ITEM_TYPE_DE, r.item_type),
    condition: r.condition ?? null,
    conditionDe: labelDe(CONDITION_DE, r.condition),
    isCommission: r.is_commission === true,
    metal: r.metal ?? null,
    metalDe: labelDe(METAL_DE, r.metal),
    karatCode: r.karat_code ?? null,
    finenessDecimal: r.fineness_decimal ?? null,
    weightGrams: r.weight_grams ?? null,
    feingewichtGrams: r.feingewicht_grams ?? null,
    acquisitionCostEur: r.acquisition_cost_eur ?? null,
    listPriceEur: r.list_price_eur ?? null,
    marginEur: r.margin_eur ?? null,
    marginPct: r.margin_pct ?? null,
    collectorPremiumEur: r.collector_premium_eur ?? null,
    location: r.location ?? null,
    isPublishedToWeb: r.is_published_to_web === true,
    ebayState: r.ebay_state ?? null,
    ebayStateDe: labelDe(EBAY_STATE_DE, r.ebay_state),
    liveWeb: r.live_web === true,
    liveEbay: r.live_ebay === true,
    categoryName: r.category_name ?? null,
  };

  // Build the spoken line, skipping any field that is null so we never voice "null".
  const parts: string[] = [`${product.name}, Artikelnummer ${product.sku}.`];
  const cls = [product.statusDe, product.itemTypeDe].filter((x) => x).join(', ');
  if (cls) parts.push(`${cls}.`);
  if (product.metalDe) {
    let m = product.metalDe;
    if (product.feingewichtGrams)
      m += `, Feingewicht ${String(product.feingewichtGrams).replace('.', ',')} Gramm`;
    parts.push(`${m}.`);
  }
  if (product.listPriceEur) {
    let money = `Verkaufspreis ${eurDE(product.listPriceEur)} EUR`;
    if (product.acquisitionCostEur) money = `Einkauf ${eurDE(product.acquisitionCostEur)} EUR, ${money}`;
    if (product.marginEur) {
      money += `, Marge ${eurDE(product.marginEur)} EUR`;
      if (product.marginPct) money += ` das sind ${String(product.marginPct).replace('.', ',')} Prozent`;
    }
    parts.push(`${money}.`);
  }
  if (product.location) parts.push(`Lagerort ${product.location}.`);
  const web = product.liveWeb ? 'ja' : 'nein';
  const ebay = product.liveEbay ? 'online' : product.ebayStateDe ? product.ebayStateDe : 'nein';
  parts.push(`Im Webshop ${web}, bei eBay ${ebay}.`);
  const summary = parts.join(' ');

  return {
    content: [{ type: 'text', text: summary }],
    data: { query: term, found: true, product, asOf: new Date().toISOString() },
  };
};

export const productDetailsTool: ToolRegistration = {
  manifest: {
    name: 'product_details',
    description:
      'READ-ONLY. Deep detail on ONE product resolved by SKU, barcode, or name fragment (argument: ' +
      'query). Returns full classification, metal/fineness/weight/Feingewicht, acquisition cost, ' +
      'list price, margin (EUR + percent), collector premium, storage location, live web/eBay ' +
      'state, and category. Use for "erzähl mir alles über Artikel X", "wie hoch ist die Marge ' +
      'beim ...", "wo liegt der ...". Includes owner-facing purchase price + margin. No personal ' +
      'data. For a broad list use list_products instead.',
    inputSchema: ProductDetailsArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only single-product detail, no personal data — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
