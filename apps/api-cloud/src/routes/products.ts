/**
 * Product Management routes (Day 16).
 *
 *   POST   /api/products                  — full create (ADMIN-only)
 *   PUT    /api/products/:id              — partial update (intake-locked fields refused)
 *   POST   /api/products/:id/archive      — flip archived_at (SOLD only)
 *   POST   /api/products/:id/photos       — request R2 presigned PUT URL + pre-insert photo row
 *
 * Audit:
 *   Every successful mutation writes a row to `audit_log` inside the same DB
 *   transaction. event_types:
 *     • product.created
 *     • product.updated  (payload carries the diff)
 *     • product.archived
 *     • product.photo_requested
 *
 * Gatekeepers (all four routes):
 *   • requireAuth
 *   • requireRole('ADMIN')   — Owner-only inventory management
 *   • requireStepUp on create when acquisitionCostEur ≥ step-up threshold
 *   • requireStepUp on archive (preserves SOLD-row immutability discipline)
 */

import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, productPhotos, products } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { DomainError, type ApiErrorCode } from '../plugins/error-handler.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { totalExceedsStepUpThreshold } from '../lib/transaction-math.js';
import { buildPhotoKey, getPresignedPutUrl } from '../lib/r2.js';
import {
  ArchiveProductResponse,
  CreateProductBody,
  CreateProductResponse,
  RequestPhotoUploadBody,
  RequestPhotoUploadResponse,
  UpdateProductBody,
  UpdateProductResponse,
  type CreateProductBody as TCreateProductBody,
  type RequestPhotoUploadBody as TRequestPhotoUploadBody,
  type UpdateProductBody as TUpdateProductBody,
} from '../schemas/product.js';

// ────────────────────────────────────────────────────────────────────────
// Local error classes
// ────────────────────────────────────────────────────────────────────────

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class ProductNotArchivableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class ProductAlreadyArchivedError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class R2NotConfiguredError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface ProductsRoutesOpts {
  env: Env;
}

// ────────────────────────────────────────────────────────────────────────

const productsRoutes: FastifyPluginAsync<ProductsRoutesOpts> = async (app, opts) => {

  // ══════════════════════════════════════════════════════════════════════
  // POST /api/products — create
  // ══════════════════════════════════════════════════════════════════════
  app.post<{ Body: TCreateProductBody }>('/api/products', {
    schema: {
      tags: ['products'],
      summary: 'Create a product (Owner-only).',
      description:
        'Owner-only full create. Intake-locked fields (sku, acquisitionCostEur, isCommission, ' +
        'acquiredFromCustomerId, classification) settable here only; PUT refuses them. Step-up ' +
        'required when acquisitionCostEur exceeds the step-up threshold.',
      body: CreateProductBody,
      response: {
        200: CreateProductResponse,
        401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse, 400: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'ADMIN');

    const body = req.body;
    if (totalExceedsStepUpThreshold(body.acquisitionCostEur, opts.env.TRANSACTION_STEP_UP_THRESHOLD_EUR)) {
      requireStepUp(req);
    }

    const actorId = req.actor.id;
    const deviceId = req.deviceId ?? null;

    const inserted = await app.db.transaction(async (tx) => {
      const [row] = await tx.insert(products).values({
        sku: body.sku,
        barcode: body.barcode ?? null,
        itemType: body.itemType,
        metal: body.metal ?? null,
        karatCode: body.karatCode ?? null,
        finenessDecimal: body.finenessDecimal ?? null,
        weightGrams: body.weightGrams ?? null,
        hallmarkStamps: body.hallmarkStamps,
        acquisitionCostEur: body.acquisitionCostEur,
        listPriceEur: body.listPriceEur,
        taxTreatmentCode: body.taxTreatmentCode,
        condition: body.condition,
        isCommission: body.isCommission,
        acquiredFromCustomerId: body.acquiredFromCustomerId ?? null,
        name: body.name,
        descriptionDe: body.descriptionDe ?? null,
        marketingAttributes: body.marketingAttributes ?? [],
        listedOnStorefront: body.listedOnStorefront,
        listedOnEbay: body.listedOnEbay,
        status: 'DRAFT',
      }).returning({
        id: products.id,
        sku: products.sku,
        status: products.status,
        createdAt: products.createdAt,
      });
      if (!row) throw new Error('product INSERT returned no row');

      await tx.insert(auditLog).values({
        eventType: 'product.created',
        actorUserId: actorId,
        deviceId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: {
          productId: row.id,
          sku: row.sku,
          acquisitionCostEur: body.acquisitionCostEur,
          listPriceEur: body.listPriceEur,
          isCommission: body.isCommission,
          acquiredFromCustomerId: body.acquiredFromCustomerId ?? null,
          taxTreatmentCode: body.taxTreatmentCode,
          itemType: body.itemType,
          condition: body.condition,
        },
      });

      return row;
    });

    return reply.status(200).send({
      id: inserted.id,
      sku: inserted.sku,
      status: inserted.status as 'DRAFT' | 'AVAILABLE',
      createdAt: inserted.createdAt.toISOString(),
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // PUT /api/products/:id — partial update (intake-locked refused via TypeBox)
  // ══════════════════════════════════════════════════════════════════════
  app.put<{ Params: { id: string }; Body: TUpdateProductBody }>('/api/products/:id', {
    schema: {
      tags: ['products'],
      summary: 'Update mutable product fields (Owner-only).',
      description:
        'Accepts only the mutable fields (price, name, description, channel flags, condition, ' +
        'DRAFT→AVAILABLE status transition). Intake-locked fields are NOT accepted (additionalProperties: false).',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      body: UpdateProductBody,
      response: {
        200: UpdateProductResponse,
        401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 400: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'ADMIN');

    const { id } = req.params;
    const body = req.body;
    const actorId = req.actor.id;
    const deviceId = req.deviceId ?? null;

    const outcome = await app.db.transaction(async (tx) => {
      const beforeRows = await tx.select().from(products).where(eq(products.id, id)).limit(1);
      const before = beforeRows[0];
      if (!before) throw new ProductNotFoundError(`Product ${id} not found.`);

      // DRAFT → AVAILABLE requires published_at to land alongside status.
      const setStatusToAvailable = body.status === 'AVAILABLE' && before.status === 'DRAFT';

      const update: Partial<typeof products.$inferInsert> = {};
      const changedFields: string[] = [];

      // ── Day-17 audit fix #1: deep equality for jsonb fields. ──────
      // Reference equality (`a !== b`) is correct for primitives but always
      // returns true for plain objects/arrays even when their CONTENT is
      // identical. We use a deterministic JSON serialization for the
      // JSON-typed columns (`marketingAttributes`); primitives fall back to
      // `Object.is` (`!==` plus correct NaN/+0/-0 semantics).
      const isJsonEqual = (a: unknown, b: unknown): boolean => {
        // Fast path: same reference / primitive equality.
        if (Object.is(a, b)) return true;
        // jsonb columns in our schema only carry objects/arrays/primitives —
        // never functions, Date, etc. JSON.stringify is sufficient and stable.
        try {
          return JSON.stringify(a) === JSON.stringify(b);
        } catch {
          // If serialization fails (e.g. unexpected cycle), fall back to "different"
          // — that's the safe direction; a spurious update is better than a missed one.
          return false;
        }
      };

      const maybe = <K extends keyof typeof products.$inferInsert>(
        key: K,
        next: typeof products.$inferInsert[K] | undefined,
        prev: typeof products.$inferSelect[K] | undefined,
        opts: { jsonb?: boolean } = {},
      ): void => {
        if (next === undefined) return;
        const same = opts.jsonb ? isJsonEqual(next, prev) : Object.is(next, prev);
        if (!same) {
          update[key] = next;
          changedFields.push(key as string);
        }
      };

      maybe('condition', body.condition, before.condition);
      maybe('listPriceEur', body.listPriceEur, before.listPriceEur);
      maybe('name', body.name, before.name);
      maybe('descriptionDe', body.descriptionDe ?? null, before.descriptionDe);
      maybe(
        'marketingAttributes',
        body.marketingAttributes,
        before.marketingAttributes as unknown as typeof products.$inferInsert['marketingAttributes'],
        { jsonb: true },
      );
      maybe('listedOnStorefront', body.listedOnStorefront, before.listedOnStorefront);
      maybe('listedOnEbay', body.listedOnEbay, before.listedOnEbay);
      // Phase 2.A / Day-14 — storefront publication gate.
      // The BEFORE-UPDATE trigger `on_products_publish_to_web`
      // (migration 0029) stamps publishedAt on the first TRUE flip,
      // so the route doesn't need to echo it.
      maybe('isPublishedToWeb', body.isPublishedToWeb, before.isPublishedToWeb);

      // ─── Day 13 SEO + collector metadata (non-intake-locked) ───────
      maybe('slug', body.slug, before.slug);
      maybe('seoTitle', body.seoTitle, before.seoTitle);
      maybe('seoDescription', body.seoDescription, before.seoDescription);
      maybe('schemaOrgType', body.schemaOrgType, before.schemaOrgType);
      maybe('yearMintedFrom', body.yearMintedFrom, before.yearMintedFrom);
      maybe('yearMintedTo', body.yearMintedTo, before.yearMintedTo);
      maybe('originCountry', body.originCountry, before.originCountry);
      maybe('period', body.period, before.period);
      maybe('catalogReference', body.catalogReference, before.catalogReference);
      maybe('provenanceNotes', body.provenanceNotes, before.provenanceNotes);
      maybe('descriptionEn', body.descriptionEn, before.descriptionEn);
      maybe('seoTitleEn', body.seoTitleEn, before.seoTitleEn);
      maybe('seoDescriptionEn', body.seoDescriptionEn, before.seoDescriptionEn);

      if (body.status !== undefined && body.status !== before.status) {
        // Refuse anything other than DRAFT → AVAILABLE here.
        if (!(before.status === 'DRAFT' && body.status === 'AVAILABLE')) {
          throw new ProductNotArchivableError(
            `Status transition ${before.status} → ${body.status} is not permitted via PUT. ` +
            `Use the inventory / transaction routes for RESERVED/SOLD transitions.`,
          );
        }
        update.status = 'AVAILABLE';
        changedFields.push('status');
        if (setStatusToAvailable) {
          update.publishedAt = new Date();
          changedFields.push('publishedAt');
        }
      }

      if (changedFields.length === 0) {
        return { id, updatedAt: before.updatedAt, changedFields };
      }

      const [row] = await tx.update(products).set(update).where(eq(products.id, id)).returning({
        id: products.id,
        updatedAt: products.updatedAt,
      });
      if (!row) throw new Error('product UPDATE returned no row');

      await tx.insert(auditLog).values({
        eventType: 'product.updated',
        actorUserId: actorId,
        deviceId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: { productId: id, changedFields, before: pickDiff(before, changedFields), after: pickDiff(body, changedFields) },
      });

      return { id: row.id, updatedAt: row.updatedAt, changedFields };
    });

    return reply.status(200).send({
      id: outcome.id,
      updatedAt: outcome.updatedAt.toISOString(),
      changedFields: outcome.changedFields,
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/archive — archive a SOLD product
  // ══════════════════════════════════════════════════════════════════════
  app.post<{ Params: { id: string } }>('/api/products/:id/archive', {
    schema: {
      tags: ['products'],
      summary: 'Archive a SOLD product (hides from active inventory).',
      description: 'Only SOLD products may be archived. Requires step-up.',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      response: {
        200: ArchiveProductResponse,
        401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'ADMIN');
    requireStepUp(req);

    const { id } = req.params;
    const actorId = req.actor.id;
    const deviceId = req.deviceId ?? null;

    const outcome = await app.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: products.id, status: products.status, archivedAt: products.archivedAt, soldAt: products.soldAt })
        .from(products).where(eq(products.id, id)).limit(1);
      const before = rows[0];
      if (!before) throw new ProductNotFoundError(`Product ${id} not found.`);
      if (before.archivedAt) {
        throw new ProductAlreadyArchivedError(`Product ${id} is already archived.`);
      }
      if (before.status !== 'SOLD') {
        throw new ProductNotArchivableError(
          `Only SOLD products may be archived. Product ${id} is ${before.status}.`,
        );
      }

      const now = new Date();
      const [row] = await tx.update(products)
        .set({ archivedAt: now })
        .where(eq(products.id, id))
        .returning({ id: products.id, archivedAt: products.archivedAt });
      if (!row?.archivedAt) throw new Error('archive UPDATE returned no row');

      await tx.insert(auditLog).values({
        eventType: 'product.archived',
        actorUserId: actorId,
        deviceId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: { productId: id, archivedAt: now.toISOString(), soldAt: before.soldAt?.toISOString() ?? null },
      });

      return { id: row.id, archivedAt: row.archivedAt };
    });

    return reply.status(200).send({
      id: outcome.id,
      archivedAt: outcome.archivedAt.toISOString(),
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/photos — request R2 presigned URL + pre-insert row
  // ══════════════════════════════════════════════════════════════════════
  app.post<{ Params: { id: string }; Body: TRequestPhotoUploadBody }>('/api/products/:id/photos', {
    schema: {
      tags: ['products'],
      summary: 'Request a Cloudflare R2 presigned PUT URL for a product photo.',
      description:
        'Pre-inserts a product_photos row reserving the R2 key, returns the short-TTL ' +
        'presigned URL. Client uploads bytes directly to R2; a Phase 1.5 worker reconciles ' +
        'any rows whose r2 object never lands.',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      body: RequestPhotoUploadBody,
      response: {
        200: RequestPhotoUploadResponse,
        401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'ADMIN');

    const { id: productId } = req.params;
    const body = req.body;
    const actorId = req.actor.id;
    const deviceId = req.deviceId ?? null;

    // Verify product exists before generating a URL.
    const prodRows = await app.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!prodRows[0]) throw new ProductNotFoundError(`Product ${productId} not found.`);

    const photoId = randomUUID();
    const r2Key = buildPhotoKey(productId, photoId, body.contentType);

    let presigned: Awaited<ReturnType<typeof getPresignedPutUrl>>;
    try {
      presigned = await getPresignedPutUrl(opts.env, {
        key: r2Key,
        contentType: body.contentType,
        maxBytes: body.contentLength,
      });
    } catch (err) {
      throw new R2NotConfiguredError(
        err instanceof Error ? err.message : 'R2 presign failed',
      );
    }

    // Pre-insert the photo row + audit_log atomically.
    await app.db.transaction(async (tx) => {
      await tx.insert(productPhotos).values({
        id: photoId,
        productId,
        r2Key,
        isPrimary: body.isPrimary ?? false,
        source: 'admin_upload',
        altTextDe: body.altTextDe ?? null,
        altTextEn: body.altTextEn ?? null,
      });
      await tx.insert(auditLog).values({
        eventType: 'product.photo_requested',
        actorUserId: actorId,
        deviceId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: {
          productId,
          photoId,
          r2Key,
          contentType: body.contentType,
          contentLength: body.contentLength,
          isPrimary: body.isPrimary ?? false,
        },
      });
    });

    return reply.status(200).send({
      photoId,
      r2Key: presigned.key,
      uploadUrl: presigned.url,
      publicUrl: presigned.publicUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresAt: presigned.expiresAt,
    });
  });
};

// Local helper — pluck the keys we mention in the diff. Avoids logging
// the full body (especially marketingAttributes, which may be large).
function pickDiff(src: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = src as Record<string, unknown>;
  for (const k of keys) {
    if (k in s) out[k] = s[k];
  }
  return out;
}

export default productsRoutes;
