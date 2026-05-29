/**
 * storefront-catalog — public read-only catalog client (Phase 2.A).
 *
 * Consumed by the future Next.js storefront (warehouse14.de). The
 * methods here NEVER send credentials — they're meant to be safe to
 * call from any HTTP client (browser, CDN edge, server-side render).
 *
 * Endpoints (all under `/api/storefront/`):
 *   • GET /products              — paginated catalog
 *   • GET /products/:slug        — single product page
 *   • GET /categories            — public taxonomy tree
 *   • GET /locations             — pickup + JSON-LD LocalBusiness data
 *
 * The shapes here mirror the api-cloud TypeBox schemas EXACTLY — when
 * the backend adds a public field, this file changes too. NEVER add a
 * field here that isn't projected by the backend `toStorefrontProduct()`
 * MOAT (see `routes/storefront-catalog.ts`).
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// Product shapes
// ────────────────────────────────────────────────────────────────────────

export interface StorefrontProductCategoryRef {
  id: string;
  slug: string;
  nameDe: string;
}

export interface StorefrontProduct {
  id: string;
  slug: string | null;
  sku: string;
  name: string;
  descriptionDe: string | null;
  descriptionEn: string | null;
  seoTitle: string | null;
  seoTitleEn: string | null;
  seoDescription: string | null;
  seoDescriptionEn: string | null;
  schemaOrgType: string | null;
  listPriceEur: string;
  currency: 'EUR';
  yearMintedFrom: number | null;
  yearMintedTo: number | null;
  originCountry: string | null;
  period: string | null;
  catalogReference: string | null;
  metal: string | null;
  weightGrams: string | null;
  finenessDecimal: string | null;
  publishedAt: string | null;
  primaryCategory: StorefrontProductCategoryRef | null;
}

export interface StorefrontProductsQuery {
  limit?: number;
  offset?: number;
  category?: string;
  metal?: string;
  q?: string;
}

export interface StorefrontProductsResponse {
  items: StorefrontProduct[];
  total: number;
  limit: number;
  offset: number;
}

// ────────────────────────────────────────────────────────────────────────
// Category shapes
// ────────────────────────────────────────────────────────────────────────

export interface StorefrontCategoryNode {
  id: string;
  slug: string;
  nameDe: string;
  nameEn: string | null;
  descriptionDe: string | null;
  descriptionEn: string | null;
  schemaOrgType: string | null;
  children: StorefrontCategoryNode[];
}

export interface StorefrontCategoriesResponse {
  roots: StorefrontCategoryNode[];
}

// ────────────────────────────────────────────────────────────────────────
// Location shapes
// ────────────────────────────────────────────────────────────────────────

export interface StorefrontBusinessLocation {
  id: string;
  slug: string;
  name: string;
  addressLines: string[];
  city: string;
  postalCode: string;
  countryCode: string;
  publicPhone: string | null;
  publicEmail: string | null;
  latitude: number | null;
  longitude: number | null;
  openingHours: unknown;
  isPickupLocation: boolean;
}

export interface StorefrontLocationsResponse {
  items: StorefrontBusinessLocation[];
}

// ────────────────────────────────────────────────────────────────────────
// API surface
// ────────────────────────────────────────────────────────────────────────

function buildQueryString(query: StorefrontProductsQuery): string {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  if (query.category) params.set('category', query.category);
  if (query.metal) params.set('metal', query.metal);
  if (query.q) params.set('q', query.q);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const storefrontApi = {
  /**
   * Paginated public catalog. Equivalent to a no-auth fetch — the
   * underlying `ApiClient.request()` does not attach session cookies
   * for storefront endpoints (Tauri webview sets credentials='include',
   * but the Fastify router doesn't enforce auth on `/api/storefront/*`).
   */
  listProducts(
    client: ApiClient,
    query: StorefrontProductsQuery = {},
  ): Promise<StorefrontProductsResponse> {
    return client.request<StorefrontProductsResponse>(
      'GET',
      `/api/storefront/products${buildQueryString(query)}`,
    );
  },

  /** Single product page lookup by slug. 404 surfaces as ApiError. */
  getProductBySlug(client: ApiClient, slug: string): Promise<StorefrontProduct> {
    return client.request<StorefrontProduct>(
      'GET',
      `/api/storefront/products/${encodeURIComponent(slug)}`,
    );
  },

  /** Full taxonomy tree (storefront-visible only). Edge-cacheable. */
  listCategories(client: ApiClient): Promise<StorefrontCategoriesResponse> {
    return client.request<StorefrontCategoriesResponse>('GET', '/api/storefront/categories');
  },

  /** Active business locations for the storefront map + LocalBusiness JSON-LD. */
  listLocations(client: ApiClient): Promise<StorefrontLocationsResponse> {
    return client.request<StorefrontLocationsResponse>('GET', '/api/storefront/locations');
  },
};
