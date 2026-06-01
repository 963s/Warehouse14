/**
 * Price estimation for intake drafts (Phase B). Pure + deterministic — turns
 * the vision-estimated fine (pure-metal) weight + the LBMA spot snapshot into a
 * suggested acquisition (what we'd pay) and sale (what we'd list) price.
 *
 * This is a HINT for the human reviewer, never an automatic price. The tax
 * classifier still decides the tax treatment; this only fills the two
 * suggested-price fields that were previously left null.
 */

export interface PriceEstimateInput {
  itemType: string;
  /** Fine (pure-metal) grams the vision step estimated, or null. */
  estimatedFineGrams: number | null;
  /** A market price the vision step observed (e.g. a coin catalogue value), or null. */
  observedMarketPriceEur: number | null;
  goldEurPerGram: number | null;
  silverEurPerGram: number | null;
}

export interface PriceEstimateOptions {
  /** Fraction below melt we pay when buying (default 0.10 = 10%). */
  buyMarginPct?: number;
  /** Fraction above melt we list when selling (default 0.15 = 15%). */
  saleMarkupPct?: number;
}

export interface PriceEstimate {
  /** Pure-metal melt value, or null when not a precious-metal item / no weight. */
  meltValueEur: number | null;
  /** Suggested Ankauf price (what we'd pay), or null. */
  suggestedAcquisitionEur: number | null;
  /** Suggested Verkauf price (what we'd list), or null. */
  suggestedSaleEur: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pick the spot price relevant to the item's metal, or null if not metal-based. */
function spotForItem(itemType: string, gold: number | null, silver: number | null): number | null {
  const t = itemType.toLowerCase();
  if (t.includes('gold')) return gold;
  if (t.includes('silver')) return silver;
  return null; // platinum / antique / watch / other → no melt basis here
}

export function estimateDraftPrices(
  input: PriceEstimateInput,
  opts: PriceEstimateOptions = {},
): PriceEstimate {
  const buyMargin = opts.buyMarginPct ?? 0.1;
  const saleMarkup = opts.saleMarkupPct ?? 0.15;

  const spot = spotForItem(input.itemType, input.goldEurPerGram, input.silverEurPerGram);
  const grams = input.estimatedFineGrams;
  const meltValueEur = spot !== null && grams !== null && grams > 0 ? round2(grams * spot) : null;

  // Acquisition: pay below melt — only meaningful when we have a melt basis.
  const suggestedAcquisitionEur =
    meltValueEur !== null ? round2(meltValueEur * (1 - buyMargin)) : null;

  // Sale: prefer an observed market price; otherwise melt + markup.
  const suggestedSaleEur =
    input.observedMarketPriceEur !== null && input.observedMarketPriceEur > 0
      ? round2(input.observedMarketPriceEur)
      : meltValueEur !== null
        ? round2(meltValueEur * (1 + saleMarkup))
        : null;

  return { meltValueEur, suggestedAcquisitionEur, suggestedSaleEur };
}
