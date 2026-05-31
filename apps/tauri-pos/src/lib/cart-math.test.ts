import { describe, expect, it } from 'vitest';

import { classifyCartProductTax } from './cart-math.js';

/** Product shape `classifyCartProductTax` consumes, with sensible defaults. */
type ClassifyInput = Parameters<typeof classifyCartProductTax>[0];

function product(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    itemType: 'other',
    finenessDecimal: null,
    acquiredFromCustomerId: null,
    isCommission: false,
    ...overrides,
  };
}

describe('classifyCartProductTax — §25c investment gold', () => {
  it('classifies a 99.9% gold bar as INVESTMENT_GOLD_25C', () => {
    expect(
      classifyCartProductTax(product({ itemType: 'gold_bar', finenessDecimal: '0.9990' })),
    ).toBe('INVESTMENT_GOLD_25C');
  });

  it('classifies a ≥90% gold coin minted after 1800 as INVESTMENT_GOLD_25C', () => {
    expect(
      classifyCartProductTax(
        product({ itemType: 'gold_coin', finenessDecimal: '0.9170', yearMintedFrom: 1820 }),
      ),
    ).toBe('INVESTMENT_GOLD_25C');
  });

  it('keeps an investment-grade coin as §25c even when bought second-hand', () => {
    // A modern bullion coin acquired from a private seller is still §25c, not §25a.
    expect(
      classifyCartProductTax(
        product({
          itemType: 'gold_coin',
          finenessDecimal: '0.9999',
          yearMintedFrom: 2015,
          acquiredFromCustomerId: 'cust-1',
        }),
      ),
    ).toBe('INVESTMENT_GOLD_25C');
  });
});

describe('classifyCartProductTax — non-investment gold coins', () => {
  it('falls back to MARGIN_25A for a low-purity second-hand coin', () => {
    expect(
      classifyCartProductTax(
        product({
          itemType: 'gold_coin',
          finenessDecimal: '0.5850', // < 0.90 → not investment grade
          yearMintedFrom: 1900,
          acquiredFromCustomerId: 'cust-1',
        }),
      ),
    ).toBe('MARGIN_25A');
  });

  it('falls back to MARGIN_25A for a pre-1800 second-hand coin (even if pure)', () => {
    expect(
      classifyCartProductTax(
        product({
          itemType: 'gold_coin',
          finenessDecimal: '0.9170',
          yearMintedFrom: 1750, // minted before 1800 → not investment grade
          isCommission: true,
        }),
      ),
    ).toBe('MARGIN_25A');
  });

  it('falls back to STANDARD_19 for a pre-1800 coin that is NOT second-hand', () => {
    expect(
      classifyCartProductTax(
        product({ itemType: 'gold_coin', finenessDecimal: '0.9170', yearMintedFrom: 1750 }),
      ),
    ).toBe('STANDARD_19');
  });

  it('falls back to STANDARD_19 for a coin with no minting year recorded', () => {
    expect(
      classifyCartProductTax(
        product({ itemType: 'gold_coin', finenessDecimal: '0.9999', yearMintedFrom: null }),
      ),
    ).toBe('STANDARD_19');
  });
});

describe('classifyCartProductTax — §25a margin scheme', () => {
  it('classifies a second-hand watch bought from a private seller as MARGIN_25A', () => {
    expect(
      classifyCartProductTax(product({ itemType: 'watch', acquiredFromCustomerId: 'cust-1' })),
    ).toBe('MARGIN_25A');
  });

  it('classifies a commission item as MARGIN_25A', () => {
    expect(classifyCartProductTax(product({ itemType: 'antique', isCommission: true }))).toBe(
      'MARGIN_25A',
    );
  });
});

describe('classifyCartProductTax — STANDARD_19 fallback', () => {
  it('classifies industrial/scrap gold (not second-hand, sub-investment) as STANDARD_19', () => {
    expect(
      classifyCartProductTax(product({ itemType: 'gold_bar', finenessDecimal: '0.3330' })),
    ).toBe('STANDARD_19');
  });

  it('classifies a brand-new (first-hand) eligible item as STANDARD_19', () => {
    // A watch the shop bought new from a wholesaler: eligible TYPE, but not
    // second-hand → no §25a margin scheme.
    expect(classifyCartProductTax(product({ itemType: 'watch' }))).toBe('STANDARD_19');
  });
});
