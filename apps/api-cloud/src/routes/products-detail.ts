/**
 * GET /api/products/:id — single-product detail.
 *
 * Why this exists separately from the list endpoint (Day 17):
 *   • The list endpoint omits `acquisitionCostEur` for a small response
 *     and to keep purchase-cost out of catalog projections.
 *   • The Verkauf cart needs `acquisitionCostEur` to compute §25a margin
 *     math client-side (memory.md #76 + Day 7 audit).
 *
 * Day 13 (Phase 2.B) additions:
 *   • SEO + collector metadata fields (slug, seoTitle, schemaOrgType, …)
 *     so the Owner-facing detail screen can edit them in one shot.
 *   • categories[] — every taxonomy node the product is filed under,
 *     with `isPrimary` flag so the breadcrumb hint is unambiguous.
 *
 * Pure-read route. No migration impact — the Day-13 fields are NULL-able
 * additions; the new categories[] is fetched via a batched JOIN.
 * ADMIN + CASHIER may read.
 */

import { Type } from '@sinclair/typebox';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  categories as categoriesTable,
  productCategories as productCategoriesTable,
  products,
} from '@warehouse14/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const Params = Type.Object({ id: Type.String({ format: 'uuid' }) });

const CategoryAssignment = Type.Object({
  id: Type.String({ format: 'uuid' }),
  slug: Type.String(),
  nameDe: Type.String(),
  nameEn: Type.Union([Type.String(), Type.Null()]),
  isPrimary: Type.Boolean(),
});

const ProductDetail = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sku: Type.String(),
  /** Day-13 addition: SEO-friendly slug. NULL until set. */
  slug: Type.Union([Type.String(), Type.Null()]),
  barcode: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal('DRAFT'),
    Type.Literal('AVAILABLE'),
    Type.Literal('RESERVED'),
    Type.Literal('SOLD'),
  ]),
  condition: Type.String(),
  itemType: Type.String(),
  metal: Type.Union([
    Type.Literal('gold'),
    Type.Literal('silver'),
    Type.Literal('platinum'),
    Type.Literal('palladium'),
    Type.Null(),
  ]),
  karatCode: Type.Union([Type.String(), Type.Null()]),
  finenessDecimal: Type.Union([Type.String(), Type.Null()]),
  weightGrams: Type.Union([Type.String(), Type.Null()]),
  feingewichtGrams: Type.Union([Type.String(), Type.Null()]),
  taxTreatmentCode: Type.String(),
  acquisitionCostEur: Type.String(),
  listPriceEur: Type.String(),
  collectorPremiumEur: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  descriptionDe: Type.Union([Type.String(), Type.Null()]),
  /** Day-13 addition: English narrative (storefront i18n hook). */
  descriptionEn: Type.Union([Type.String(), Type.Null()]),
  // ─── Day-13 SEO surface ────────────────────────────────────────────
  seoTitle: Type.Union([Type.String(), Type.Null()]),
  seoDescription: Type.Union([Type.String(), Type.Null()]),
  seoTitleEn: Type.Union([Type.String(), Type.Null()]),
  seoDescriptionEn: Type.Union([Type.String(), Type.Null()]),
  schemaOrgType: Type.Union([Type.String(), Type.Null()]),
  // ─── Day-13 collector metadata ─────────────────────────────────────
  yearMintedFrom: Type.Union([Type.Integer(), Type.Null()]),
  yearMintedTo: Type.Union([Type.Integer(), Type.Null()]),
  originCountry: Type.Union([Type.String(), Type.Null()]),
  period: Type.Union([Type.String(), Type.Null()]),
  catalogReference: Type.Union([Type.String(), Type.Null()]),
  provenanceNotes: Type.Union([Type.String(), Type.Null()]),
  // ─── Channel flags ─────────────────────────────────────────────────
  isCommission: Type.Boolean(),
  listedOnStorefront: Type.Boolean(),
  listedOnEbay: Type.Boolean(),
  /**
   * Phase 2.A / Day-14 storefront gate. TRUE = visible at warehouse14.de
   * when `status='AVAILABLE'`. FALSE hides instantly.
   */
  isPublishedToWeb: Type.Boolean(),
  /**
   * Current eBay listing state. NULL means the row was never enrolled in
   * the eBay workflow. Mutated only via PATCH /api/products/:id/ebay-state.
   */
  ebayState: Type.Union([
    Type.Literal('ENTWURF'),
    Type.Literal('GEPRUEFT'),
    Type.Literal('ONLINE'),
    Type.Literal('VERKAUFT'),
    Type.Literal('BEZAHLT'),
    Type.Literal('VERPACKT'),
    Type.Literal('VERSENDET'),
    Type.Literal('REKLAMIERT'),
    Type.Literal('RETOURNIERT'),
    Type.Null(),
  ]),
  ebayStateChangedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  parentProductId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  locationStorageUnit: Type.Union([Type.String(), Type.Null()]),
  locationDrawer: Type.Union([Type.String(), Type.Null()]),
  locationPosition: Type.Union([Type.String(), Type.Null()]),
  // ─── Day-13 categories — primary first, then alphabetical ──────────
  categories: Type.Array(CategoryAssignment),
  archivedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const productsDetailRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    '/api/products/:id',
    {
      schema: {
        tags: ['products'],
        summary: 'Full product detail — used by Verkauf cart for §25a math.',
        description:
          'Returns the product row plus its category assignments. The Day-13 ' +
          'SEO + collector fields are NULL-able and may be edited via PUT.',
        params: Params,
        response: {
          200: ProductDetail,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // Two parallel queries — product row + its category assignments.
      // Independent, so issue both at once for round-trip latency.
      const [productRows, categoryRows] = await Promise.all([
        app.db.select().from(products).where(eq(products.id, req.params.id)).limit(1),
        app.db
          .select({
            id: categoriesTable.id,
            slug: categoriesTable.slug,
            nameDe: categoriesTable.nameDe,
            nameEn: categoriesTable.nameEn,
            isPrimary: productCategoriesTable.isPrimary,
          })
          .from(productCategoriesTable)
          .innerJoin(categoriesTable, eq(productCategoriesTable.categoryId, categoriesTable.id))
          .where(eq(productCategoriesTable.productId, req.params.id))
          .orderBy(asc(categoriesTable.nameDe)),
      ]);

      const row = productRows[0];
      if (!row) throw new ProductNotFoundError(`Product ${req.params.id} not found`);

      // Primary first, then alphabetical — keeps the breadcrumb hint stable.
      const categories = [...categoryRows].sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.nameDe.localeCompare(b.nameDe, 'de');
      });

      return reply.status(200).send({
        id: row.id,
        sku: row.sku,
        slug: row.slug,
        barcode: row.barcode,
        status: row.status,
        condition: row.condition,
        itemType: row.itemType,
        metal: row.metal as 'gold' | 'silver' | 'platinum' | 'palladium' | null,
        karatCode: row.karatCode,
        finenessDecimal: row.finenessDecimal,
        weightGrams: row.weightGrams,
        feingewichtGrams: row.feingewichtGrams,
        taxTreatmentCode: row.taxTreatmentCode,
        acquisitionCostEur: row.acquisitionCostEur,
        listPriceEur: row.listPriceEur,
        collectorPremiumEur: row.collectorPremiumEur,
        name: row.name,
        descriptionDe: row.descriptionDe,
        descriptionEn: row.descriptionEn,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        seoTitleEn: row.seoTitleEn,
        seoDescriptionEn: row.seoDescriptionEn,
        schemaOrgType: row.schemaOrgType,
        yearMintedFrom: row.yearMintedFrom,
        yearMintedTo: row.yearMintedTo,
        originCountry: row.originCountry,
        period: row.period,
        catalogReference: row.catalogReference,
        provenanceNotes: row.provenanceNotes,
        isCommission: row.isCommission,
        listedOnStorefront: row.listedOnStorefront,
        listedOnEbay: row.listedOnEbay,
        // Phase 2.A / Day-14: storefront publication gate.
        isPublishedToWeb: row.isPublishedToWeb,
        ebayState: row.ebayState,
        ebayStateChangedAt: row.ebayStateChangedAt ? row.ebayStateChangedAt.toISOString() : null,
        parentProductId: row.parentProductId,
        locationStorageUnit: row.locationStorageUnit,
        locationDrawer: row.locationDrawer,
        locationPosition: row.locationPosition,
        categories,
        archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    },
  );
};

export default productsDetailRoute;
