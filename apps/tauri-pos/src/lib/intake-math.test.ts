/**
 * intake-math — the Ankauf Schmelzwert valuation (UX §4.2). No facade: a
 * missing rate yields NO suggestion (null, never NaN/fake-0); decimal-safe
 * bigint-cents; German comma tolerated. The buy-rate decision is explicit.
 */
import { describe, expect, it } from 'vitest';

import {
  computeSchmelzwertEur,
  finenessDecimalForPerMille,
  metalFromItemType,
  suggestedBuyEur,
} from './intake-math.js';

describe('computeSchmelzwertEur', () => {
  it('gold 10 g × 585/1000 × 60 €/g = 351,00 €', () => {
    expect(
      computeSchmelzwertEur({
        metal: 'gold',
        weightGrams: '10',
        finenessDecimal: '0.585',
        pricePerGramEur: '60.00',
      }),
    ).toBe('351.00');
  });

  it('tolerates the German comma in weight + fineness', () => {
    expect(
      computeSchmelzwertEur({
        metal: 'gold',
        weightGrams: '10,0',
        finenessDecimal: '0,585',
        pricePerGramEur: '60.00',
      }),
    ).toBe('351.00');
  });

  it('missing rate / metal / weight → null (no NaN, no fake 0)', () => {
    expect(
      computeSchmelzwertEur({ metal: 'gold', weightGrams: '10', finenessDecimal: '0.585', pricePerGramEur: null }),
    ).toBeNull();
    expect(
      computeSchmelzwertEur({ metal: null, weightGrams: '10', finenessDecimal: '0.585', pricePerGramEur: '60' }),
    ).toBeNull();
    expect(
      computeSchmelzwertEur({ metal: 'gold', weightGrams: '', finenessDecimal: '0.585', pricePerGramEur: '60' }),
    ).toBeNull();
  });
});

describe('metalFromItemType', () => {
  it('infers the metal from the prefix; non-metal → null', () => {
    expect(metalFromItemType('gold_coin')).toBe('gold');
    expect(metalFromItemType('silver_jewelry')).toBe('silver');
    expect(metalFromItemType('platinum_bar')).toBe('platinum');
    expect(metalFromItemType('palladium_bar')).toBe('palladium');
    expect(metalFromItemType('watch')).toBeNull();
    expect(metalFromItemType('antique')).toBeNull();
    expect(metalFromItemType('other')).toBeNull();
  });
});

describe('finenessDecimalForPerMille', () => {
  it('585 → "0.585", 999 → "0.999"', () => {
    expect(finenessDecimalForPerMille(585)).toBe('0.585');
    expect(finenessDecimalForPerMille(999)).toBe('0.999');
    expect(finenessDecimalForPerMille(925)).toBe('0.925');
  });
});

describe('suggestedBuyEur (buy-rate decision)', () => {
  const base = { metal: 'gold' as const, weightGrams: '10', finenessDecimal: '0.585' };

  it('uses the ankauf rate when present (basis ankauf)', () => {
    const r = suggestedBuyEur({
      ...base,
      ankaufRatePerGramEur: '54.00',
      currentRatePerGramEur: '60.00',
      safetyMarginPct: 0.1,
    });
    expect(r.basis).toBe('ankauf');
    expect(r.value).toBe('315.90'); // 10 × 0.585 × 54
  });

  it('falls back to current × (1 − margin) when no ankauf rate (basis margin)', () => {
    const r = suggestedBuyEur({
      ...base,
      ankaufRatePerGramEur: null,
      currentRatePerGramEur: '60.00',
      safetyMarginPct: 0.1,
    });
    expect(r.basis).toBe('margin');
    expect(r.value).toBe('315.90'); // melt 351,00 × 0,9
  });

  it('no rate at all → none / null', () => {
    const r = suggestedBuyEur({
      ...base,
      ankaufRatePerGramEur: null,
      currentRatePerGramEur: null,
      safetyMarginPct: 0.1,
    });
    expect(r.basis).toBe('none');
    expect(r.value).toBeNull();
  });
});
