/**
 * Deterministic German tax-treatment classifier — ADR-0015 §7, Rules 1-8.
 *
 * THE MOST IMPORTANT DISCIPLINE IN THE PIPELINE: tax treatment is NEVER an LLM
 * judgment. The Vision call provides a hint (`VisionClassification`); this pure
 * function decides. Every borderline output sets `requires_admin_confirmation`,
 * which blocks auto-publish until ADMIN verifies (ADR §7 borderline discipline).
 *
 * Covers:
 *   • §25c investment gold (bars ≥995, coins on whitelist or post-1800 + ≥900 +
 *     ≤80% markup),
 *   • §25a margin tax (jewelry, antiques, collector coins, watches),
 *   • §12 standard 19% (scrap candidates, bullion silver, unmatched).
 *
 * §13b reverse charge is a SALE-time invoice override, never an intake-time
 * classification (ADR §7 note) — intentionally not produced here.
 */

import type { LbmaSnapshot, TaxTreatmentResult, VisionClassification } from './types.js';

/**
 * Common karat → fineness (per 1000) lookup. Falls back to the exact
 * round(k/24·1000) for unusual karats. Also accepts explicit per-mille
 * markings ("585", "999", "999.9", "750/1000").
 */
const KARAT_TO_PER_MILLE: Record<number, number> = {
  8: 333,
  9: 375,
  10: 417,
  12: 500,
  14: 585,
  18: 750,
  20: 833,
  21: 875,
  22: 916,
  23: 958,
  24: 999,
};

export function karatToPurityPer1000(karat: string | null): number | null {
  if (karat === null) return null;
  const s = karat.trim().toLowerCase();
  if (s.length === 0) return null;

  // "14k", "14 kt", "14 karat"
  const karatMatch = s.match(/^(\d{1,2})\s*(k|kt|karat|kar)\b/);
  if (karatMatch?.[1]) {
    const k = Number(karatMatch[1]);
    if (k >= 1 && k <= 24) return KARAT_TO_PER_MILLE[k] ?? Math.round((k / 24) * 1000);
    return null;
  }

  // Explicit per-mille "585", "999", "750/1000", "999.9"
  const milleMatch = s.match(/^(\d{3})(?:\.\d+)?(?:\s*\/\s*1000)?$/);
  if (milleMatch?.[1]) {
    const v = Number(milleMatch[1]);
    if (v >= 1 && v <= 1000) return v;
  }
  return null;
}

/**
 * BMF/EU annual list of recognized investment-grade gold coins (a representative
 * V1 subset — extended per the yearly Verzeichnis without code changes).
 */
export const INVESTMENT_GRADE_COINS_WHITELIST: ReadonlySet<string> = new Set([
  'krugerrand',
  'maple_leaf',
  'american_eagle',
  'britannia',
  'wiener_philharmoniker',
  'australian_nugget',
  'australian_kangaroo',
  'china_panda',
  'mexican_libertad',
  'sovereign',
  'vreneli',
]);

const COIN_ALIASES: Record<string, string> = {
  krugerrand: 'krugerrand',
  kruger: 'krugerrand',
  maple: 'maple_leaf',
  'maple leaf': 'maple_leaf',
  mapleleaf: 'maple_leaf',
  eagle: 'american_eagle',
  'american eagle': 'american_eagle',
  britannia: 'britannia',
  philharmoniker: 'wiener_philharmoniker',
  'wiener philharmoniker': 'wiener_philharmoniker',
  philharmonic: 'wiener_philharmoniker',
  nugget: 'australian_nugget',
  kangaroo: 'australian_kangaroo',
  panda: 'china_panda',
  libertad: 'mexican_libertad',
  sovereign: 'sovereign',
  vreneli: 'vreneli',
};

/** Map the model's free-form coin hint onto a canonical id, or null. */
export function identifyCoin(vision: VisionClassification): string | null {
  const hint = vision.coin_hint?.trim().toLowerCase();
  if (!hint) return null;
  if (COIN_ALIASES[hint]) return COIN_ALIASES[hint];
  // Substring match for noisy hints like "1oz krugerrand 1974".
  for (const [alias, id] of Object.entries(COIN_ALIASES)) {
    if (hint.includes(alias)) return id;
  }
  return null;
}

export function estimateIssueYear(vision: VisionClassification): number | null {
  const y = vision.estimated_issue_year;
  return typeof y === 'number' && Number.isFinite(y) ? y : null;
}

/**
 * Markup of the observed market price over the coin's pure-gold content value,
 * as a fraction (0.25 = 25% over spot). Null when uncalculable.
 */
export function computeMarkupOverSpot(
  vision: VisionClassification,
  lbma: LbmaSnapshot,
): number | null {
  const price = vision.observed_market_price_eur;
  const grams = vision.estimated_fine_grams;
  const spot = lbma.goldEurPerGram;
  if (
    typeof price !== 'number' ||
    typeof grams !== 'number' ||
    spot === null ||
    grams <= 0 ||
    spot <= 0
  ) {
    return null;
  }
  const contentValue = grams * spot;
  if (contentValue <= 0) return null;
  return price / contentValue - 1;
}

/** Silver coin collector indicators: known mint or any hallmark/legend read. */
export function isCollectorSilver(vision: VisionClassification): boolean {
  if (vision.mint_hint && vision.mint_hint.trim().length > 0) return true;
  return vision.hallmarks_visible.length > 0;
}

export function classifyTaxTreatment(
  vision: VisionClassification,
  lbmaPriceCache: LbmaSnapshot,
): TaxTreatmentResult {
  const { item_type, karat_visible, hallmarks_visible, estimated_age_band, condition } = vision;
  const purity = karatToPurityPer1000(karat_visible);

  // Rule 1 — §25c Investment Gold: GOLD BARS (purity ≥ 995/1000).
  if (item_type === 'gold_bar') {
    if (purity !== null && purity >= 995) {
      return {
        code: 'INVESTMENT_GOLD_25C',
        explanation: `Gold bar with purity ${purity}/1000 ≥ 995 — §25c UStG investment gold (VAT exempt)`,
        confidence: 'high',
        requires_admin_confirmation: false,
        legal_reference: '§25c UStG Anlage 2 Nr. 1',
      };
    }
    return {
      code: 'STANDARD_19',
      explanation: `Gold bar with purity ${purity ?? 'unknown'}/1000 — below §25c threshold (995). Defaults to 19% standard VAT pending ADMIN verification of acquisition documents.`,
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference: '§25c UStG Anlage 2 Nr. 1 (negative)',
    };
  }

  // Rule 2 — §25c Investment Gold: GOLD COINS (whitelist, or explicit criteria).
  if (item_type === 'gold_coin') {
    const coinId = identifyCoin(vision);
    if (coinId && INVESTMENT_GRADE_COINS_WHITELIST.has(coinId)) {
      return {
        code: 'INVESTMENT_GOLD_25C',
        explanation: `Recognized investment-grade coin (${coinId}) on annual BMF/EU §25c list`,
        confidence: 'high',
        requires_admin_confirmation: false,
        legal_reference: '§25c UStG Anlage 2 Nr. 2 (Verzeichnis BMF)',
      };
    }

    const issueYearEst = estimateIssueYear(vision);
    const markupOverSpot = computeMarkupOverSpot(vision, lbmaPriceCache);

    if (
      issueYearEst !== null &&
      issueYearEst > 1800 &&
      purity !== null &&
      purity >= 900 &&
      markupOverSpot !== null &&
      markupOverSpot <= 0.8
    ) {
      return {
        code: 'INVESTMENT_GOLD_25C',
        explanation:
          `Coin post-1800 (est. ${issueYearEst}), purity ${purity}/1000 ≥ 900, ` +
          `market markup ${(markupOverSpot * 100).toFixed(0)}% ≤ 80% — meets §25c criteria`,
        confidence: 'medium',
        requires_admin_confirmation: true,
        legal_reference: '§25c UStG Anlage 2 Nr. 2 lit. b',
      };
    }

    return {
      code: 'MARGIN_25A',
      explanation: `Coin not on §25c whitelist and explicit criteria not met (year ${issueYearEst ?? 'unknown'}, purity ${purity ?? 'unknown'}/1000, markup ${markupOverSpot !== null ? `${(markupOverSpot * 100).toFixed(0)}%` : 'uncalculable'}) — treating as collector coin under §25a margin tax`,
      confidence: 'medium',
      requires_admin_confirmation: true,
      legal_reference: '§25a UStG',
    };
  }

  // Rule 3 — Worked jewelry with hallmark → §25a margin tax.
  if (item_type === 'gold_jewelry' || item_type === 'silver_jewelry') {
    const metalWord = item_type === 'gold_jewelry' ? 'gold' : 'silver';
    if (hallmarks_visible.length > 0 && condition !== 'poor') {
      return {
        code: 'MARGIN_25A',
        explanation: `Used ${metalWord} jewelry with hallmark, condition ${condition} — §25a margin tax (acquisition cost determines margin)`,
        confidence: 'high',
        requires_admin_confirmation: false,
        legal_reference: '§25a UStG Abs. 1',
      };
    }
    if (hallmarks_visible.length > 0 && condition === 'poor') {
      return {
        code: 'MARGIN_25A',
        explanation:
          'Hallmarked jewelry in poor condition — §25a candidate, but ADMIN to verify ' +
          'whether item is for resale (margin) or scrap melt (Rule 5).',
        confidence: 'low',
        requires_admin_confirmation: true,
        legal_reference: '§25a UStG Abs. 1 (borderline with §13b scrap)',
      };
    }
    // No hallmark → fall through to Rule 7 (scrap candidate).
  }

  // Rule 4 — Antiques (>100 years per BMF) → §25a, ADMIN verifies provenance.
  if (item_type === 'antique' && estimated_age_band === 'antique') {
    return {
      code: 'MARGIN_25A',
      explanation:
        'Antique (estimated >100y from visual cues) → §25a margin tax. ' +
        'Age estimate from photo only — ADMIN to verify provenance documentation.',
      confidence: 'medium',
      requires_admin_confirmation: true,
      legal_reference: '§25a UStG Abs. 1 (Antiquität, BMF Schreiben 28.11.2019)',
    };
  }

  // Rule 5 — Silver coins (not in §25c scope): collector → §25a, else 19%.
  if (item_type === 'silver_coin') {
    if (isCollectorSilver(vision)) {
      return {
        code: 'MARGIN_25A',
        explanation: 'Silver coin with collector/numismatic indicators → §25a margin tax',
        confidence: 'medium',
        requires_admin_confirmation: true,
        legal_reference: '§25a UStG (silver collector)',
      };
    }
    return {
      code: 'STANDARD_19',
      explanation: 'Silver coin without clear collector indicators → standard 19% VAT',
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference: '§12 Abs. 1 UStG (Standard)',
    };
  }

  // Rule 6 — Watches → §25a candidate (Wiederverkäufer assumed), ADMIN verifies.
  if (item_type === 'watch') {
    return {
      code: 'MARGIN_25A',
      explanation:
        'Watch resale → §25a margin tax candidate (Wiederverkäufer status assumed). ' +
        'ADMIN to verify acquisition documentation.',
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference: '§25a UStG',
    };
  }

  // Rule 7 — Unmarked jewelry → scrap-melt candidate, STANDARD_19 at intake.
  if (
    (item_type === 'gold_jewelry' || item_type === 'silver_jewelry') &&
    hallmarks_visible.length === 0
  ) {
    const metalWord = item_type === 'gold_jewelry' ? 'gold' : 'silver';
    return {
      code: 'STANDARD_19',
      explanation: `Unmarked ${metalWord} jewelry → scrap-melt candidate. Retail (B2C): standard 19% VAT. B2B sale to a Wiederverkäufer may trigger §13b reverse charge at sale time (not classified here). ADMIN to verify.`,
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference:
        '§12 Abs. 1 UStG (retail) / §13b UStG Abs. 2 Nr. 9 (B2B reverse charge — sale-time override)',
    };
  }

  // Rule 8 — Borderline / unknown / unmatched → safe default 19% + ADMIN review.
  return {
    code: 'STANDARD_19',
    explanation:
      'No matching tax-treatment rule. Defaulting to 19% standard pending ADMIN verification.',
    confidence: 'low',
    requires_admin_confirmation: true,
    legal_reference: '§12 Abs. 1 UStG (safe default)',
  };
}
