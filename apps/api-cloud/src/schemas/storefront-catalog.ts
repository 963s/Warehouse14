/**
 * Storefront catalog response schemas — Phase 2.A (memory.md §20).
 *
 * Public-facing shapes for the FUTURE Next.js storefront. Distinct from
 * the admin schemas (product.ts, category.ts, ...) for three reasons:
 *
 *   1. Field exclusion is hard-coded — we never project
 *      `acquisition_cost_eur`, `margin_eur`, or PII into a public
 *      response. Mixing admin + public schemas would risk accidental
 *      exposure through a missed `.pick()`.
 *
 *   2. Cache-friendliness — every field is a primitive serializable
 *      shape (string / number / boolean / null / array of same).
 *      No Date objects, no Decimal.js, no BigInt.
 *
 *   3. SEO completeness — slug + schema_org_type + minted-year band are
 *      first-class. The Next.js page can render JSON-LD without an
 *      extra fetch.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString } from './money.js';

// ────────────────────────────────────────────────────────────────────────
// Product — public catalog item
// ────────────────────────────────────────────────────────────────────────

/**
 * One row in the public catalog. Strictly omits:
 *   • acquisitionCostEur     — internal cost, never public
 *   • marginEur              — derived from cost, never public
 *   • reserved_by_*          — internal lock envelope
 *   • notes_internal         — operator-only
 *   • intake_session_id      — operational provenance
 *   • cumulative_*           — customer-side aggregates
 *   • Any DSGVO / KYC linkage
 */
export const StorefrontProduct = Type.Object({
  /** Stable UUID — used as the JSON-LD `@id` URL fragment. */
  id: Type.String({ format: 'uuid' }),
  /**
   * SEO-friendly URL slug. May be `null` for legacy rows; the storefront
   * falls back to `/artikel/p-${sku}` when null.
   */
  slug: Type.Union([Type.String(), Type.Null()]),
  /** SKU — visible on the listing for catalog reference. NOT a sales lead. */
  sku: Type.String(),
  /** Display name (German). The English title is `seoTitleEn` when set. */
  name: Type.String(),
  /** Free-form German description. Renders as the page body. */
  descriptionDe: Type.Union([Type.String(), Type.Null()]),
  descriptionEn: Type.Union([Type.String(), Type.Null()]),
  /** SEO meta title (<= 60 chars typically). Renders in <title>. */
  seoTitle: Type.Union([Type.String(), Type.Null()]),
  seoTitleEn: Type.Union([Type.String(), Type.Null()]),
  /** Meta description for SERP snippets. */
  seoDescription: Type.Union([Type.String(), Type.Null()]),
  seoDescriptionEn: Type.Union([Type.String(), Type.Null()]),
  /**
   * schema.org type tag — `Product` / `Coin` / `CollectibleProduct` etc.
   * Drives JSON-LD generation on the page.
   */
  schemaOrgType: Type.Union([Type.String(), Type.Null()]),

  /** Public price in EUR (Decimal string — never a JS number). */
  listPriceEur: DecimalString,
  /** ISO-4217 currency. Always 'EUR' for V1; reserved for multi-currency. */
  currency: Type.Literal('EUR'),

  // ─── Collector / numismatic facets — drive faceted search on /sammlung ───
  yearMintedFrom: Type.Union([Type.Integer(), Type.Null()]),
  yearMintedTo: Type.Union([Type.Integer(), Type.Null()]),
  /** ISO 3166-1 alpha-2 origin country code. */
  originCountry: Type.Union([Type.String({ minLength: 2, maxLength: 2 }), Type.Null()]),
  period: Type.Union([Type.String(), Type.Null()]),
  catalogReference: Type.Union([Type.String(), Type.Null()]),

  // ─── Material — drives Edelmetall facet. NULL for non-metal items. ───
  metal: Type.Union([Type.String(), Type.Null()]),
  weightGrams: Type.Union([DecimalString, Type.Null()]),
  finenessDecimal: Type.Union([DecimalString, Type.Null()]),

  /** ISO timestamp — first publication. Drives sitemap.lastmod. */
  publishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),

  /**
   * Primary category ref — drives the breadcrumb on the product page.
   * NULL for un-categorised rows (rare; backfill is operator-driven).
   */
  primaryCategory: Type.Union([
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      slug: Type.String(),
      nameDe: Type.String(),
    }),
    Type.Null(),
  ]),
});
export type StorefrontProduct = Static<typeof StorefrontProduct>;

export const StorefrontProductsResponse = Type.Object({
  items: Type.Array(StorefrontProduct),
  total: Type.Integer({ minimum: 0 }),
  /** Echo of the request's `limit` for pagination UX. */
  limit: Type.Integer({ minimum: 1, maximum: 100 }),
  /** Echo of the request's `offset`. */
  offset: Type.Integer({ minimum: 0 }),
});
export type StorefrontProductsResponse = Static<typeof StorefrontProductsResponse>;

// ────────────────────────────────────────────────────────────────────────
// Category — public taxonomy
// ────────────────────────────────────────────────────────────────────────

/**
 * Hierarchical category node, public projection. Excludes:
 *   • `hidden_from_storefront` rows (filtered in the SQL WHERE clause)
 *   • Admin-only audit columns (`created_at`, `updated_at`)
 */
export type StorefrontCategoryNode = {
  id: string;
  slug: string;
  nameDe: string;
  nameEn: string | null;
  descriptionDe: string | null;
  descriptionEn: string | null;
  schemaOrgType: string | null;
  /** Recursive — V1 ships a 2-level cap, so depth ≤ 2 in practice. */
  children: StorefrontCategoryNode[];
};

const StorefrontCategoryNodeRef = Type.Recursive(
  (Self) =>
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      slug: Type.String(),
      nameDe: Type.String(),
      nameEn: Type.Union([Type.String(), Type.Null()]),
      descriptionDe: Type.Union([Type.String(), Type.Null()]),
      descriptionEn: Type.Union([Type.String(), Type.Null()]),
      schemaOrgType: Type.Union([Type.String(), Type.Null()]),
      children: Type.Array(Self),
    }),
  { $id: 'StorefrontCategoryNode' },
);
export { StorefrontCategoryNodeRef as StorefrontCategoryNode };

export const StorefrontCategoriesResponse = Type.Object({
  roots: Type.Array(StorefrontCategoryNodeRef),
});
export type StorefrontCategoriesResponse = Static<typeof StorefrontCategoriesResponse>;

// ────────────────────────────────────────────────────────────────────────
// Business location — public "where can I pick up / visit" lookup
// ────────────────────────────────────────────────────────────────────────

export const StorefrontBusinessLocation = Type.Object({
  id: Type.String({ format: 'uuid' }),
  slug: Type.String(),
  name: Type.String(),
  /** Free-form display address (street + zip + city + country code). */
  addressLines: Type.Array(Type.String()),
  city: Type.String(),
  postalCode: Type.String(),
  countryCode: Type.String({ minLength: 2, maxLength: 2 }),
  /** Public-facing phone (NEVER the operator's mobile). */
  publicPhone: Type.Union([Type.String(), Type.Null()]),
  publicEmail: Type.Union([Type.String(), Type.Null()]),
  /** Latitude / longitude — drives a Google Maps embed. */
  latitude: Type.Union([Type.Number(), Type.Null()]),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  /** Free-form opening hours payload — Next.js renders verbatim. */
  openingHours: Type.Union([Type.Unknown(), Type.Null()]),
  /** True ⇒ customers can collect online orders here. */
  isPickupLocation: Type.Boolean(),
});
export type StorefrontBusinessLocation = Static<typeof StorefrontBusinessLocation>;

export const StorefrontLocationsResponse = Type.Object({
  items: Type.Array(StorefrontBusinessLocation),
});
export type StorefrontLocationsResponse = Static<typeof StorefrontLocationsResponse>;
