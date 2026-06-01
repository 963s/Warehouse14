import { describe, expect, it } from 'vitest';

import { estimateDraftPrices } from './price-estimate.js';

describe('estimateDraftPrices', () => {
  it('estimates gold from melt: acquisition below, sale above', () => {
    // 10 fine grams × 60 €/g = 600 melt; buy 10% below = 540; sell 15% above = 690.
    const r = estimateDraftPrices({
      itemType: 'gold_jewelry',
      estimatedFineGrams: 10,
      observedMarketPriceEur: null,
      goldEurPerGram: 60,
      silverEurPerGram: 0.8,
    });
    expect(r.meltValueEur).toBe(600);
    expect(r.suggestedAcquisitionEur).toBe(540);
    expect(r.suggestedSaleEur).toBe(690);
  });

  it('uses silver spot for a silver item', () => {
    const r = estimateDraftPrices({
      itemType: 'silver_coin',
      estimatedFineGrams: 31.1,
      observedMarketPriceEur: null,
      goldEurPerGram: 60,
      silverEurPerGram: 0.8,
    });
    expect(r.meltValueEur).toBe(round2(31.1 * 0.8));
    expect(r.suggestedAcquisitionEur).not.toBeNull();
  });

  it('prefers an observed market price for the sale price', () => {
    const r = estimateDraftPrices({
      itemType: 'gold_coin',
      estimatedFineGrams: 7.32,
      observedMarketPriceEur: 520,
      goldEurPerGram: 60,
      silverEurPerGram: 0.8,
    });
    expect(r.suggestedSaleEur).toBe(520); // catalogue value wins over melt+markup
    expect(r.suggestedAcquisitionEur).toBe(round2(round2(7.32 * 60) * 0.9));
  });

  it('returns nulls for a non-metal item with no observed price', () => {
    const r = estimateDraftPrices({
      itemType: 'antique',
      estimatedFineGrams: null,
      observedMarketPriceEur: null,
      goldEurPerGram: 60,
      silverEurPerGram: 0.8,
    });
    expect(r.meltValueEur).toBeNull();
    expect(r.suggestedAcquisitionEur).toBeNull();
    expect(r.suggestedSaleEur).toBeNull();
  });

  it('still gives a sale price for a non-metal item when a market price is observed', () => {
    const r = estimateDraftPrices({
      itemType: 'watch',
      estimatedFineGrams: null,
      observedMarketPriceEur: 1200,
      goldEurPerGram: 60,
      silverEurPerGram: 0.8,
    });
    expect(r.suggestedSaleEur).toBe(1200);
    expect(r.suggestedAcquisitionEur).toBeNull();
  });

  it('returns null melt when spot is unavailable', () => {
    const r = estimateDraftPrices({
      itemType: 'gold_bar',
      estimatedFineGrams: 100,
      observedMarketPriceEur: null,
      goldEurPerGram: null,
      silverEurPerGram: null,
    });
    expect(r.meltValueEur).toBeNull();
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
