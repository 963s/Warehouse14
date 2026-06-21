/**
 * TypeBox schemas for the unified catalog: GET /api/products (Day 17).
 *
 * Shared query surface for:
 *   • POS (Tauri) — filter by status=AVAILABLE, search by SKU/name.
 *   • Storefront (Next.js) — filter by listed_on_storefront=TRUE + status=AVAILABLE.
 *   • Control Desktop (Bridge) — full filter surface, including archived rows.
 *
 * Pagination: limit (max 200) + offset. cursor pagination is a Phase 1.5
 * optimization; for single-shop volumes limit/offset is fine.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString, WeightString } from './money.js';
import { ItemType, ProductCondition, StampErhaltung } from './product.js';

export const ProductStatus = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('AVAILABLE'),
  Type.Literal('RESERVED'),
  Type.Literal('SOLD'),
]);

export const ProductListQuery = Type.Object({
  // Filters — all optional, ANDed together.
  status: Type.Optional(ProductStatus),
  condition: Type.Optional(ProductCondition),
  itemType: Type.Optional(ItemType),
  isCommission: Type.Optional(Type.Boolean()),
  listedOnStorefront: Type.Optional(Type.Boolean()),
  /**
   * Legacy operator-intent flag (`products.listed_on_ebay`). Flipped TRUE only
   * by a real marketplace publish; it does NOT track enrollment in the 9-stage
   * listing state machine. To filter the eBay pipeline by "is this row in the
   * state machine", use `enrolledOnEbay` instead.
   */
  listedOnEbay: Type.Optional(Type.Boolean()),
  /**
   * Enrollment in the eBay listing state machine, keyed off `products.ebay_state`:
   *   TRUE  → ebay_state IS NOT NULL (the row sits somewhere in the pipeline,
   *           ENTWURF…RETOURNIERT), regardless of `listed_on_ebay`.
   *   FALSE → ebay_state IS NULL (never enrolled — a candidate to einbuchen).
   *   omitted → no filter.
   * Distinct from `listedOnEbay`: a row can be enrolled (ENTWURF) long before a
   * marketplace publish ever flips `listed_on_ebay`.
   */
  enrolledOnEbay: Type.Optional(Type.Boolean()),
  /** TRUE = only archived; FALSE = only active; omitted = both. */
  archived: Type.Optional(Type.Boolean()),
  /** EUR price range (inclusive). NUMERIC(18,2) strings. */
  priceMin: Type.Optional(DecimalString),
  priceMax: Type.Optional(DecimalString),
  /** Free-text search over name + description_de + sku + barcode (ILIKE). */
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  /**
   * Exact match against `products.barcode` — used by the Lager surface's
   * USB-barcode-scanner integration (Day 9). Distinct from `q` which is
   * substring-ILIKE; barcode scans need exact-match semantics so the
   * scanner pinpoints a single row.
   */
  barcode: Type.Optional(Type.String({ maxLength: 64 })),

  // Pagination
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});
export type ProductListQuery = Static<typeof ProductListQuery>;

/** Lightweight product summary — what the catalog list returns per row. */
export const ProductListItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sku: Type.String(),
  /** Day-13 addition: SEO-friendly slug for URL routing. NULL until set. */
  slug: Type.Union([Type.String(), Type.Null()]),
  /** Day-13 addition: primary category ref (storefront breadcrumb hint). */
  primaryCategory: Type.Union([
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      slug: Type.String(),
      nameDe: Type.String(),
    }),
    Type.Null(),
  ]),
  /** Day-9 addition: surfaced so the Lager table column + scanner UI can show. */
  barcode: Type.Union([Type.String(), Type.Null()]),
  /**
   * Primary product photo THUMB rendition, as a relative API path
   * (`/api/photos/<id>/thumb`) — same shape as routes/photos.ts serializePhoto,
   * minus the host. Only emitted for `storage_kind='local'` rows that are
   * flagged `is_primary`; NULL when the product has no local primary photo.
   * The POS prefixes it with its api-client baseUrl to render the catalog tile
   * image (the /thumb route is public-by-UUID, so an `<img>` can load it).
   */
  primaryPhotoThumbUrl: Type.Union([Type.String(), Type.Null()]),
  status: ProductStatus,
  condition: ProductCondition,
  itemType: ItemType,
  metal: Type.Union([
    Type.Literal('gold'),
    Type.Literal('silver'),
    Type.Literal('platinum'),
    Type.Literal('palladium'),
    Type.Null(),
  ]),
  weightGrams: Type.Union([WeightString, Type.Null()]),
  listPriceEur: DecimalString,
  name: Type.String(),
  descriptionDe: Type.Union([Type.String(), Type.Null()]),
  // ─── Migration 0063: Briefmarken + collector facts for the POS tile ──
  /** Erhaltung: POSTFRISCH (**), FALZ (*), GESTEMPELT (,), AUF_BRIEF. NULL für Nicht-Briefmarken. */
  stampErhaltung: Type.Union([StampErhaltung, Type.Null()]),
  /** Michel-Katalognummer (MiNr.) — display "MiNr. 27 · Postfrisch". */
  stampMinr: Type.Union([Type.Integer(), Type.Null()]),
  yearMintedFrom: Type.Union([Type.Integer(), Type.Null()]),
  yearMintedTo: Type.Union([Type.Integer(), Type.Null()]),
  originCountry: Type.Union([Type.String(), Type.Null()]),
  period: Type.Union([Type.String(), Type.Null()]),
  catalogReference: Type.Union([Type.String(), Type.Null()]),
  listedOnStorefront: Type.Boolean(),
  listedOnEbay: Type.Boolean(),
  isCommission: Type.Boolean(),
  /** Day-9 additions: location fields for the Lager Lagerort column. */
  locationStorageUnit: Type.Union([Type.String(), Type.Null()]),
  locationDrawer: Type.Union([Type.String(), Type.Null()]),
  locationPosition: Type.Union([Type.String(), Type.Null()]),
  archivedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});
export type ProductListItem = Static<typeof ProductListItem>;

export const ProductListResponse = Type.Object({
  items: Type.Array(ProductListItem),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});
export type ProductListResponse = Static<typeof ProductListResponse>;
