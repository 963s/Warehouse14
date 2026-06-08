/**
 * eBay state-machine domain client — Phase 2 Day 2.
 *
 *   transition(id, body)   — PATCH /api/products/:id/ebay-state
 *   history(id, query)     — GET   /api/products/:id/ebay-history
 *
 * Mirrors apps/api-cloud/src/schemas/products-ebay.ts. The 9-state lifecycle
 * matches the backend trigger from migration 0022.
 */

import type { ApiClient } from '../client.js';

export type EbayState =
  | 'ENTWURF'
  | 'GEPRUEFT'
  | 'ONLINE'
  | 'VERKAUFT'
  | 'BEZAHLT'
  | 'VERPACKT'
  | 'VERSENDET'
  | 'REKLAMIERT'
  | 'RETOURNIERT';

export const EBAY_STATE_ORDER: readonly EbayState[] = [
  'ENTWURF',
  'GEPRUEFT',
  'ONLINE',
  'VERKAUFT',
  'BEZAHLT',
  'VERPACKT',
  'VERSENDET',
  'REKLAMIERT',
  'RETOURNIERT',
];

export const EBAY_STATE_LABELS: Readonly<Record<EbayState, string>> = {
  ENTWURF: 'Entwurf',
  GEPRUEFT: 'Geprüft',
  ONLINE: 'Online',
  VERKAUFT: 'Verkauft',
  BEZAHLT: 'Bezahlt',
  VERPACKT: 'Verpackt',
  VERSENDET: 'Versendet',
  REKLAMIERT: 'Reklamiert',
  RETOURNIERT: 'Retourniert',
};

export const ALLOWED_EBAY_TRANSITIONS: Readonly<Record<string, readonly EbayState[]>> = {
  __NULL__: ['ENTWURF'],
  ENTWURF: ['GEPRUEFT'],
  GEPRUEFT: ['ONLINE', 'ENTWURF'],
  ONLINE: ['VERKAUFT', 'ENTWURF'],
  VERKAUFT: ['BEZAHLT', 'REKLAMIERT'],
  BEZAHLT: ['VERPACKT', 'REKLAMIERT'],
  VERPACKT: ['VERSENDET', 'REKLAMIERT'],
  VERSENDET: ['REKLAMIERT'],
  REKLAMIERT: ['RETOURNIERT', 'VERSENDET'],
  RETOURNIERT: [],
};

export type EbaySource = 'OWNER' | 'EBAY_WEBHOOK' | 'WORKER' | 'SYSTEM';

export type EbayInventorySideEffect =
  | 'AUTO_RESERVED'
  | 'IDEMPOTENT_NO_OP'
  | 'CONFLICT_LOCAL_RESERVATION'
  | 'CONFLICT_LOCAL_SOLD'
  | 'NONE';

export interface EbayTransitionBody {
  toState: EbayState;
  ebayOrderId?: string;
  notes?: string;
}

export interface EbayTransitionResponse {
  productId: string;
  fromState: EbayState | null;
  toState: EbayState;
  ebayStateChangedAt: string;
  inventorySideEffect: EbayInventorySideEffect;
}

export interface EbayHistoryRow {
  id: string;
  productId: string;
  fromState: EbayState | null;
  toState: EbayState;
  changedByUserId: string | null;
  changedBySource: EbaySource;
  ebayOrderId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface EbayHistoryQuery {
  limit?: number;
  offset?: number;
}

export interface EbayHistoryResponse {
  items: EbayHistoryRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * POST /api/products/:id/ebay-publish — the marketplace LISTING-PUSH (Epic D
 * #38). `configured=false` means EBAY_OAUTH_TOKEN is unset (token pending);
 * the UI shows a "token pending" toast instead of claiming a live listing.
 */
export interface EbayPublishResponse {
  productId: string;
  configured: boolean;
  published: boolean;
  offerId: string | null;
  listingId: string | null;
  /** German status / reason — safe to show the operator. */
  detail: string;
}

function buildQuery(q: EbayHistoryQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const ebayApi = {
  transition(
    client: ApiClient,
    productId: string,
    body: EbayTransitionBody,
  ): Promise<EbayTransitionResponse> {
    return client.request<EbayTransitionResponse>(
      'PATCH',
      `/api/products/${encodeURIComponent(productId)}/ebay-state`,
      body,
    );
  },
  history(
    client: ApiClient,
    productId: string,
    query: EbayHistoryQuery = {},
  ): Promise<EbayHistoryResponse> {
    return client.request<EbayHistoryResponse>(
      'GET',
      `/api/products/${encodeURIComponent(productId)}/ebay-history${buildQuery(query)}`,
    );
  },
  /**
   * Push the product to the eBay marketplace (Sell Inventory API). Resolves
   * `configured=false` (no live listing) when the eBay OAuth token is pending.
   */
  publish(client: ApiClient, productId: string): Promise<EbayPublishResponse> {
    return client.request<EbayPublishResponse>(
      'POST',
      `/api/products/${encodeURIComponent(productId)}/ebay-publish`,
    );
  },
};
