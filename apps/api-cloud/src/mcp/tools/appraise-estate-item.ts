/**
 * MCP tool: `appraise_estate_item` — Phase 2.A scaffold.
 *
 * INTENT
 * ──────
 * Given a description of an estate / antique / numismatic item that the
 * operator is considering buying (Ankauf), return an estimated fair-market
 * resale value in EUR cents. Used by the Bewertung screen to give the
 * cashier an instant ballpark while the customer waits.
 *
 * SCAFFOLD STATUS
 * ───────────────
 * READ-ONLY tool. Does NOT write to the DB — the operator decides whether
 * to act on the suggestion. The audit log still records every invocation
 * so we can compare AI guesses against the actual purchase price later
 * and tune the prompt.
 *
 * Returns integer cents (bigint serialised as string) for money safety;
 * no floats anywhere in the response.
 *
 * CONTRACT
 * ────────
 * Input:
 *   {
 *     itemDescription: string (free-form),
 *     itemType: 'COIN' | 'JEWELRY' | 'ANTIQUE_FURNITURE' | 'ART' | 'WATCH' | 'OTHER',
 *     metal?: 'GOLD' | 'SILVER' | 'PLATINUM' | 'PALLADIUM' | null,
 *     weightGrams?: decimal string,
 *     finenessDecimal?: decimal string,   // 0.0000..1.0000
 *     yearMintedFrom?: integer,
 *     yearMintedTo?: integer,
 *     originCountry?: ISO-3166-1 alpha-2,
 *     condition?: 'MINT' | 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR',
 *     notes?: string
 *   }
 *
 * Output:
 *   {
 *     estimatedValueCents: string (bigint),
 *     lowEndCents: string (bigint),
 *     highEndCents: string (bigint),
 *     confidence: 'low' | 'medium' | 'high',
 *     rationale: string,
 *     suggestedBuyOfferCents: string (bigint),
 *     factors: Array<{ name, contributionCents }>
 *   }
 *
 * Errors:
 *   • INVALID_PARAMS — required field for `itemType` missing
 *   • TOOL_FAILED    — LLM returned non-numeric / refused
 */

import { Type } from '@sinclair/typebox';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

// ────────────────────────────────────────────────────────────────────────
// Argument schema
// ────────────────────────────────────────────────────────────────────────

const ITEM_TYPES = ['COIN', 'JEWELRY', 'ANTIQUE_FURNITURE', 'ART', 'WATCH', 'OTHER'] as const;
const METALS = ['GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM'] as const;
const CONDITIONS = ['MINT', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;

export const AppraiseEstateItemArgs = Type.Object({
  itemDescription: Type.String({ minLength: 1, maxLength: 2000 }),
  itemType: Type.Union(ITEM_TYPES.map((s) => Type.Literal(s))),
  metal: Type.Optional(Type.Union(METALS.map((s) => Type.Literal(s)))),
  weightGrams: Type.Optional(Type.String({ pattern: '^\\d{1,6}(\\.\\d{1,4})?$' })),
  finenessDecimal: Type.Optional(Type.String({ pattern: '^(0(\\.\\d{1,4})?|1(\\.0{1,4})?)$' })),
  yearMintedFrom: Type.Optional(Type.Integer({ minimum: -3000, maximum: 3000 })),
  yearMintedTo: Type.Optional(Type.Integer({ minimum: -3000, maximum: 3000 })),
  originCountry: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
  condition: Type.Optional(Type.Union(CONDITIONS.map((s) => Type.Literal(s)))),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});

interface ArgsShape {
  itemDescription: string;
  itemType: (typeof ITEM_TYPES)[number];
  metal?: (typeof METALS)[number];
  weightGrams?: string;
  finenessDecimal?: string;
  yearMintedFrom?: number;
  yearMintedTo?: number;
  originCountry?: string;
  condition?: (typeof CONDITIONS)[number];
  notes?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  // Read-only: no DB writes. Optionally we COULD look up the current
  // LBMA spot price to anchor the estimate — wired in Phase 2.A.2 via
  // the `metal_prices` table (migration 0021). The stub computes a
  // melt-value floor for metal items and a tiered estimate for everything
  // else.
  const result = await runLlm(args);

  ctx.logger.info(
    {
      itemType: args.itemType,
      metal: args.metal,
      yearMintedFrom: args.yearMintedFrom,
      estimatedValueCents: result.estimatedValueCents.toString(),
      confidence: result.confidence,
    },
    'mcp.appraise_estate_item: produced estimate',
  );

  return {
    content: [
      {
        type: 'text',
        text:
          `Estimated value: ${formatCents(result.estimatedValueCents)} EUR ` +
          `(range ${formatCents(result.lowEndCents)}–${formatCents(result.highEndCents)} EUR, ` +
          `confidence ${result.confidence}). Suggested buy offer: ` +
          `${formatCents(result.suggestedBuyOfferCents)} EUR.`,
      },
    ],
    data: {
      // BigInts serialise as strings on the wire — keeps money discipline.
      estimatedValueCents: result.estimatedValueCents.toString(),
      lowEndCents: result.lowEndCents.toString(),
      highEndCents: result.highEndCents.toString(),
      confidence: result.confidence,
      rationale: result.rationale,
      suggestedBuyOfferCents: result.suggestedBuyOfferCents.toString(),
      factors: result.factors.map((f) => ({
        name: f.name,
        contributionCents: f.contributionCents.toString(),
      })),
    },
    // No affectedEntity — read-only tool.
  };
};

// ────────────────────────────────────────────────────────────────────────
// LLM stub — Phase 2.A.2 replaces this with a real Anthropic SDK call.
// ────────────────────────────────────────────────────────────────────────

interface AppraisalStubResult {
  estimatedValueCents: bigint;
  lowEndCents: bigint;
  highEndCents: bigint;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  suggestedBuyOfferCents: bigint;
  factors: Array<{ name: string; contributionCents: bigint }>;
}

async function runLlm(args: ArgsShape): Promise<AppraisalStubResult> {
  // Deterministic stub. Logic:
  //   • Metal items → melt value × condition multiplier × 1.4 retail uplift.
  //   • Other items → flat tier by itemType, modulated by condition.
  // The "buy offer" is always 60 % of the midpoint estimate (typical
  // dealer margin floor).

  const factors: Array<{ name: string; contributionCents: bigint }> = [];

  let mid = 0n;

  if (args.metal && args.weightGrams && args.finenessDecimal) {
    // Stub spot prices in EUR cents per gram (real impl reads metal_prices).
    // Numbers are wrong on purpose — the orchestrator MUST override them
    // with live LBMA when the real LLM call is wired.
    const stubSpotEurCentsPerGram: Record<(typeof METALS)[number], bigint> = {
      GOLD: 6_500n, // ~ €65/g pure
      SILVER: 80n, // ~ €0.80/g pure
      PLATINUM: 3_000n,
      PALLADIUM: 2_500n,
    };
    const weightGrams = parseDecimalToInt4(args.weightGrams);
    const finenessQ = parseDecimalToInt4(args.finenessDecimal);
    const spot = stubSpotEurCentsPerGram[args.metal];

    // melt = weightGrams × fineness × spot. weight + fineness are in
    // 10_000ths-units; divide by 10_000 once at the end.
    const meltCents = (weightGrams * finenessQ * spot) / 10_000n / 10_000n;
    factors.push({ name: 'melt_value', contributionCents: meltCents });

    const conditionMultiplierTenths = conditionMultiplier(args.condition);
    const retailUpliftTenths = 14n;
    mid = (meltCents * conditionMultiplierTenths * retailUpliftTenths) / 100n;
    factors.push({
      name: 'condition_x_retail_uplift',
      contributionCents: mid - meltCents,
    });
  } else {
    const baseCents = baseEstimateByType(args.itemType);
    factors.push({ name: 'base_by_type', contributionCents: baseCents });
    mid = (baseCents * conditionMultiplier(args.condition)) / 10n;
    factors.push({
      name: 'condition_multiplier',
      contributionCents: mid - baseCents,
    });
  }

  // Provenance / period bumps (small, additive).
  if (args.yearMintedFrom && args.yearMintedFrom < 1900) {
    const bonus = (mid * 15n) / 100n;
    mid += bonus;
    factors.push({ name: 'pre_1900_bonus', contributionCents: bonus });
  }

  const low = (mid * 80n) / 100n;
  const high = (mid * 125n) / 100n;
  const buyOffer = (mid * 60n) / 100n;

  const confidence: 'low' | 'medium' | 'high' =
    args.metal && args.weightGrams && args.finenessDecimal
      ? 'medium'
      : args.condition
        ? 'low'
        : 'low';

  return {
    estimatedValueCents: mid,
    lowEndCents: low,
    highEndCents: high,
    confidence,
    rationale:
      `Stub appraiser. Real LLM lands in Phase 2.A.2 and will use LBMA + ` +
      `provenance signals. Type=${args.itemType}` +
      (args.metal ? `, metal=${args.metal}` : '') +
      (args.condition ? `, condition=${args.condition}` : '') +
      '.',
    suggestedBuyOfferCents: buyOffer,
    factors,
  };
}

function baseEstimateByType(type: (typeof ITEM_TYPES)[number]): bigint {
  // EUR cents — intentionally conservative stubs.
  switch (type) {
    case 'COIN':
      return 5_000n; // €50
    case 'JEWELRY':
      return 20_000n; // €200
    case 'ANTIQUE_FURNITURE':
      return 50_000n; // €500
    case 'ART':
      return 30_000n; // €300
    case 'WATCH':
      return 40_000n; // €400
    case 'OTHER':
      return 10_000n; // €100
  }
}

function conditionMultiplier(c: ArgsShape['condition']): bigint {
  // Returned in tenths (so 12n = 1.2×, 8n = 0.8×).
  switch (c) {
    case 'MINT':
      return 12n;
    case 'EXCELLENT':
      return 11n;
    case 'GOOD':
      return 10n;
    case 'FAIR':
      return 8n;
    case 'POOR':
      return 5n;
    default:
      return 10n;
  }
}

function parseDecimalToInt4(s: string): bigint {
  // "12.5" → 125000  (i.e. value × 10_000)
  const [whole = '0', frac = ''] = s.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10_000n + BigInt(fracPadded || '0');
}

function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────────

// See `generate-seo-description.ts` for the rationale on the
// `ToolRegistration` (default-unknown) export type.
export const appraiseEstateItemTool: ToolRegistration = {
  manifest: {
    name: 'appraise_estate_item',
    description:
      'Returns an estimated fair-market value (EUR cents as bigint string) for an estate / ' +
      'antique / numismatic item described by the operator. Read-only: does NOT write to ' +
      'the DB. Allowed for ADMIN + CASHIER (cashier needs this during a live Ankauf).',
    inputSchema: AppraiseEstateItemArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only valuation, no PII — safe for the voice assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
