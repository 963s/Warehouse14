/**
 * Photo workflow routes (Phase 2 Day 2 — closes the Day-24 deferred surface).
 *
 *   POST   /api/photos                       — register an R2-uploaded photo;
 *                                              defaults to FOTOGRAFIERT
 *   GET    /api/photos/unassigned            — orphan photos (productId IS NULL)
 *   PATCH  /api/photos/:id/workflow-state    — validated 5-stage transition;
 *                                              writes event log; satisfies
 *                                              the two DB CHECKs at the right
 *                                              moment (r2_key_bg_removed for
 *                                              FREIGESTELLT, productId for
 *                                              ZUGEORDNET)
 *   GET    /api/products/:id/photos          — assigned photos for a product
 *                                              (optional workflow_state filter)
 *
 * Every transition writes a `product_photo_workflow_events` row inside the
 * same TX so the Kanban "drag from column A to column B" produces one
 * atomic audit unit. ADMIN + CASHIER may both move photos; only Owner can
 * archive (covered by the existing documents route + Phase 1.5 §I-23 virus-
 * scan worker).
 */

import { Type } from '@sinclair/typebox';
import { type SQL, and, asc, count, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { productPhotoWorkflowEvents, productPhotos } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { buildR2PublicUrl } from '../lib/r2.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  ALLOWED_PHOTO_TRANSITIONS,
  CreatePhotoBody,
  PhotoIdParams,
  PhotoRow,
  ProductPhotosQuery,
  ProductPhotosResponse,
  type TCreatePhotoBody,
  type TPhotoIdParams,
  type TProductPhotosQuery,
  type TTransitionPhotoStateBody,
  type TUnassignedPhotosQuery,
  TransitionPhotoStateBody,
  UnassignedPhotosQuery,
  UnassignedPhotosResponse,
} from '../schemas/photos.js';

class PhotoNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class PhotoValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class IllegalPhotoTransitionError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

type PhotoRowDb = typeof productPhotos.$inferSelect;

function serializePhoto(row: PhotoRowDb, env: Env): Record<string, unknown> {
  return {
    id: row.id,
    productId: row.productId,
    r2Key: row.r2Key,
    publicUrl: buildR2PublicUrl(env, row.r2Key),
    r2KeyBgRemoved: row.r2KeyBgRemoved,
    displayOrder: row.displayOrder,
    isPrimary: row.isPrimary,
    source: row.source,
    altTextDe: row.altTextDe,
    altTextEn: row.altTextEn,
    workflowState: row.workflowState,
    workflowChangedAt: row.workflowChangedAt.toISOString(),
    workflowChangedByUserId: row.workflowChangedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PhotosRoutesOpts {
  env: Env;
}

const photosRoutes: FastifyPluginAsync<PhotosRoutesOpts> = async (app, opts) => {
  // ────────────────────────────────────────────────────────────────────
  // POST /api/photos
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TCreatePhotoBody }>(
    '/api/photos',
    {
      schema: {
        tags: ['photos'],
        summary: 'Register an R2-uploaded photo (defaults to FOTOGRAFIERT).',
        description:
          'V1 flow: client uploads bytes to R2 via signed URL, then POSTs ' +
          'metadata here. productId may be omitted — the photo lives as an ' +
          'orphan until a PATCH /:id/workflow-state with toState=ZUGEORDNET ' +
          'attaches it.',
        body: CreatePhotoBody,
        response: { 200: PhotoRow, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const actorId = req.actor.id;

      const result = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(productPhotos)
          .values({
            r2Key: body.r2Key,
            productId: body.productId ?? null,
            source: body.source ?? 'admin_upload',
            altTextDe: body.altTextDe ?? null,
            altTextEn: body.altTextEn ?? null,
            workflowState: 'FOTOGRAFIERT',
            workflowChangedByUserId: actorId,
          })
          .returning();
        if (!row) throw new Error('product_photos INSERT returned no row');

        await tx.insert(productPhotoWorkflowEvents).values({
          productPhotoId: row.id,
          fromState: null,
          toState: 'FOTOGRAFIERT',
          changedByUserId: actorId,
          notes: 'initial registration',
        });

        return row;
      });

      return reply.status(200).send(serializePhoto(result, opts.env));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/photos/unassigned
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TUnassignedPhotosQuery }>(
    '/api/photos/unassigned',
    {
      schema: {
        tags: ['photos'],
        summary: 'Orphan photos awaiting product assignment.',
        querystring: UnassignedPhotosQuery,
        response: { 200: UnassignedPhotosResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const limit = req.query.limit ?? 50;
      const offset = req.query.offset ?? 0;

      const preds: Array<SQL | undefined> = [
        drizzleSql`${productPhotos.productId} IS NULL`,
        req.query.workflowState !== undefined
          ? eq(productPhotos.workflowState, req.query.workflowState)
          : undefined,
      ];
      const whereClause = and(...preds);

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(productPhotos)
          .where(whereClause)
          .orderBy(desc(productPhotos.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(productPhotos).where(whereClause),
      ]);

      return reply.status(200).send({
        items: rows.map((r) => serializePhoto(r, opts.env)),
        total: Number(totalRow[0]?.n ?? 0),
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/photos/:id/workflow-state
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TPhotoIdParams; Body: TTransitionPhotoStateBody }>(
    '/api/photos/:id/workflow-state',
    {
      schema: {
        tags: ['photos'],
        summary: 'Transition a photo through the 5-stage workflow.',
        description:
          'Validates that the transition is permitted by ALLOWED_PHOTO_TRANSITIONS; ' +
          'FREIGESTELLT requires r2_key_bg_removed; ZUGEORDNET requires productId. ' +
          'Writes a product_photo_workflow_events row in the same TX.',
        params: PhotoIdParams,
        body: TransitionPhotoStateBody,
        response: { 200: PhotoRow, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const { toState, r2KeyBgRemoved, productId, notes } = req.body;
      const actorId = req.actor.id;

      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(productPhotos)
          .where(eq(productPhotos.id, req.params.id))
          .limit(1);
        if (!current) throw new PhotoNotFoundError(`Photo ${req.params.id} not found`);

        // Validate transition is allowed.
        const allowed = ALLOWED_PHOTO_TRANSITIONS[current.workflowState] ?? [];
        if (!allowed.includes(toState)) {
          throw new IllegalPhotoTransitionError(
            `Illegal transition ${current.workflowState} → ${toState}`,
          );
        }

        // Validate side-condition data is present.
        const wantsBgRemoved =
          toState === 'FREIGESTELLT' || toState === 'ZUGEORDNET' || toState === 'FUER_EBAY_BEREIT';
        if (wantsBgRemoved && !current.r2KeyBgRemoved && !r2KeyBgRemoved) {
          throw new PhotoValidationError(
            `transition to ${toState} requires r2KeyBgRemoved (current row has none)`,
          );
        }
        if (toState === 'ZUGEORDNET' && !current.productId && !productId) {
          throw new PhotoValidationError(
            'transition to ZUGEORDNET requires productId (current row is an orphan)',
          );
        }

        const updates: Partial<typeof productPhotos.$inferInsert> = {
          workflowState: toState,
          workflowChangedAt: new Date(),
          workflowChangedByUserId: actorId,
        };
        if (r2KeyBgRemoved) updates.r2KeyBgRemoved = r2KeyBgRemoved;
        if (productId && !current.productId) updates.productId = productId;

        const [updated] = await tx
          .update(productPhotos)
          .set(updates)
          .where(eq(productPhotos.id, req.params.id))
          .returning();
        if (!updated) throw new Error('UPDATE returned no row');

        await tx.insert(productPhotoWorkflowEvents).values({
          productPhotoId: updated.id,
          fromState: current.workflowState,
          toState,
          changedByUserId: actorId,
          notes: notes ?? null,
        });

        return updated;
      });

      return reply.status(200).send(serializePhoto(result, opts.env));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/products/:id/photos
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: TProductPhotosQuery }>(
    '/api/products/:id/photos',
    {
      schema: {
        tags: ['photos', 'products'],
        summary: 'List photos for a product (optional workflow_state filter).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        querystring: ProductPhotosQuery,
        response: { 200: ProductPhotosResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const preds: Array<SQL | undefined> = [
        eq(productPhotos.productId, req.params.id),
        req.query.workflowState !== undefined
          ? eq(productPhotos.workflowState, req.query.workflowState)
          : undefined,
      ];
      const rows = await app.db
        .select()
        .from(productPhotos)
        .where(and(...preds))
        .orderBy(asc(productPhotos.displayOrder), asc(productPhotos.createdAt));

      return reply.status(200).send({ items: rows.map((r) => serializePhoto(r, opts.env)) });
    },
  );
};

export default photosRoutes;
