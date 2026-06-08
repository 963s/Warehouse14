import { describe, expect, it } from 'vitest';

import {
  EBAY_CONDITION_MAP,
  type EbayMappableProduct,
  formatEbayPrice,
  mapProductToInventoryItem,
  mapProductToOffer,
} from '../../src/lib/ebay/inventory-mapper.js';

// A realistic, fully-populated product the way products-detail surfaces it.
const PRODUCT: EbayMappableProduct = {
  id: '11111111-1111-1111-1111-111111111111',
  sku: 'GM-260608-A3F9',
  name: 'Goldmünze Krügerrand 1 oz',
  descriptionDe: 'Anlagemünze 999,9 Gold, Zustand sehr gut.',
  condition: 'USED_EXCELLENT',
  listPriceEur: '1850.00',
  weightGrams: '31.1030',
  photoUrls: [
    'https://api.warehouse14.de/api/photos/aaa/raw',
    'https://api.warehouse14.de/api/photos/bbb/raw',
  ],
};

describe('formatEbayPrice', () => {
  it('formats a NUMERIC(18,2) string as an eBay 2-decimal value WITHOUT float math', () => {
    expect(formatEbayPrice('1850.00')).toBe('1850.00');
    expect(formatEbayPrice('1850')).toBe('1850.00');
    expect(formatEbayPrice('1850.5')).toBe('1850.50');
    expect(formatEbayPrice('0.99')).toBe('0.99');
    // German comma is normalised to a dot.
    expect(formatEbayPrice('1850,00')).toBe('1850.00');
    // Thousands stay intact (no grouping separators emitted).
    expect(formatEbayPrice('12345.60')).toBe('12345.60');
  });

  it('throws on a non-money string rather than emitting NaN', () => {
    expect(() => formatEbayPrice('abc')).toThrow();
    expect(() => formatEbayPrice('')).toThrow();
  });
});

describe('EBAY_CONDITION_MAP', () => {
  it('maps every Warehouse14 condition to a valid eBay ConditionEnum', () => {
    expect(EBAY_CONDITION_MAP.NEW).toBe('NEW');
    expect(EBAY_CONDITION_MAP.USED_EXCELLENT).toBe('USED_EXCELLENT');
    expect(EBAY_CONDITION_MAP.USED_GOOD).toBe('USED_GOOD');
    expect(EBAY_CONDITION_MAP.USED_FAIR).toBe('USED_ACCEPTABLE');
    expect(EBAY_CONDITION_MAP.ANTIQUE_RESTORED).toBe('USED_GOOD');
    expect(EBAY_CONDITION_MAP.ANTIQUE_AS_FOUND).toBe('USED_ACCEPTABLE');
  });
});

describe('mapProductToInventoryItem', () => {
  it('maps title, description, condition and image URLs', () => {
    const item = mapProductToInventoryItem(PRODUCT);
    expect(item.condition).toBe('USED_EXCELLENT');
    expect(item.product.title).toBe('Goldmünze Krügerrand 1 oz');
    expect(item.product.description).toContain('Anlagemünze');
    expect(item.product.imageUrls).toEqual(PRODUCT.photoUrls);
    // Always exactly one unit for a unique item.
    expect(item.availability.shipToLocationAvailability.quantity).toBe(1);
  });

  it('truncates an over-long title to eBay’s 80-char cap', () => {
    const longName = 'X'.repeat(120);
    const item = mapProductToInventoryItem({ ...PRODUCT, name: longName });
    expect(item.product.title.length).toBe(80);
  });

  it('falls back to the SKU as the description when descriptionDe is null', () => {
    const item = mapProductToInventoryItem({ ...PRODUCT, descriptionDe: null });
    expect(item.product.description).toContain(PRODUCT.sku);
  });

  it('omits imageUrls entirely when the product has no photos (no empty array)', () => {
    const item = mapProductToInventoryItem({ ...PRODUCT, photoUrls: [] });
    expect(item.product.imageUrls).toBeUndefined();
  });
});

describe('mapProductToOffer', () => {
  it('maps the SKU, marketplace, EUR price and a single available quantity', () => {
    const offer = mapProductToOffer(PRODUCT, { marketplaceId: 'EBAY_DE' });
    expect(offer.sku).toBe(PRODUCT.sku);
    expect(offer.marketplaceId).toBe('EBAY_DE');
    expect(offer.format).toBe('FIXED_PRICE');
    expect(offer.availableQuantity).toBe(1);
    expect(offer.pricingSummary.price.currency).toBe('EUR');
    expect(offer.pricingSummary.price.value).toBe('1850.00');
  });

  it('passes through optional listing-policy + category ids when supplied', () => {
    const offer = mapProductToOffer(PRODUCT, {
      marketplaceId: 'EBAY_DE',
      merchantLocationKey: 'SCHORNDORF',
      categoryId: '39482',
      fulfillmentPolicyId: 'ful-1',
      paymentPolicyId: 'pay-1',
      returnPolicyId: 'ret-1',
    });
    expect(offer.merchantLocationKey).toBe('SCHORNDORF');
    expect(offer.categoryId).toBe('39482');
    expect(offer.listingPolicies).toEqual({
      fulfillmentPolicyId: 'ful-1',
      paymentPolicyId: 'pay-1',
      returnPolicyId: 'ret-1',
    });
  });

  it('omits listingPolicies when no policy ids are supplied', () => {
    const offer = mapProductToOffer(PRODUCT, { marketplaceId: 'EBAY_DE' });
    expect(offer.listingPolicies).toBeUndefined();
    expect(offer.categoryId).toBeUndefined();
  });
});
