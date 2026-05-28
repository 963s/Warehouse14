/**
 * Products domain client. Mirrors the routes from products-list.ts (Day 17)
 * + products-detail.ts (Day 7, post-Freeze additive read) + products.ts PUT.
 *
 *   list(query)  — GET /api/products             paged + filtered
 *   get(id)      — GET /api/products/:id         full record with cost
 *   update(id,b) — PUT /api/products/:id         partial update (Day-13 SEO ok)
 *   reserve(body)— POST /api/inventory/reserve   atomic, race-safe
 *   release(body)— POST /api/inventory/release   session-id-guarded
 *
 * Day 13 (Phase 2.B) additions:
 *   • ProductListRow gains `slug` + `primaryCategory` (breadcrumb hint).
 *   • ProductDetail surfaces full SEO + collector metadata + `categories[]`.
 *   • UpdateProductBody accepts the 13 NULL-able SEO/collector fields so
 *     the Owner can curate them after creation.
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// Common types
// ────────────────────────────────────────────────────────────────────────

export type ProductStatus = 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';
export type Metal = 'gold' | 'silver' | 'platinum' | 'palladium';
export type ReservationChannel = 'POS' | 'STOREFRONT' | 'EBAY';
export type ReleaseReason =
  | 'storefront_checkout_abandoned'
  | 'storefront_payment_failed'
  | 'ebay_offer_rejected'
  | 'pos_cart_cleared'
  | 'admin_manual_release';

/** TaxTreatmentCode values seeded in migration 0005. */
export type TaxTreatmentCode =
  | 'MARGIN_25A'
  | 'INVESTMENT_GOLD_25C'
  | 'STANDARD_19'
  | 'REDUCED_7';

// ────────────────────────────────────────────────────────────────────────
// GET /api/products (list)
// ────────────────────────────────────────────────────────────────────────

/** Lightweight breadcrumb hint surfaced on every list row (Day 13). */
export interface PrimaryCategoryRef {
  id: string;
  slug: string;
  nameDe: string;
}

export interface ProductListRow {
  id: string;
  sku: string;
  /** Day-13 addition: SEO-friendly slug for URL routing. NULL until set. */
  slug: string | null;
  /** Day-13 addition: primary category (storefront breadcrumb hint). */
  primaryCategory: PrimaryCategoryRef | null;
  /** Day-9 addition: surfaced for Lager table + barcode-scanner pinpointing. */
  barcode: string | null;
  status: ProductStatus;
  condition: string;
  itemType: string;
  metal: Metal | null;
  weightGrams: string | null;
  listPriceEur: string;
  name: string;
  descriptionDe: string | null;
  listedOnStorefront: boolean;
  listedOnEbay: boolean;
  isCommission: boolean;
  /** Day-9 additions: Lagerort triplet for the Lager table. */
  locationStorageUnit: string | null;
  locationDrawer: string | null;
  locationPosition: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface ProductListResponse {
  items: ProductListRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ProductListQuery {
  status?: ProductStatus;
  itemType?: string;
  isCommission?: boolean;
  listedOnStorefront?: boolean;
  listedOnEbay?: boolean;
  archived?: boolean;
  priceMin?: string;
  priceMax?: string;
  q?: string;
  /** Day-9 addition: exact-match barcode lookup (USB-scanner pinpoint). */
  barcode?: string;
  limit?: number;
  offset?: number;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/inventory-adjustment — Day 9 additive route
// ────────────────────────────────────────────────────────────────────────

export type InventoryAdjustmentReason =
  | 'LOCATION_CHANGE'
  | 'LOST'
  | 'DAMAGED'
  | 'FOUND'
  | 'OPERATOR_NOTE';

export interface InventoryAdjustmentBody {
  reason: InventoryAdjustmentReason;
  /** Mandatory operator rationale, min 8 chars. */
  notes: string;
  /** Only meaningful for reason='LOCATION_CHANGE'. */
  locationStorageUnit?: string;
  locationDrawer?: string;
  locationPosition?: string;
}

export interface InventoryAdjustmentResponse {
  productId: string;
  reason: InventoryAdjustmentReason;
  auditLogId: string;
  loggedAt: string;
  locationStorageUnit: string | null;
  locationDrawer: string | null;
  locationPosition: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id (detail — Day 7 + Day-13 extensions)
// ────────────────────────────────────────────────────────────────────────

/** One row of the product's category assignment list (Day 13). */
export interface ProductCategoryAssignment {
  id: string;
  slug: string;
  nameDe: string;
  nameEn: string | null;
  isPrimary: boolean;
}

export interface ProductDetail {
  id: string;
  sku: string;
  /** Day-13 addition: SEO slug. NULL until set. */
  slug: string | null;
  barcode: string | null;
  status: ProductStatus;
  condition: string;
  itemType: string;
  metal: Metal | null;
  karatCode: string | null;
  finenessDecimal: string | null;
  weightGrams: string | null;
  feingewichtGrams: string | null;
  taxTreatmentCode: string;
  acquisitionCostEur: string;
  listPriceEur: string;
  collectorPremiumEur: string | null;
  name: string;
  descriptionDe: string | null;
  /** Day-13 i18n addition for storefront EN locale. */
  descriptionEn: string | null;
  // ─── Day-13 SEO surface ────────────────────────────────────────────
  seoTitle: string | null;
  seoDescription: string | null;
  seoTitleEn: string | null;
  seoDescriptionEn: string | null;
  schemaOrgType: string | null;
  // ─── Day-13 collector metadata ─────────────────────────────────────
  yearMintedFrom: number | null;
  yearMintedTo: number | null;
  /** ISO-3166-1 alpha-2 (e.g. "DE", "CH"). */
  originCountry: string | null;
  period: string | null;
  catalogReference: string | null;
  provenanceNotes: string | null;
  // ─── Channel flags ─────────────────────────────────────────────────
  isCommission: boolean;
  listedOnStorefront: boolean;
  listedOnEbay: boolean;
  /**
   * Phase 2.A / Day-14 — storefront publication gate. TRUE means the
   * row is visible at warehouse14.de (provided `status='AVAILABLE'`).
   * Flip via `productsApi.update(id, { isPublishedToWeb: true|false })`.
   */
  isPublishedToWeb: boolean;
  /**
   * Current eBay listing state. NULL means the row was never enrolled.
   * Mutated via `ebayApi.transition(id, { toState })`.
   */
  ebayState:
    | 'ENTWURF'
    | 'GEPRUEFT'
    | 'ONLINE'
    | 'VERKAUFT'
    | 'BEZAHLT'
    | 'VERPACKT'
    | 'VERSENDET'
    | 'REKLAMIERT'
    | 'RETOURNIERT'
    | null;
  ebayStateChangedAt: string | null;
  parentProductId: string | null;
  locationStorageUnit: string | null;
  locationDrawer: string | null;
  locationPosition: string | null;
  /** Day-13 addition: every taxonomy node this product is filed under. */
  categories: ProductCategoryAssignment[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// PUT /api/products/:id (Day 13 — SEO/collector fields editable post-create)
// ────────────────────────────────────────────────────────────────────────

export interface ProductUpdateBody {
  // Existing PUT-allowed fields (intake-locked fields refused by backend).
  condition?: string;
  listPriceEur?: string;
  name?: string;
  descriptionDe?: string;
  marketingAttributes?: unknown[];
  listedOnStorefront?: boolean;
  listedOnEbay?: boolean;
  /**
   * Phase 2.A / Day-14 — flip storefront visibility. Backend trigger
   * `on_products_publish_to_web` stamps `publishedAt` on the first
   * TRUE flip; subsequent toggles keep the original timestamp.
   */
  isPublishedToWeb?: boolean;
  /** DRAFT → AVAILABLE only; SOLD/RESERVED via inventory routes. */
  status?: 'DRAFT' | 'AVAILABLE';

  // ─── Day-13 SEO + collector metadata extensions ────────────────────
  // Send `null` to clear a previously-set value.
  slug?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoTitleEn?: string | null;
  seoDescriptionEn?: string | null;
  schemaOrgType?: string | null;
  yearMintedFrom?: number | null;
  yearMintedTo?: number | null;
  originCountry?: string | null;
  period?: string | null;
  catalogReference?: string | null;
  provenanceNotes?: string | null;
  descriptionEn?: string | null;
}

export interface ProductUpdateResponse {
  id: string;
  updatedAt: string;
  /** Echo of fields whose values actually changed (server-side diff). */
  changedFields: string[];
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/inventory/reserve / release
// ────────────────────────────────────────────────────────────────────────

export interface ReserveBody {
  productId: string;
  channel: ReservationChannel;
  sessionId: string;
}

export interface ReserveResponse {
  productId: string;
  channel: ReservationChannel;
  sessionId: string;
  userId: string | null;
  reservedAt: string;
  expiresAt: string | null;
}

export interface ReleaseBody {
  productId: string;
  sessionId: string;
  reason: ReleaseReason;
}

export interface ReleaseResponse {
  productId: string;
  releasedAt: string;
  reason: ReleaseReason;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

function buildQuery(query: ProductListQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const productsApi = {
  list(client: ApiClient, query: ProductListQuery = {}): Promise<ProductListResponse> {
    return client.request<ProductListResponse>(
      'GET',
      `/api/products${buildQuery(query)}`,
    );
  },
  get(client: ApiClient, id: string): Promise<ProductDetail> {
    return client.request<ProductDetail>(
      'GET',
      `/api/products/${encodeURIComponent(id)}`,
    );
  },
  update(
    client: ApiClient,
    id: string,
    body: ProductUpdateBody,
  ): Promise<ProductUpdateResponse> {
    return client.request<ProductUpdateResponse>(
      'PUT',
      `/api/products/${encodeURIComponent(id)}`,
      body,
    );
  },
  reserve(client: ApiClient, body: ReserveBody): Promise<ReserveResponse> {
    return client.request<ReserveResponse>('POST', '/api/inventory/reserve', body);
  },
  release(client: ApiClient, body: ReleaseBody): Promise<ReleaseResponse> {
    return client.request<ReleaseResponse>('POST', '/api/inventory/release', body);
  },
  adjustInventory(
    client: ApiClient,
    productId: string,
    body: InventoryAdjustmentBody,
  ): Promise<InventoryAdjustmentResponse> {
    return client.request<InventoryAdjustmentResponse>(
      'POST',
      `/api/products/${encodeURIComponent(productId)}/inventory-adjustment`,
      body,
    );
  },
};
