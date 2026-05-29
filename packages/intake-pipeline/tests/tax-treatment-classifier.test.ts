import { describe, expect, it } from 'vitest';

import {
  CONDITIONS,
  type Condition,
  ITEM_TYPES,
  type ItemType,
  type LbmaSnapshot,
  type TaxTreatmentCode,
  type VisionClassification,
  classifyTaxTreatment,
  karatToPurityPer1000,
} from '../src/index.js';
import { intBetween, maybe, mulberry32, pick } from './fuzz.js';

const LBMA: LbmaSnapshot = {
  goldEurPerGram: 70.0,
  silverEurPerGram: 0.85,
  asOf: '2026-05-29T00:00:00Z',
};

const VALID_CODES: ReadonlySet<TaxTreatmentCode> = new Set([
  'INVESTMENT_GOLD_25C',
  'MARGIN_25A',
  'STANDARD_19',
]);

const KARAT_TOKENS = [
  '8K',
  '14K',
  '18K',
  '22K',
  '24K',
  '585',
  '750',
  '900',
  '916',
  '999',
  'junk',
  '',
];
const COIN_HINTS = ['krugerrand', 'maple leaf', 'sovereign', 'random token', 'bottlecap', ''];
const AGE_BANDS = ['modern', 'vintage', 'antique'] as const;

function genVision(rng: () => number): VisionClassification {
  const item_type = pick(rng, ITEM_TYPES) as ItemType;
  const hallmarkCount = intBetween(rng, 0, 3);
  const hallmarks = Array.from({ length: hallmarkCount }, (_, i) => `HM${i}`);
  return {
    item_type,
    karat_visible: pick(rng, KARAT_TOKENS) || null,
    hallmarks_visible: hallmarks,
    estimated_age_band: maybe(rng, pick(rng, AGE_BANDS), 0.8),
    condition: pick(rng, CONDITIONS) as Condition,
    coin_hint: maybe(rng, pick(rng, COIN_HINTS), 0.7),
    estimated_issue_year: maybe(rng, intBetween(rng, 1700, 2025), 0.6),
    estimated_fine_grams: maybe(rng, intBetween(rng, 1, 100), 0.6),
    observed_market_price_eur: maybe(rng, intBetween(rng, 50, 5000), 0.6),
    mint_hint: maybe(rng, 'Royal Mint', 0.3),
  };
}

describe('karatToPurityPer1000', () => {
  it('maps common karats and per-mille markings', () => {
    expect(karatToPurityPer1000('14K')).toBe(585);
    expect(karatToPurityPer1000('24k')).toBe(999);
    expect(karatToPurityPer1000('999')).toBe(999);
    expect(karatToPurityPer1000('750/1000')).toBe(750);
    expect(karatToPurityPer1000('585')).toBe(585);
    expect(karatToPurityPer1000(null)).toBeNull();
    expect(karatToPurityPer1000('junk')).toBeNull();
  });
});

describe('classifyTaxTreatment — property-based (600 fuzzed inputs)', () => {
  it('never throws, always returns a valid code, and is deterministic', () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 600; i++) {
      const v = genVision(rng);
      const a = classifyTaxTreatment(v, LBMA);
      const b = classifyTaxTreatment(v, LBMA);
      expect(VALID_CODES.has(a.code)).toBe(true);
      expect(typeof a.requires_admin_confirmation).toBe('boolean');
      expect(a.legal_reference.length).toBeGreaterThan(0);
      expect(a.explanation.length).toBeGreaterThan(0);
      // Determinism: same input → identical output.
      expect(b).toEqual(a);
      // Only gold bars/coins may ever be classified investment gold.
      if (a.code === 'INVESTMENT_GOLD_25C') {
        expect(v.item_type === 'gold_bar' || v.item_type === 'gold_coin').toBe(true);
      }
      // Safe-confidence invariant: a no-confirmation result is always 'high'.
      if (!a.requires_admin_confirmation) {
        expect(a.confidence).toBe('high');
      }
    }
  });
});

describe('classifyTaxTreatment — targeted rules', () => {
  const base: VisionClassification = {
    item_type: 'other',
    karat_visible: null,
    hallmarks_visible: [],
    estimated_age_band: null,
    condition: 'good',
  };

  it('Rule 1: gold bar ≥995 → INVESTMENT_GOLD_25C, no admin confirm', () => {
    const r = classifyTaxTreatment({ ...base, item_type: 'gold_bar', karat_visible: '999' }, LBMA);
    expect(r.code).toBe('INVESTMENT_GOLD_25C');
    expect(r.requires_admin_confirmation).toBe(false);
  });

  it('Rule 1: gold bar below 995 → STANDARD_19 + admin confirm', () => {
    const r = classifyTaxTreatment({ ...base, item_type: 'gold_bar', karat_visible: '14K' }, LBMA);
    expect(r.code).toBe('STANDARD_19');
    expect(r.requires_admin_confirmation).toBe(true);
  });

  it('Rule 2a: whitelisted coin → INVESTMENT_GOLD_25C', () => {
    const r = classifyTaxTreatment(
      { ...base, item_type: 'gold_coin', coin_hint: 'krugerrand' },
      LBMA,
    );
    expect(r.code).toBe('INVESTMENT_GOLD_25C');
    expect(r.requires_admin_confirmation).toBe(false);
  });

  it('Rule 2b: post-1800, ≥900, ≤80% markup → INVESTMENT_GOLD_25C (needs confirm)', () => {
    const r = classifyTaxTreatment(
      {
        ...base,
        item_type: 'gold_coin',
        coin_hint: 'unknown',
        karat_visible: '916',
        estimated_issue_year: 1910,
        estimated_fine_grams: 7,
        observed_market_price_eur: 600, // content ~490 → ~22% markup
      },
      LBMA,
    );
    expect(r.code).toBe('INVESTMENT_GOLD_25C');
    expect(r.requires_admin_confirmation).toBe(true);
  });

  it('Rule 2: unknown coin not meeting criteria → MARGIN_25A', () => {
    const r = classifyTaxTreatment(
      { ...base, item_type: 'gold_coin', coin_hint: 'mystery', karat_visible: '585' },
      LBMA,
    );
    expect(r.code).toBe('MARGIN_25A');
  });

  it('Rule 3: hallmarked gold jewelry in good condition → MARGIN_25A high', () => {
    const r = classifyTaxTreatment(
      { ...base, item_type: 'gold_jewelry', hallmarks_visible: ['750'], condition: 'good' },
      LBMA,
    );
    expect(r.code).toBe('MARGIN_25A');
    expect(r.requires_admin_confirmation).toBe(false);
  });

  it('Rule 7: unmarked gold jewelry → STANDARD_19 scrap candidate', () => {
    const r = classifyTaxTreatment(
      { ...base, item_type: 'gold_jewelry', hallmarks_visible: [] },
      LBMA,
    );
    expect(r.code).toBe('STANDARD_19');
    expect(r.requires_admin_confirmation).toBe(true);
  });

  it('Rule 4: antique → MARGIN_25A needs provenance confirm', () => {
    const r = classifyTaxTreatment(
      { ...base, item_type: 'antique', estimated_age_band: 'antique' },
      LBMA,
    );
    expect(r.code).toBe('MARGIN_25A');
    expect(r.requires_admin_confirmation).toBe(true);
  });

  it('Rule 5: bullion silver coin → STANDARD_19; collector → MARGIN_25A', () => {
    expect(classifyTaxTreatment({ ...base, item_type: 'silver_coin' }, LBMA).code).toBe(
      'STANDARD_19',
    );
    expect(
      classifyTaxTreatment({ ...base, item_type: 'silver_coin', mint_hint: 'Royal Mint' }, LBMA)
        .code,
    ).toBe('MARGIN_25A');
  });

  it('Rule 6: watch → MARGIN_25A candidate', () => {
    expect(classifyTaxTreatment({ ...base, item_type: 'watch' }, LBMA).code).toBe('MARGIN_25A');
  });

  it('Rule 8: unmatched → STANDARD_19 safe default', () => {
    const r = classifyTaxTreatment({ ...base, item_type: 'other' }, LBMA);
    expect(r.code).toBe('STANDARD_19');
    expect(r.requires_admin_confirmation).toBe(true);
  });
});
