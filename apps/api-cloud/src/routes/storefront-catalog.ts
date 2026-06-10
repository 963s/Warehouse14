/**
 * Storefront catalog router — Phase 2.A (memory.md §20).
 *
 *   GET /api/storefront/products       — paginated public catalog
 *   GET /api/storefront/products/:slug — single product page
 *   GET /api/storefront/categories     — full taxonomy tree (storefront-visible)
 *   GET /api/storefront/locations      — public business locations
 *
 * DESIGN RULES (the "Storefront Arms")
 * ════════════════════════════════════
 * 1. **Public by design.** No `requireAuth`, no `requireRole`. The path
 *    prefix `/api/storefront/` is in `PUBLIC_PREFIXES` (see
 *    `lib/public-routes.ts`) — staff-auth + mTLS bypass automatically.
 *    Rate-limit + CSP + Helmet headers ARE still applied via the global
 *    plugin chain.
 *
 * 2. **READ-ONLY.** No POST / PUT / DELETE / PATCH lives here. Cart
 *    mutations + checkout already exist under `storefront-cart.ts`.
 *
 * 3. **Strict projection.** Every row goes through
 *    `toStorefrontProduct()` which is the single place that decides
 *    which columns become public. Adding a new public field requires
 *    editing one function; nothing else changes. This is the moat
 *    that prevents `acquisition_cost_eur` from leaking via a
 *    drive-by SELECT *.
 *
 * 4. **Index-driven.** The `products_storefront_catalog_idx` partial
 *    index (migration 0029) makes `WHERE is_published_to_web = TRUE
 *    AND status = 'AVAILABLE'` a covered scan. The INCLUDE list
 *    matches exactly the columns the catalog serialiser projects,
 *    so EXPLAIN reports an index-only plan.
 *
 * 5. **No `req.actor` reads.** Authentication state must not leak
 *    into the public path — handlers never inspect `req.actor`.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { buildR2PublicUrl } from '../lib/r2.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  StorefrontCategoriesResponse,
  type StorefrontCategoryNode,
  StorefrontLocationsResponse,
  type StorefrontProduct,
  type StorefrontProductImage,
  StorefrontProduct as StorefrontProductSchema,
  StorefrontProductsResponse,
} from '../schemas/storefront-catalog.js';

// ────────────────────────────────────────────────────────────────────────
// Local errors
// ────────────────────────────────────────────────────────────────────────

class StorefrontProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

// Error response schema — same envelope the rest of the API uses, kept
// inline so the public router never imports admin-side shapes.
const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

// ────────────────────────────────────────────────────────────────────────
// Row shapes — exactly the columns we SELECT, no more.
// ────────────────────────────────────────────────────────────────────────

/**
 * Row shapes — exactly the columns we SELECT. The trailing
 * `[key: string]: unknown` is required by Drizzle's `execute<T>` generic
 * constraint (`T extends Record<string, unknown>`); it does not relax
 * type safety on the known columns.
 */
type ProductRow = {
  id: string;
  sku: string;
  slug: string | null;
  name: string;
  description_de: string | null;
  description_en: string | null;
  seo_title: string | null;
  seo_title_en: string | null;
  seo_description: string | null;
  seo_description_en: string | null;
  schema_org_type: string | null;
  list_price_eur: string;
  year_minted_from: number | null;
  year_minted_to: number | null;
  origin_country: string | null;
  period: string | null;
  catalog_reference: string | null;
  metal: string | null;
  weight_grams: string | null;
  fineness_decimal: string | null;
  // Raw app.db.execute() (postgres-js) returns timestamptz columns as ISO
  // strings, not JS Date — accept both so toStorefrontProduct never assumes
  // .toISOString() exists (was a 500 on every catalog request with data).
  published_at: Date | string | null;
  // Primary category (LEFT JOINed, may be NULL)
  primary_category_id: string | null;
  primary_category_slug: string | null;
  primary_category_name_de: string | null;
} & Record<string, unknown>;

/**
 * Public photo row — exactly the columns the gallery projection needs. We never
 * SELECT KYC/document tables here; only `product_photos`, which is PUBLIC media.
 */
type PhotoRow = {
  id: string;
  product_id: string | null;
  storage_kind: string;
  r2_key: string;
  is_primary: boolean;
  display_order: number;
  alt_text_de: string | null;
  alt_text_en: string | null;
} & Record<string, unknown>;

type CategoryRow = {
  id: string;
  parent_id: string | null;
  slug: string;
  name_de: string;
  name_en: string | null;
  description_de: string | null;
  description_en: string | null;
  schema_org_type: string | null;
  display_order: number;
} & Record<string, unknown>;

type LocationRow = {
  id: string;
  name: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  lat: string | null;
  lng: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: unknown;
} & Record<string, unknown>;

// ────────────────────────────────────────────────────────────────────────
// Projection helpers — SINGLE place each public field is decided.
// ────────────────────────────────────────────────────────────────────────

/**
 * Resolve a product_photos row to its public { full, thumb } URLs.
 *
 *   • local rows  → api-relative `/api/photos/<id>/{raw,thumb}` (the POS pattern;
 *                   the storefront prefixes with its API base). The api serves
 *                   these from PHOTOS_PUBLIC_BASE_URL via routes/photos.ts; here
 *                   we emit the relative form so the response is host-agnostic
 *                   and CDN-cacheable across origins.
 *   • legacy R2   → the absolute R2 public URL; no separate thumb rendition, so
 *                   thumb === full.
 */
function photoUrls(row: PhotoRow, env: Env): { full: string; thumb: string } {
  if (row.storage_kind === 'local') {
    return { full: `/api/photos/${row.id}/raw`, thumb: `/api/photos/${row.id}/thumb` };
  }
  const absolute = buildR2PublicUrl(env, row.r2_key);
  return { full: absolute, thumb: absolute };
}

/** Project a photo row into the public gallery shape. */
function toStorefrontImage(row: PhotoRow, env: Env): StorefrontProductImage {
  const { full, thumb } = photoUrls(row, env);
  return {
    url: full,
    thumbUrl: thumb,
    altTextDe: row.alt_text_de,
    altTextEn: row.alt_text_en,
    isPrimary: row.is_primary,
  };
}

/**
 * The MOAT. Every public product response goes through this function.
 * If a private column appears here, it leaks; otherwise it can't.
 *
 * Note we do not surface `weight_grams` if the row has no `metal` —
 * keeps non-metal antiques from showing a weight column on the
 * storefront listing.
 *
 * `images` is the (already primary-first) gallery for this product; the LIST
 * endpoint passes just the primary thumb (in [primary]) while the DETAIL
 * endpoint passes the full ordered set. `primaryImageThumbUrl` is derived from
 * the first image's thumb so list-card consumers don't have to peek into images.
 */
function toStorefrontProduct(row: ProductRow, images: StorefrontProductImage[]): StorefrontProduct {
  const primaryThumb = images.find((i) => i.isPrimary)?.thumbUrl ?? images[0]?.thumbUrl ?? null;
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    descriptionDe: row.description_de,
    descriptionEn: row.description_en,
    seoTitle: row.seo_title,
    seoTitleEn: row.seo_title_en,
    seoDescription: row.seo_description,
    seoDescriptionEn: row.seo_description_en,
    schemaOrgType: row.schema_org_type,
    listPriceEur: row.list_price_eur,
    currency: 'EUR',
    yearMintedFrom: row.year_minted_from,
    yearMintedTo: row.year_minted_to,
    originCountry: row.origin_country,
    period: row.period,
    catalogReference: row.catalog_reference,
    metal: row.metal,
    weightGrams: row.metal ? row.weight_grams : null,
    finenessDecimal: row.metal ? row.fineness_decimal : null,
    publishedAt: row.published_at
      ? row.published_at instanceof Date
        ? row.published_at.toISOString()
        : new Date(row.published_at).toISOString()
      : null,
    primaryImageThumbUrl: primaryThumb,
    images,
    imageUrls: images.map((i) => i.url),
    primaryCategory:
      row.primary_category_id && row.primary_category_slug && row.primary_category_name_de
        ? {
            id: row.primary_category_id,
            slug: row.primary_category_slug,
            nameDe: row.primary_category_name_de,
          }
        : null,
  };
}

/** Compose a parent→child tree from a flat depth-first ordered list. */
function composeCategoryTree(rows: readonly CategoryRow[]): StorefrontCategoryNode[] {
  const byId = new Map<string, StorefrontCategoryNode>();
  const roots: StorefrontCategoryNode[] = [];
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      slug: r.slug,
      nameDe: r.name_de,
      nameEn: r.name_en,
      descriptionDe: r.description_de,
      descriptionEn: r.description_en,
      schemaOrgType: r.schema_org_type,
      children: [],
    });
  }
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parent_id) {
      const parent = byId.get(r.parent_id);
      // If parent is hidden from storefront, the child still appears at
      // root (defensive — categories.ts hierarchy is 2-level cap so
      // orphans should never occur, but we don't crash on them).
      if (parent) parent.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ────────────────────────────────────────────────────────────────────────
// Plugin
// ────────────────────────────────────────────────────────────────────────

export interface StorefrontCatalogRoutesOpts {
  env: Env;
}

const storefrontCatalog: FastifyPluginAsync<StorefrontCatalogRoutesOpts> = async (app, opts) => {
  const { env } = opts;
  // ════════════════════════════════════════════════════════════════════
  // GET /api/storefront/products
  //
  // Filters:
  //   • is_published_to_web = TRUE       (mandatory)
  //   • status = 'AVAILABLE'             (mandatory — SOLD items must
  //                                       drop off the public list
  //                                       immediately, even if the
  //                                       publish flag stays TRUE)
  //   • category (slug)                  (optional facet)
  //   • metal (e.g. 'GOLD')              (optional facet)
  //   • q  (free-text)                   (optional — ILIKE on name +
  //                                       sku for V1; ts_vector lands
  //                                       in Phase 2.B)
  //
  // Pagination:
  //   • limit  1..100   (default 24 — matches typical grid 3×8)
  //   • offset 0..      (default 0)
  //
  // Sort:
  //   • V1 always ORDER BY published_at DESC NULLS LAST, id.
  //     The Next.js client sorts client-side for "Price low-high" /
  //     "Year newest" facet toggles (kept off the server hot path).
  // ════════════════════════════════════════════════════════════════════
  app.get(
    '/api/storefront/products',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Public product catalog. is_published_to_web=true + AVAILABLE only.',
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          category: Type.Optional(Type.String({ maxLength: 80 })),
          metal: Type.Optional(Type.String({ maxLength: 16 })),
          q: Type.Optional(Type.String({ maxLength: 80 })),
        }),
        response: {
          200: StorefrontProductsResponse,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const q = req.query as {
        limit?: number;
        offset?: number;
        category?: string;
        metal?: string;
        q?: string;
      };
      const limit = Math.min(Math.max(q.limit ?? 24, 1), 100);
      const offset = Math.max(q.offset ?? 0, 0);

      // The WHERE clause mirrors the predicate of
      // `products_storefront_catalog_idx` so the planner can use the
      // covering index. Optional facets are appended; they still hit
      // the index, just with a heap fetch.
      const rows = await app.db.execute<ProductRow & { total_count: string }>(sql`
      WITH catalog AS (
        SELECT
          p.id, p.sku, p.slug, p.name,
          p.description_de, p.description_en,
          p.seo_title, p.seo_title_en,
          p.seo_description, p.seo_description_en,
          p.schema_org_type,
          p.list_price_eur,
          p.year_minted_from, p.year_minted_to, p.origin_country,
          p.period, p.catalog_reference,
          p.metal, p.weight_grams, p.fineness_decimal,
          p.published_at,
          pc.category_id        AS primary_category_id,
          c.slug                AS primary_category_slug,
          c.name_de             AS primary_category_name_de
        FROM products p
        LEFT JOIN product_categories pc
          ON pc.product_id = p.id AND pc.is_primary = TRUE
        LEFT JOIN categories c
          ON c.id = pc.category_id AND c.hidden_from_storefront = FALSE
        WHERE p.is_published_to_web = TRUE
          AND p.status = 'AVAILABLE'
          AND (${q.metal ?? null}::text IS NULL OR p.metal = ${q.metal ?? null})
          AND (
            ${q.category ?? null}::text IS NULL
            OR EXISTS (
              SELECT 1 FROM product_categories pc2
              JOIN categories c2 ON c2.id = pc2.category_id
              WHERE pc2.product_id = p.id AND c2.slug = ${q.category ?? null}
            )
          )
          AND (
            ${q.q ?? null}::text IS NULL
            OR p.name ILIKE ('%' || ${q.q ?? null} || '%')
            OR p.sku  ILIKE ('%' || ${q.q ?? null} || '%')
          )
      )
      SELECT
        *, COUNT(*) OVER ()::text AS total_count
      FROM catalog
      ORDER BY published_at DESC NULLS LAST, id
      LIMIT  ${limit}
      OFFSET ${offset}
    `);

      // Batch the PRIMARY photo per product (one extra query, thumb only) so the
      // grid card has a hero image without paying for the full gallery payload.
      // Falls back to the lowest display_order photo when no is_primary row
      // exists (e.g. a product whose primary was never flagged). storage_kind in
      // ('local','r2') — both are public media; never any KYC/document table.
      const productIds = Array.from(rows).map((r) => r.id);
      const primaryByProduct = new Map<string, StorefrontProductImage>();
      if (productIds.length > 0) {
        // Bind the ids as ONE Postgres array-literal text param ('{uuid,uuid}')
        // cast to uuid[]. Interpolating a JS array into drizzle's `sql` template
        // SPREADS it into comma-separated scalar params, so `ANY(${'${productIds}'}::uuid[])`
        // casts a row/record → uuid[] and throws (22P02/42846) on any non-empty
        // page. The ids are DB-sourced UUIDs, so the literal is one safe bound
        // param. (Same fix as closing-export.ts / transactions-finalize.ts.)
        const productIdArray = `{${productIds.join(',')}}`;
        const photoRows = await app.db.execute<PhotoRow>(sql`
          SELECT DISTINCT ON (product_id)
            id, product_id, storage_kind, r2_key, is_primary, display_order,
            alt_text_de, alt_text_en
          FROM product_photos
          WHERE product_id = ANY(${productIdArray}::uuid[])
          ORDER BY product_id, is_primary DESC, display_order, created_at
        `);
        for (const ph of Array.from(photoRows)) {
          if (ph.product_id) primaryByProduct.set(ph.product_id, toStorefrontImage(ph, env));
        }
      }

      const items = Array.from(rows).map((r) => {
        const primary = primaryByProduct.get(r.id);
        return toStorefrontProduct(r, primary ? [primary] : []);
      });
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;

      // Public catalog is heavily cacheable. CDN edge caches for 60 s;
      // the operator's "publish" action is rare and slow propagation is
      // acceptable. ETag would be cleaner but Fastify doesn't ship one
      // by default and the gain is small.
      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return reply.status(200).send({ items, total, limit, offset });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // GET /api/storefront/products/:slug — single product page
  // ════════════════════════════════════════════════════════════════════
  app.get(
    '/api/storefront/products/:slug',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Single published product by slug. 404 if not published.',
        params: Type.Object({
          slug: Type.String({ minLength: 1, maxLength: 200 }),
        }),
        response: {
          200: StorefrontProductSchema,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };

      const rows = await app.db.execute<ProductRow>(sql`
      SELECT
        p.id, p.sku, p.slug, p.name,
        p.description_de, p.description_en,
        p.seo_title, p.seo_title_en,
        p.seo_description, p.seo_description_en,
        p.schema_org_type,
        p.list_price_eur,
        p.year_minted_from, p.year_minted_to, p.origin_country,
        p.period, p.catalog_reference,
        p.metal, p.weight_grams, p.fineness_decimal,
        p.published_at,
        pc.category_id        AS primary_category_id,
        c.slug                AS primary_category_slug,
        c.name_de             AS primary_category_name_de
      FROM products p
      LEFT JOIN product_categories pc
        ON pc.product_id = p.id AND pc.is_primary = TRUE
      LEFT JOIN categories c
        ON c.id = pc.category_id AND c.hidden_from_storefront = FALSE
      WHERE p.slug = ${slug}
        AND p.is_published_to_web = TRUE
        AND p.status = 'AVAILABLE'
      LIMIT 1
    `);
      const row = rows[0];
      if (!row) {
        throw new StorefrontProductNotFoundError(`No published product with slug '${slug}'`);
      }

      // DETAIL = full PDP gallery: ALL photos for this product, primary first
      // then display_order. Public media only (product_photos), never PII.
      const photoRows = await app.db.execute<PhotoRow>(sql`
        SELECT
          id, product_id, storage_kind, r2_key, is_primary, display_order,
          alt_text_de, alt_text_en
        FROM product_photos
        WHERE product_id = ${row.id}
        ORDER BY is_primary DESC, display_order, created_at
      `);
      const images = Array.from(photoRows).map((ph) => toStorefrontImage(ph, env));

      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return reply.status(200).send(toStorefrontProduct(row, images));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // GET /api/storefront/categories — full taxonomy tree
  //
  // Filters out `hidden_from_storefront = TRUE` rows. Top-level roots
  // appear first; children follow their parent. V1 schema caps depth
  // at 2 so the tree is always at most root → leaf.
  // ════════════════════════════════════════════════════════════════════
  app.get(
    '/api/storefront/categories',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Public category tree (hidden_from_storefront rows excluded).',
        response: { 200: StorefrontCategoriesResponse },
      },
    },
    async (_req, reply) => {
      const rows = await app.db.execute<CategoryRow>(sql`
      SELECT
        id, parent_id, slug,
        name_de, name_en,
        description_de, description_en,
        schema_org_type, display_order
      FROM categories
      WHERE hidden_from_storefront = FALSE
      ORDER BY parent_id NULLS FIRST, display_order, name_de
    `);
      const roots = composeCategoryTree(Array.from(rows));
      reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      return reply.status(200).send({ roots });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // GET /api/storefront/locations — public business locations
  //
  // For the storefront's "Besuchen Sie uns" page + JSON-LD
  // LocalBusiness markup. `is_pickup_location` is V1's stand-in for
  // "you can collect online orders here"; until inventory is
  // multi-location, every active row is treated as pickup-capable.
  // ════════════════════════════════════════════════════════════════════
  app.get(
    '/api/storefront/locations',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Public business locations for the storefront map + LocalBusiness JSON-LD.',
        response: { 200: StorefrontLocationsResponse },
      },
    },
    async (_req, reply) => {
      const rows = await app.db.execute<LocationRow>(sql`
      SELECT
        id, name,
        street, postal_code, city, country_code,
        lat, lng,
        phone, email,
        opening_hours
      FROM business_locations
      WHERE active = TRUE
      ORDER BY is_primary DESC, name
    `);
      const items = Array.from(rows).map((r) => ({
        id: r.id,
        slug: r.id, // V1: slug = id; Phase 2.B adds a real `slug` column.
        name: r.name,
        addressLines: [r.street, `${r.postal_code} ${r.city}`].filter(Boolean),
        city: r.city,
        postalCode: r.postal_code,
        countryCode: r.country_code,
        publicPhone: r.phone,
        publicEmail: r.email,
        latitude: r.lat != null ? Number(r.lat) : null,
        longitude: r.lng != null ? Number(r.lng) : null,
        openingHours: r.opening_hours ?? null,
        // Until multi-location inventory lands, every active row is a
        // pickup point. The schema field exists so the next-js page
        // doesn't need a follow-up migration to switch behaviour.
        isPickupLocation: true,
      }));
      reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      return reply.status(200).send({ items });
    },
  );
};

export default storefrontCatalog;
