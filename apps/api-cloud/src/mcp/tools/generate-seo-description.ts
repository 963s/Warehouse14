/**
 * MCP tool: `generate_seo_description` — Phase 2.A scaffold.
 *
 * INTENT
 * ──────
 * Given a product id, read its facts (sku, name, metal, weight,
 * year_minted, period, catalog_reference, …), prompt the Claude API
 * for a 2-3 sentence German SEO description targeting numismatic +
 * antiques search intent, and write the result into
 * `products.seo_description_de` (and `seo_description_en` when an
 * English variant is requested).
 *
 * SCAFFOLD STATUS
 * ───────────────
 * The protocol contract + DB plumbing + audit hook are FINAL.
 * The actual LLM call is stubbed — handler returns a fixture
 * description and writes it to the row. When the Anthropic SDK is
 * wired (Phase 2.A.2), only `runLlm()` needs to be replaced; the
 * rest of the handler stays untouched.
 *
 * CONTRACT
 * ────────
 * Input:
 *   {
 *     productId: UUID,
 *     locale: 'de' | 'en' (default 'de'),
 *     tone: 'auction-house' | 'collector' | 'investor' (default 'collector'),
 *     maxLength: 60..280 chars (default 160)
 *   }
 *
 * Output:
 *   {
 *     productId: UUID,
 *     locale: 'de' | 'en',
 *     description: string,
 *     wrote: boolean   // false ⇒ same text was already on the row
 *   }
 *
 * Errors:
 *   • NOT_FOUND   — product does not exist
 *   • VALIDATION  — maxLength out of range / locale invalid
 *   • TOOL_FAILED — LLM returned empty / refused
 */

import { Type } from '@sinclair/typebox';
import { eq, sql } from 'drizzle-orm';

import { products } from '@warehouse14/db/schema';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

// ────────────────────────────────────────────────────────────────────────
// Argument schema
// ────────────────────────────────────────────────────────────────────────

export const GenerateSeoDescriptionArgs = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  locale: Type.Optional(Type.Union([Type.Literal('de'), Type.Literal('en')])),
  tone: Type.Optional(
    Type.Union([
      Type.Literal('auction-house'),
      Type.Literal('collector'),
      Type.Literal('investor'),
    ]),
  ),
  maxLength: Type.Optional(Type.Integer({ minimum: 60, maximum: 280 })),
});

interface ArgsShape {
  productId: string;
  locale?: 'de' | 'en';
  tone?: 'auction-house' | 'collector' | 'investor';
  maxLength?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const locale = args.locale ?? 'de';
  const tone = args.tone ?? 'collector';
  const maxLength = args.maxLength ?? 160;

  // 1. Read the product row — minimal column set, no PII.
  const rows = await ctx.db.execute<{
    id: string;
    sku: string;
    name: string;
    description_de: string | null;
    metal: string | null;
    weight_grams: string | null;
    fineness_decimal: string | null;
    year_minted_from: number | null;
    year_minted_to: number | null;
    origin_country: string | null;
    period: string | null;
    catalog_reference: string | null;
    seo_description: string | null;
    seo_description_en: string | null;
  }>(sql`
    SELECT id, sku, name, description_de, metal, weight_grams, fineness_decimal,
           year_minted_from, year_minted_to, origin_country, period, catalog_reference,
           seo_description, seo_description_en
    FROM products
    WHERE id = ${args.productId}::uuid
    LIMIT 1
  `);
  const product = rows[0];
  if (!product) {
    throw Object.assign(new Error(`product ${args.productId} not found`), {
      code: 'NOT_FOUND',
    });
  }

  // 2. Call the LLM. V1 SCAFFOLD: returns a deterministic stub so the
  //    flow is testable; Phase 2.A.2 swaps this for the real Anthropic
  //    SDK call with prompt-caching enabled.
  const generated = await runLlm({
    sku: product.sku,
    name: product.name,
    metal: product.metal,
    weightGrams: product.weight_grams,
    finenessDecimal: product.fineness_decimal,
    yearMintedFrom: product.year_minted_from,
    yearMintedTo: product.year_minted_to,
    originCountry: product.origin_country,
    period: product.period,
    catalogReference: product.catalog_reference,
    tone,
    locale,
    maxLength,
  });

  // 3. Decide whether to write — skip the UPDATE if identical to current.
  const currentValue = locale === 'de' ? product.seo_description : product.seo_description_en;
  const wrote = currentValue !== generated;

  if (wrote) {
    // 4. Single-column UPDATE. The set object is built locale-side so
    //    Drizzle can't accidentally update the other locale.
    if (locale === 'de') {
      await ctx.db
        .update(products)
        .set({ seoDescription: generated })
        .where(eq(products.id, args.productId));
    } else {
      await ctx.db
        .update(products)
        .set({ seoDescriptionEn: generated })
        .where(eq(products.id, args.productId));
    }
    ctx.logger.info(
      { productId: args.productId, locale, length: generated.length },
      'mcp.generate_seo_description: wrote description',
    );
  }

  return {
    content: [
      {
        type: 'text',
        text: `Generated ${locale} SEO description for SKU ${product.sku} (${generated.length} chars).`,
      },
    ],
    data: {
      productId: args.productId,
      locale,
      description: generated,
      wrote,
    },
    affectedEntity: { table: 'products', id: args.productId },
    // Cost stays null until the real LLM call is wired. The audit row
    // still gets a usable latency_ms from the dispatcher.
  };
};

// ────────────────────────────────────────────────────────────────────────
// LLM stub — replaced when Anthropic SDK lands.
// ────────────────────────────────────────────────────────────────────────

interface LlmInput {
  sku: string;
  name: string;
  metal: string | null;
  weightGrams: string | null;
  finenessDecimal: string | null;
  yearMintedFrom: number | null;
  yearMintedTo: number | null;
  originCountry: string | null;
  period: string | null;
  catalogReference: string | null;
  tone: 'auction-house' | 'collector' | 'investor';
  locale: 'de' | 'en';
  maxLength: number;
}

/**
 * V1 stub. Deterministic, no network call. Composes a plausible German
 * / English description from the row's facets. Real implementation
 * lands in Phase 2.A.2 as a single replacement of this function body.
 */
async function runLlm(input: LlmInput): Promise<string> {
  const yearRange =
    input.yearMintedFrom && input.yearMintedTo
      ? input.yearMintedFrom === input.yearMintedTo
        ? `${input.yearMintedFrom}`
        : `${input.yearMintedFrom}–${input.yearMintedTo}`
      : null;

  const facets = [
    input.metal,
    yearRange,
    input.originCountry,
    input.period,
    input.catalogReference ? `Ref. ${input.catalogReference}` : null,
  ].filter((s): s is string => Boolean(s));

  const lead = input.locale === 'de' ? `${input.name}.` : `${input.name}.`;
  const facetSentence =
    facets.length > 0
      ? input.locale === 'de'
        ? ` ${facets.join(' · ')}.`
        : ` ${facets.join(' · ')}.`
      : '';
  const toneTail =
    input.locale === 'de'
      ? input.tone === 'auction-house'
        ? ' Auktionsfähig dokumentiert.'
        : input.tone === 'investor'
          ? ' Wertstabil, dokumentierte Provenienz.'
          : ' Sammlerstück mit gepflegter Provenienz.'
      : input.tone === 'auction-house'
        ? ' Auction-grade documentation.'
        : input.tone === 'investor'
          ? ' Stable value, documented provenance.'
          : ' Collector item with curated provenance.';

  const out = `${lead}${facetSentence}${toneTail}`;
  return out.length <= input.maxLength ? out : `${out.slice(0, input.maxLength - 1)}…`;
}

// ────────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────────

// Public registration uses the default `unknown` parameterisation so the
// registry (tools/index.ts) can store a homogenous `ToolRegistration[]`.
// The TypeBox validation in `server.ts::callTool` enforces the shape
// before the handler runs — the cast to `ToolHandler<unknown>` is
// therefore safe.
export const generateSeoDescriptionTool: ToolRegistration = {
  manifest: {
    name: 'generate_seo_description',
    description:
      'Reads a product row and writes a 2-3 sentence German (or English) SEO description into ' +
      'products.seo_description (or seo_description_en). Idempotent: if the existing description ' +
      'matches the generated one, no UPDATE fires. ADMIN-only — writes to the products table.',
    inputSchema: GenerateSeoDescriptionArgs,
    requiredRoles: ['ADMIN'],
    isMutation: true,
    // Writes to the products table — the voice assistant must never reach it.
    assistantExposed: false,
  },
  handler: handler as ToolHandler<unknown>,
};
