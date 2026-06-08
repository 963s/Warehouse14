/**
 * Pure Warehouse14-product → eBay Sell Inventory API payload mapping (Epic D,
 * #38 — the LISTING-PUSH path).
 *
 * The eBay Sell Inventory API splits a listing into two resources:
 *   • InventoryItem  (createOrReplaceInventoryItem, keyed by SKU) — the item:
 *     title, description, condition, photos, available quantity.
 *   • Offer          (createOffer → publishOffer)               — the listing:
 *     marketplace, price, format, category, business policies.
 *
 * These functions are PURE (no IO) so the mapping is unit-testable without any
 * network or token. The HTTP client (`sell-client.ts`) consumes their output.
 *
 * Money rule (memory.md): list_price_eur is a NUMERIC(18,2) decimal STRING. We
 * format it to eBay's 2-decimal value via integer-cents string math — never
 * parseFloat/Number(...).toFixed, which would lose precision on large prices.
 */

// ── eBay enums (subset we use) ──────────────────────────────────────────────

/** eBay ConditionEnum values valid for the Sell Inventory API. */
export type EbayCondition =
  | 'NEW'
  | 'LIKE_NEW'
  | 'USED_EXCELLENT'
  | 'USED_VERY_GOOD'
  | 'USED_GOOD'
  | 'USED_ACCEPTABLE';

/** Warehouse14 product.condition → eBay ConditionEnum. */
export const EBAY_CONDITION_MAP: Readonly<Record<string, EbayCondition>> = {
  NEW: 'NEW',
  USED_EXCELLENT: 'USED_EXCELLENT',
  USED_GOOD: 'USED_GOOD',
  USED_FAIR: 'USED_ACCEPTABLE',
  // Antiques are always "used" on eBay; map restored→good, as-found→acceptable.
  ANTIQUE_RESTORED: 'USED_GOOD',
  ANTIQUE_AS_FOUND: 'USED_ACCEPTABLE',
};

/** eBay marketplace id — Germany is the only target for this shop. */
export type EbayMarketplaceId = 'EBAY_DE';

/** eBay caps the listing title at 80 characters. */
const EBAY_TITLE_MAX = 80;

// ── Input shape (a slice of products-detail) ────────────────────────────────

export interface EbayMappableProduct {
  id: string;
  sku: string;
  name: string;
  descriptionDe: string | null;
  /** Warehouse14 condition enum value. */
  condition: string;
  /** NUMERIC(18,2) decimal string, e.g. "1850.00". */
  listPriceEur: string;
  weightGrams: string | null;
  /** Absolute, publicly-reachable photo URLs (eBay must be able to GET them). */
  photoUrls: string[];
}

// ── eBay payload shapes (subset) ────────────────────────────────────────────

export interface EbayInventoryItemPayload {
  condition: EbayCondition;
  product: {
    title: string;
    description: string;
    imageUrls?: string[];
  };
  availability: {
    shipToLocationAvailability: { quantity: number };
  };
}

export interface EbayOfferPayload {
  sku: string;
  marketplaceId: EbayMarketplaceId;
  format: 'FIXED_PRICE';
  availableQuantity: number;
  categoryId?: string;
  merchantLocationKey?: string;
  pricingSummary: {
    price: { value: string; currency: 'EUR' };
  };
  listingPolicies?: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
  };
}

export interface OfferMappingOptions {
  marketplaceId: EbayMarketplaceId;
  categoryId?: string;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
}

// ── Money formatting (integer-cents string math, no float) ──────────────────

/**
 * Format a NUMERIC(18,2)-style decimal string (dot OR German comma) into eBay's
 * canonical `"<integer>.<two-decimals>"` value. Implemented as pure string
 * arithmetic so a 7-figure price never round-trips through a float.
 */
export function formatEbayPrice(decimal: string): string {
  const trimmed = decimal.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid money string for eBay price: "${decimal}"`);
  }
  const [intPart, fracRaw = ''] = trimmed.split('.');
  // Pad / truncate the fractional part to exactly two digits (no rounding —
  // list_price_eur already carries at most 2 decimals from NUMERIC(18,2)).
  const frac = `${fracRaw}00`.slice(0, 2);
  return `${intPart}.${frac}`;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

export function mapProductToInventoryItem(product: EbayMappableProduct): EbayInventoryItemPayload {
  const condition = EBAY_CONDITION_MAP[product.condition] ?? 'USED_GOOD';
  const title = product.name.trim().slice(0, EBAY_TITLE_MAX);
  const description =
    product.descriptionDe && product.descriptionDe.trim().length > 0
      ? product.descriptionDe.trim()
      : `${product.name} (${product.sku})`;

  const item: EbayInventoryItemPayload = {
    condition,
    product: { title, description },
    availability: { shipToLocationAvailability: { quantity: 1 } },
  };
  // Only attach imageUrls when there is at least one — eBay rejects an empty
  // array, and the route can then surface a "needs photos" hint instead.
  if (product.photoUrls.length > 0) {
    item.product.imageUrls = product.photoUrls;
  }
  return item;
}

export function mapProductToOffer(
  product: EbayMappableProduct,
  opts: OfferMappingOptions,
): EbayOfferPayload {
  const offer: EbayOfferPayload = {
    sku: product.sku,
    marketplaceId: opts.marketplaceId,
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    pricingSummary: {
      price: { value: formatEbayPrice(product.listPriceEur), currency: 'EUR' },
    },
  };
  if (opts.categoryId) offer.categoryId = opts.categoryId;
  if (opts.merchantLocationKey) offer.merchantLocationKey = opts.merchantLocationKey;
  // eBay requires ALL THREE business policies together or none — only attach
  // the block when the full triple is configured.
  if (opts.fulfillmentPolicyId && opts.paymentPolicyId && opts.returnPolicyId) {
    offer.listingPolicies = {
      fulfillmentPolicyId: opts.fulfillmentPolicyId,
      paymentPolicyId: opts.paymentPolicyId,
      returnPolicyId: opts.returnPolicyId,
    };
  }
  return offer;
}
