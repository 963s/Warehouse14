/**
 * MCP tool: `find_product` — the Jarvis assistant's read-only inventory lookup.
 *
 * READ-ONLY. Touches no PII, mutates nothing. The SQL here is copied from the
 * verified catalog route `GET /api/products` (routes/products-list.ts): the same
 * free-text ILIKE predicate (name / sku / barcode), the same relevance-ranking
 * CASE expression, and the same primary-category join. The status enum
 * (DRAFT / AVAILABLE / RESERVED / SOLD) is the one declared on the product row
 * in routes/products-detail.ts. The voice assistant calls this to answer
 * "haben wir ... auf Lager?" or "was kostet ...?" with real rows, not guesses.
 *
 * CONTRACT
 * ────────
 * Input:  { query: string }   // a name or SKU fragment (min 1 char)
 * Output: {
 *   query: string,
 *   matchCount: number,        // rows returned (0..8)
 *   matches: Array<{
 *     id: string,
 *     name: string,
 *     sku: string,
 *     status: 'DRAFT'|'AVAILABLE'|'RESERVED'|'SOLD',
 *     listPriceEur: string,    // raw numeric string, EUR
 *     categoryName: string | null,
 *     location: string | null, // "Lagereinheit, Schub, Position" if set
 *   }>,
 *   asOf: string,              // ISO timestamp
 * }
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const FindProductArgs = Type.Object({
  query: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'A product name or SKU fragment to search for, e.g. "Goldkette" or "AU-585".',
  }),
});

type FindProductArgs = { query: string };

type ProductStatus = 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';

/** Speakable German label per status — keeps the SCREAMING token out of the spoken line. */
const STATUS_DE: Record<ProductStatus, string> = {
  DRAFT: 'Entwurf',
  AVAILABLE: 'verfügbar',
  RESERVED: 'reserviert',
  SOLD: 'verkauft',
};

/** Money for the spoken summary: German decimal comma, no rounding, no invention. */
function toGermanEur(raw: string | null): string {
  if (raw === null || raw === '') return '0,00';
  return raw.replace('.', ',');
}

const handler: ToolHandler<FindProductArgs> = async (
  ctx: ToolInvocationContext,
  args: FindProductArgs,
): Promise<ToolResult> => {
  const term = args.query.trim();

  // Empty-after-trim ⇒ nothing to search. Fail soft with an empty result rather
  // than running a `%%` wildcard that would return the whole catalog.
  if (term.length === 0) {
    return {
      content: [{ type: 'text', text: 'Bitte nennen Sie einen Suchbegriff.' }],
      data: { query: args.query, matchCount: 0, matches: [], asOf: new Date().toISOString() },
    };
  }

  // Bind values mirror routes/products-list.ts exactly:
  //   • `%term%`  → the ILIKE fragment match (name / sku / barcode)
  //   • `term`    → exact-match rank buckets 0
  //   • `term%`   → prefix rank buckets 1 (sku) and 2 (name)
  const like = `%${term}%`;
  const prefix = `${term}%`;

  const result = await ctx.db.execute<{
    id: string;
    name: string;
    sku: string;
    status: ProductStatus;
    list_price_eur: string | null;
    category_name: string | null;
    location: string | null;
  }>(sql`
    SELECT
      p.id::text                       AS id,
      p.name                           AS name,
      p.sku                            AS sku,
      p.status::text                   AS status,
      p.list_price_eur::text           AS list_price_eur,
      c.name_de                        AS category_name,
      NULLIF(
        concat_ws(', ',
          p.location_storage_unit,
          p.location_drawer,
          p.location_position
        ),
        ''
      )                                AS location
    FROM products p
    LEFT JOIN product_categories pc
      ON pc.product_id = p.id AND pc.is_primary = TRUE
    LEFT JOIN categories c
      ON c.id = pc.category_id
    WHERE p.archived_at IS NULL
      AND (
        p.name ILIKE ${like}
        OR p.sku ILIKE ${like}
        OR (p.barcode IS NOT NULL AND p.barcode ILIKE ${like})
      )
    ORDER BY
      CASE
        WHEN lower(p.sku) = lower(${term}) THEN 0
        WHEN p.barcode IS NOT NULL AND lower(p.barcode) = lower(${term}) THEN 0
        WHEN lower(p.sku) LIKE lower(${prefix}) THEN 1
        WHEN lower(p.name) LIKE lower(${prefix}) THEN 2
        ELSE 3
      END,
      p.created_at DESC,
      p.id ASC
    LIMIT 8
  `);

  const rows = result as unknown as Array<{
    id: string;
    name: string;
    sku: string;
    status: ProductStatus;
    list_price_eur: string | null;
    category_name: string | null;
    location: string | null;
  }>;

  const matches = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    status: r.status,
    listPriceEur: r.list_price_eur ?? '0.00',
    categoryName: r.category_name ?? null,
    location: r.location ?? null,
  }));

  const data = {
    query: term,
    matchCount: matches.length,
    matches,
    asOf: new Date().toISOString(),
  };

  // A compact, speakable German summary. Sie-Form, EUR as strings, no invented
  // numbers. House rule: no underscore, no long/medium dash anywhere.
  let summary: string;
  if (matches.length === 0) {
    summary = `Keine Artikel gefunden für „${term}".`;
  } else {
    const parts = matches.map((m) => {
      const statusDe = STATUS_DE[m.status] ?? m.status;
      let line = `${m.name} (SKU ${m.sku}): ${toGermanEur(m.listPriceEur)} EUR, ${statusDe}`;
      if (m.categoryName) line += `, Kategorie ${m.categoryName}`;
      if (m.location) line += `, Lagerort ${m.location}`;
      return line;
    });
    summary = `${matches.length} Artikel gefunden: ${parts.join('; ')}.`;
  }

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const findProductTool: ToolRegistration = {
  manifest: {
    name: 'find_product',
    description:
      'READ-ONLY. Searches the inventory catalog by a name or SKU fragment (argument: query) and ' +
      'returns up to 8 best matches with id, name, sku, status (DRAFT/AVAILABLE/RESERVED/SOLD), ' +
      'list price in EUR, primary category, and storage location when set. Archived items are ' +
      'excluded. Use this to answer "haben wir X auf Lager?" or "was kostet X?". Mutates nothing.',
    inputSchema: FindProductArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only catalog lookup, no personal data — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
