/**
 * POST /api/photos/upload — API-proxied product-photo upload.
 *
 * The DURABLE replacement for the direct browser→R2 PUT (`/api/photos/upload-url`
 * + a client-side `fetch(uploadUrl, { method: 'PUT' })`). That direct path only
 * works if the R2 bucket carries a CORS policy permitting PUT from the Tauri
 * webview origin — which it does not by default, so the owner's photo uploads
 * were rejected by the browser at the CORS-preflight stage.
 *
 * Here the client sends the (cropped, compressed) image bytes as base64 in a
 * normal JSON request. The API:
 *   1. decodes + validates size & content-type,
 *   2. uploads the bytes to R2 server-side (`putObjectToR2`),
 *   3. inserts a `product_photos` row (orphan, or bound to productId),
 *   4. writes the workflow-event + audit rows in the same TX,
 *   5. returns the row + the public URL.
 *
 * ADMIN + CASHIER gated, mirroring `POST /api/photos`. Size-limited both at the
 * Fastify route (`bodyLimit`) and after base64-decode (defensive).
 */

import { randomUUID } from 'node:crypto';

import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  auditLog,
  productPhotoWorkflowEvents,
  productPhotos,
  products,
} from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { putObjectToR2 } from '../lib/r2.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  PhotoDirectUploadBody,
  PhotoDirectUploadResponse,
  type PhotoDirectUploadBody as TBody,
} from '../schemas/photo-direct-upload.js';

/** Hard cap on the decoded image (bytes). Compressed product WebP is ≤ ~300 KB;
 *  we allow generous headroom for browser-fallback JPEG/PNG. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

class R2NotConfiguredError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}
class PhotoUploadValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

function buildKey(productId: string | undefined, intent: string, mime: string): string {
  const photoId = randomUUID();
  if (productId) return `products/${productId}/photo-${photoId}.${extForMime(mime)}`;
  const prefix = intent === 'kyc' ? 'kyc' : 'uploads/orphan';
  return `${prefix}/${photoId}.${extForMime(mime)}`;
}

export interface PhotoDirectUploadOpts {
  env: Env;
}

const photoDirectUploadRoute: FastifyPluginAsync<PhotoDirectUploadOpts> = async (app, opts) => {
  app.post<{ Body: TBody }>(
    '/api/photos/upload',
    {
      // Allow base64-inflated bodies up to ~8 MB (6 MB decoded × 1.34).
      bodyLimit: 9 * 1024 * 1024,
      schema: {
        tags: ['photos'],
        summary: 'Upload a product photo through the API (server-side R2 write).',
        description:
          'Accepts base64 image bytes, uploads to R2 server-side, and binds them to a ' +
          'product_photos row. Avoids the R2-CORS dependency of the direct presigned-PUT path.',
        body: PhotoDirectUploadBody,
        response: {
          200: PhotoDirectUploadResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // 1. Decode + validate bytes.
      let bytes: Buffer;
      try {
        bytes = Buffer.from(body.dataBase64, 'base64');
      } catch {
        throw new PhotoUploadValidationError('dataBase64 ist kein gültiges Base64.');
      }
      if (bytes.length === 0) {
        throw new PhotoUploadValidationError('Bilddaten sind leer.');
      }
      if (bytes.length > MAX_IMAGE_BYTES) {
        throw new PhotoUploadValidationError(
          `Bild ist zu groß (${Math.round(bytes.length / 1024)} KB, max ${Math.round(
            MAX_IMAGE_BYTES / 1024,
          )} KB).`,
        );
      }

      const intent = body.intent ?? (body.productId ? 'product' : 'orphan');
      const r2Key = buildKey(body.productId, intent, body.contentType);

      // 2. If binding to a product, confirm it exists before we write bytes.
      if (body.productId) {
        const [prod] = await app.db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, body.productId))
          .limit(1);
        if (!prod) throw new ProductNotFoundError(`Produkt ${body.productId} nicht gefunden.`);
      }

      // 3. Upload bytes to R2 server-side.
      let uploaded: Awaited<ReturnType<typeof putObjectToR2>>;
      try {
        uploaded = await putObjectToR2(opts.env, r2Key, bytes, body.contentType);
      } catch (err) {
        throw new R2NotConfiguredError(
          err instanceof Error ? err.message : 'R2-Upload fehlgeschlagen.',
        );
      }

      // 4. Insert row + workflow event + audit atomically.
      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(productPhotos)
          .values({
            r2Key: uploaded.key,
            productId: body.productId ?? null,
            isPrimary: body.isPrimary ?? false,
            source: 'admin_upload',
            altTextDe: body.altTextDe ?? null,
            altTextEn: body.altTextEn ?? null,
            workflowState: 'FOTOGRAFIERT',
            workflowChangedByUserId: actorId,
          })
          .returning();
        if (!inserted) throw new Error('product_photos INSERT returned no row');

        await tx.insert(productPhotoWorkflowEvents).values({
          productPhotoId: inserted.id,
          fromState: null,
          toState: 'FOTOGRAFIERT',
          changedByUserId: actorId,
          notes: 'API-proxied upload',
        });

        await tx.insert(auditLog).values({
          eventType: 'photo.uploaded_via_api',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            photoId: inserted.id,
            r2Key: uploaded.key,
            productId: body.productId ?? null,
            contentType: body.contentType,
            sizeBytes: bytes.length,
          },
        });

        return inserted;
      });

      return reply.status(200).send({
        id: row.id,
        productId: row.productId,
        r2Key: row.r2Key,
        publicUrl: uploaded.publicUrl,
        workflowState: row.workflowState,
        createdAt: row.createdAt.toISOString(),
      });
    },
  );
};

export default photoDirectUploadRoute;
