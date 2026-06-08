/**
 * eBay Sell Inventory API client (Epic D, #38 — the LISTING-PUSH path).
 *
 * This is the OUTBOUND publish path: it takes a Warehouse14 product and creates
 * a live eBay listing through the modern REST Sell Inventory API (JSON + OAuth
 * Bearer), which is distinct from the legacy Trading API `EndItem` XML call in
 * `ebay-client.ts` (that one only DELISTS on a counter sale).
 *
 * The three-step publish sequence (eBay's required order for a unique item):
 *   1. PUT  /sell/inventory/v1/inventory_item/{sku}        — createOrReplace
 *   2. POST /sell/inventory/v1/offer                        — createOffer → offerId
 *   3. POST /sell/inventory/v1/offer/{offerId}/publish      — go live → listingId
 *
 * HONEST STUB CONTRACT (mirrors r2.ts / dhl-client.ts): when the OAuth token is
 * empty (the real token stays with Basel until go-live), this returns a clear
 * `{ configured: false, published: false }` result and makes NO HTTP call — it
 * never crashes the checkout/listing flow. The route turns that into a German
 * "token pending" toast.
 *
 * INBOUND SYNC (orders/sold-status flowing back FROM eBay) is OUT OF SCOPE for
 * this track — see the TODO at the bottom of the file.
 */

import {
  type EbayMappableProduct,
  type EbayMarketplaceId,
  type OfferMappingOptions,
  mapProductToInventoryItem,
  mapProductToOffer,
} from './inventory-mapper.js';

export type EbaySellFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

export interface EbaySellConfig {
  /** eBay user OAuth token (Bearer). Empty → not configured (honest stub). */
  oauthToken: string;
  marketplaceId: EbayMarketplaceId;
  /** API base, e.g. https://api.ebay.com (prod) or https://api.sandbox.ebay.com. */
  baseUrl: string;
}

export interface EbaySellClientOptions {
  fetchImpl?: EbaySellFetch;
}

/** Listing-level options the route fills from system_settings (all optional). */
export interface EbayPublishOptions {
  categoryId?: string;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
}

export interface EbayPublishResult {
  /** False when no OAuth token is configured (honest stub — no HTTP made). */
  configured: boolean;
  /** True only when publishOffer succeeded and the listing is live. */
  published: boolean;
  offerId: string | null;
  listingId: string | null;
  /** Human-readable German status / reason — safe for the event payload + toast. */
  detail: string;
}

const defaultFetch: EbaySellFetch = (input, init) => fetch(input, init as RequestInit | undefined);

export function isEbaySellConfigured(config: EbaySellConfig): boolean {
  return config.oauthToken.trim().length > 0;
}

function authHeaders(config: EbaySellConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.oauthToken}`,
    'Content-Type': 'application/json',
    // The Sell Inventory API requires Content-Language for the listing locale.
    'Content-Language': 'de-DE',
    'X-EBAY-C-MARKETPLACE-ID': config.marketplaceId,
  };
}

/** Trim a provider error body for the event payload (never store it whole). */
async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * Publish a product to eBay via the 3-step Sell Inventory sequence.
 *
 * Resolves `{ configured: false }` (no HTTP) when the token is empty; resolves
 * `{ published: true, offerId, listingId }` on success; throws on a
 * configured-but-failing call so the route can surface the failure honestly.
 */
export async function publishProductToEbay(
  config: EbaySellConfig,
  product: EbayMappableProduct,
  publishOpts: EbayPublishOptions,
  clientOpts: EbaySellClientOptions = {},
): Promise<EbayPublishResult> {
  if (!isEbaySellConfigured(config)) {
    return {
      configured: false,
      published: false,
      offerId: null,
      listingId: null,
      detail: 'eBay-Zugang noch nicht konfiguriert (OAuth-Token ausstehend).',
    };
  }

  const fetchImpl = clientOpts.fetchImpl ?? defaultFetch;
  const base = config.baseUrl.replace(/\/+$/, '');
  const headers = authHeaders(config);
  const sku = encodeURIComponent(product.sku);

  // ── 1. createOrReplaceInventoryItem ───────────────────────────────────────
  const inventoryItem = mapProductToInventoryItem(product);
  const invRes = await fetchImpl(`${base}/sell/inventory/v1/inventory_item/${sku}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(inventoryItem),
  });
  if (!invRes.ok) {
    throw new Error(
      `eBay createOrReplaceInventoryItem failed: HTTP ${invRes.status} ${await readErrorDetail(invRes)}`,
    );
  }

  // ── 2. createOffer ────────────────────────────────────────────────────────
  const offerMapping: OfferMappingOptions = {
    marketplaceId: config.marketplaceId,
    ...(publishOpts.categoryId ? { categoryId: publishOpts.categoryId } : {}),
    ...(publishOpts.merchantLocationKey
      ? { merchantLocationKey: publishOpts.merchantLocationKey }
      : {}),
    ...(publishOpts.fulfillmentPolicyId
      ? { fulfillmentPolicyId: publishOpts.fulfillmentPolicyId }
      : {}),
    ...(publishOpts.paymentPolicyId ? { paymentPolicyId: publishOpts.paymentPolicyId } : {}),
    ...(publishOpts.returnPolicyId ? { returnPolicyId: publishOpts.returnPolicyId } : {}),
  };
  const offerPayload = mapProductToOffer(product, offerMapping);
  const offerRes = await fetchImpl(`${base}/sell/inventory/v1/offer`, {
    method: 'POST',
    headers,
    body: JSON.stringify(offerPayload),
  });
  if (!offerRes.ok) {
    throw new Error(
      `eBay createOffer failed: HTTP ${offerRes.status} ${await readErrorDetail(offerRes)}`,
    );
  }
  const offerData = (await offerRes.json()) as { offerId?: string };
  const offerId = offerData.offerId;
  if (!offerId) {
    throw new Error('eBay createOffer returned no offerId');
  }

  // ── 3. publishOffer ───────────────────────────────────────────────────────
  const pubRes = await fetchImpl(
    `${base}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    { method: 'POST', headers },
  );
  if (!pubRes.ok) {
    throw new Error(
      `eBay publishOffer failed: HTTP ${pubRes.status} ${await readErrorDetail(pubRes)}`,
    );
  }
  const pubData = (await pubRes.json()) as { listingId?: string };

  return {
    configured: true,
    published: true,
    offerId,
    listingId: pubData.listingId ?? null,
    detail: `Live bei eBay: Angebot ${offerId}${pubData.listingId ? `, Listing ${pubData.listingId}` : ''}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TODO (#38 — INBOUND SYNC, OUT OF SCOPE for this push-only track):
//   Pull eBay order + listing-status changes BACK into Warehouse14 — e.g. an
//   eBay-sold webhook / getOrders poll that drives the product into ebay_state
//   'VERKAUFT' and RESERVES the local unique item via the EBAY channel. That is
//   the mirror of `ebay-sync.ts` (which only ENDS listings on a counter sale).
//   Build it as a worker job + a signed eBay Marketplace Account Deletion /
//   notification webhook route; do NOT bolt it onto this synchronous push path.
// ─────────────────────────────────────────────────────────────────────────────
