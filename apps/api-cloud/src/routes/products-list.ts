/**
 * GET /api/products — unified product catalog (Day 17).
 *
 * Serves POS + Storefront SSR + Control Desktop with one filter surface.
 * Each client picks the subset of filters relevant to its UX:
 *   • POS cashier: status=AVAILABLE, archived=false, q=<barcode|sku|name>
 *   • Storefront:  status=AVAILABLE, listedOnStorefront=true, archived=false
 *   • Bridge:      no filters (default) — sees everything
 *
 * Gatekeepers: requireAuth + requireRole('ADMIN','CASHIER'). The public
 * storefront uses a separate (un-authenticated) route that lands in Phase 1.5
 * — V1 storefront is server-rendered with a long-lived ADMIN token.
 */

import {
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  categories as categoriesTable,
  productCategories as productCategoriesTable,
  products,
} from '@warehouse14/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  ProductListQuery,
  ProductListResponse,
  type ProductListQuery as TProductListQuery,
} from '../schemas/product-list.js';

const productsListRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TProductListQuery }>(
    '/api/products',
    {
      schema: {
        tags: ['products'],
        summary: 'Catalog search + filter (paged).',
        description:
          'Unified catalog feed for POS, Storefront, and Control Desktop. ' +
          'Filters AND together. q searches name + description_de (ILIKE). ' +
          'Returns lightweight rows; use GET /api/products/:id for the full record.',
        querystring: ProductListQuery,
        response: { 200: ProductListResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;

      // Build WHERE clauses dynamically — Drizzle's `and(...preds)` ignores undefined.
      const preds: Array<SQL | undefined> = [
        q.status !== undefined ? eq(products.status, q.status) : undefined,
        q.condition !== undefined ? eq(products.condition, q.condition) : undefined,
        q.itemType !== undefined ? eq(products.itemType, q.itemType) : undefined,
        q.isCommission !== undefined ? eq(products.isCommission, q.isCommission) : undefined,
        q.listedOnStorefront !== undefined
          ? eq(products.listedOnStorefront, q.listedOnStorefront)
          : undefined,
        q.listedOnEbay !== undefined ? eq(products.listedOnEbay, q.listedOnEbay) : undefined,
        // archived: TRUE = archived only; FALSE = active only; undefined = both.
        q.archived === true
          ? sql`${products.archivedAt} IS NOT NULL`
          : q.archived === false
            ? sql`${products.archivedAt} IS NULL`
            : undefined,
        q.priceMin !== undefined ? gte(products.listPriceEur, q.priceMin) : undefined,
        q.priceMax !== undefined ? lte(products.listPriceEur, q.priceMax) : undefined,
        // Free-text search — name OR description_de OR sku OR barcode, ILIKE.
        q.q !== undefined && q.q.length > 0
          ? or(
              ilike(products.name, `%${q.q}%`),
              ilike(products.descriptionDe, `%${q.q}%`),
              ilike(products.sku, `%${q.q}%`),
              ilike(products.barcode, `%${q.q}%`),
            )
          : undefined,
        // Exact-match barcode lookup — Day-9 USB-scanner pinpoint.
        q.barcode !== undefined && q.barcode.length > 0
          ? eq(products.barcode, q.barcode)
          : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      // Two queries: one for the page, one for the total. They are issued in
      // parallel for latency. For a single-shop catalog this is fine; storefront
      // ISR cache absorbs the count cost.
      const [rows, totalRow] = await Promise.all([
        app.db
          .select({
            id: products.id,
            sku: products.sku,
            slug: products.slug,
            barcode: products.barcode,
            status: products.status,
            condition: products.condition,
            itemType: products.itemType,
            metal: products.metal,
            weightGrams: products.weightGrams,
            listPriceEur: products.listPriceEur,
            name: products.name,
            descriptionDe: products.descriptionDe,
            listedOnStorefront: products.listedOnStorefront,
            listedOnEbay: products.listedOnEbay,
            isCommission: products.isCommission,
            locationStorageUnit: products.locationStorageUnit,
            locationDrawer: products.locationDrawer,
            locationPosition: products.locationPosition,
            archivedAt: products.archivedAt,
            createdAt: products.createdAt,
          })
          .from(products)
          .where(whereClause as SQL | undefined)
          .orderBy(desc(products.createdAt), asc(products.id))
          .limit(limit)
          .offset(offset),
        app.db
          .select({ n: count() })
          .from(products)
          .where(whereClause as SQL | undefined),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);

      // Day-13: fetch primary category per product in one batched query.
      const productIds = rows.map((r) => r.id);
      const primaryByProductId = new Map<string, { id: string; slug: string; nameDe: string }>();
      if (productIds.length > 0) {
        const primaries = await app.db
          .select({
            productId: productCategoriesTable.productId,
            id: categoriesTable.id,
            slug: categoriesTable.slug,
            nameDe: categoriesTable.nameDe,
          })
          .from(productCategoriesTable)
          .innerJoin(categoriesTable, eq(productCategoriesTable.categoryId, categoriesTable.id))
          .where(
            and(
              inArray(productCategoriesTable.productId, productIds),
              eq(productCategoriesTable.isPrimary, true),
            ),
          );
        for (const p of primaries) {
          primaryByProductId.set(p.productId, { id: p.id, slug: p.slug, nameDe: p.nameDe });
        }
      }

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          sku: r.sku,
          slug: r.slug,
          primaryCategory: primaryByProductId.get(r.id) ?? null,
          barcode: r.barcode,
          status: r.status,
          condition: r.condition,
          itemType: r.itemType,
          metal: r.metal as 'gold' | 'silver' | 'platinum' | 'palladium' | null,
          weightGrams: r.weightGrams,
          listPriceEur: r.listPriceEur,
          name: r.name,
          descriptionDe: r.descriptionDe,
          listedOnStorefront: r.listedOnStorefront,
          listedOnEbay: r.listedOnEbay,
          isCommission: r.isCommission,
          locationStorageUnit: r.locationStorageUnit,
          locationDrawer: r.locationDrawer,
          locationPosition: r.locationPosition,
          archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );
};

export default productsListRoute;
