/**
 * Intake Drafts — Control Desktop API (ADR-0015 §7 review/publish flow).
 * ADMIN-only.
 *
 *   GET   /api/intake/drafts             — tray: sessions awaiting review.
 *   GET   /api/intake/drafts/:id         — one draft (full AI + enrichment).
 *   PATCH /api/intake/drafts/:id         — edit final_data + admin tax-verification note.
 *   POST  /api/intake/drafts/:id/publish — create the product, mark PUBLISHED.
 *
 * Borderline discipline: publishing requires a non-empty admin verification
 * note (the ADMIN "Verify tax treatment" gate) — the system never auto-publishes.
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class DraftNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class DraftPublishError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
type TIdParams = Static<typeof IdParams>;

const PatchBody = Type.Object({
  finalData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  adminVerificationNote: Type.Optional(Type.String({ maxLength: 2000 })),
});
type TPatchBody = Static<typeof PatchBody>;

/**
 * Manual publish targets (Decision #48). Every channel is opt-in; nothing is
 * auto-selected server-side. `printSticker` is executed client-side (the POS
 * label printer) — the server just echoes the label payload in the response.
 */
const PublishTargets = Type.Object({
  storefront: Type.Boolean(),
  ebay: Type.Boolean(),
  socialFlyer: Type.Boolean(),
  printSticker: Type.Boolean(),
});

const PublishBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 300 }),
  sku: Type.String({ minLength: 1, maxLength: 100 }),
  itemType: Type.String({ minLength: 1, maxLength: 40 }),
  taxTreatmentCode: Type.String({ minLength: 1, maxLength: 40 }),
  acquisitionCostEur: Type.String({ pattern: '^[0-9]+(\\.[0-9]{1,2})?$' }),
  listPriceEur: Type.String({ pattern: '^[0-9]+(\\.[0-9]{1,2})?$' }),
  weightGrams: Type.Optional(Type.String({ maxLength: 20 })),
  karat: Type.Optional(Type.String({ maxLength: 20 })),
  storageLocation: Type.Optional(Type.String({ maxLength: 60 })),
  adminVerificationNote: Type.String({ minLength: 1, maxLength: 2000 }),
  targets: Type.Optional(PublishTargets),
});
type TPublishBody = Static<typeof PublishBody>;

const LabelData = Type.Object({
  sku: Type.String(),
  productName: Type.String(),
  weightGrams: Type.Union([Type.String(), Type.Null()]),
  karat: Type.Union([Type.String(), Type.Null()]),
  storageLocation: Type.Union([Type.String(), Type.Null()]),
});

export interface IntakeDraftsOpts {
  env: Env;
}

type DraftRow = {
  session_id: string;
  status: string;
  tax_treatment_code: string | null;
  classifier_explanation: string | null;
  german_description: string | null;
  vision_classification: unknown;
  vision_hallmark_detection: unknown;
  marketing_angles: unknown;
  final_data: unknown;
  pipeline_errors: unknown;
  bg_removed_photo_keys: string[] | null;
  created_at: string;
};

const intakeDraftsRoutes: FastifyPluginAsync<IntakeDraftsOpts> = async (app) => {
  // ── List tray (READY_FOR_REVIEW + NEEDS_MORE_INFO) ───────────────────────
  app.get(
    '/api/intake/drafts',
    {
      schema: {
        tags: ['intake'],
        summary: 'List intake drafts awaiting review (Control Desktop tray).',
        response: {
          200: Type.Object({ items: Type.Array(Type.Unknown()) }),
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const rows = (await app.db.execute(sql`
        SELECT s.id::text AS session_id, s.status::text AS status,
               d.tax_treatment_code, d.classifier_explanation, d.german_description,
               d.vision_classification, d.pipeline_errors, d.created_at::text AS created_at
        FROM intake_sessions s
        JOIN intake_drafts d ON d.session_id = s.id
        WHERE s.status IN ('READY_FOR_REVIEW', 'NEEDS_MORE_INFO')
        ORDER BY d.created_at DESC
        LIMIT 200
      `)) as unknown as unknown[];
      return reply.status(200).send({ items: rows });
    },
  );

  // ── Get one draft ────────────────────────────────────────────────────────
  app.get<{ Params: TIdParams }>(
    '/api/intake/drafts/:id',
    {
      schema: {
        tags: ['intake'],
        summary: 'Get one intake draft by session id.',
        params: IdParams,
        response: {
          200: Type.Unknown(),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const rows = (await app.db.execute<DraftRow>(sql`
        SELECT s.id::text AS session_id, s.status::text AS status,
               d.tax_treatment_code, d.classifier_explanation, d.german_description,
               d.vision_classification, d.vision_hallmark_detection, d.marketing_angles,
               d.final_data, d.pipeline_errors, d.bg_removed_photo_keys,
               d.created_at::text AS created_at
        FROM intake_sessions s
        JOIN intake_drafts d ON d.session_id = s.id
        WHERE s.id = ${req.params.id}::uuid
        LIMIT 1
      `)) as unknown as DraftRow[];
      const row = rows[0];
      if (!row) throw new DraftNotFoundError(`Intake draft ${req.params.id} not found`);
      return reply.status(200).send(row);
    },
  );

  // ── Edit final_data + admin verification note ────────────────────────────
  app.patch<{ Params: TIdParams; Body: TPatchBody }>(
    '/api/intake/drafts/:id',
    {
      schema: {
        tags: ['intake'],
        summary: 'Edit a draft: merge final_data and/or set the admin tax-verification note.',
        params: IdParams,
        body: PatchBody,
        response: {
          200: Type.Unknown(),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const merge: Record<string, unknown> = { ...(req.body.finalData ?? {}) };
      if (req.body.adminVerificationNote !== undefined) {
        merge.admin_verification_note = req.body.adminVerificationNote;
      }
      const mergeJson = JSON.stringify(merge);

      const rows = (await app.db.execute<{ session_id: string }>(sql`
        UPDATE intake_drafts
        SET final_data = COALESCE(final_data, '{}'::jsonb) || ${mergeJson}::jsonb,
            updated_at = now()
        WHERE session_id = ${req.params.id}::uuid
        RETURNING session_id::text AS session_id
      `)) as unknown as Array<{ session_id: string }>;
      if (!rows[0]) throw new DraftNotFoundError(`Intake draft ${req.params.id} not found`);
      return reply.status(200).send({ sessionId: rows[0].session_id, finalData: merge });
    },
  );

  // ── Publish → create product, mark session PUBLISHED ─────────────────────
  app.post<{ Params: TIdParams; Body: TPublishBody }>(
    '/api/intake/drafts/:id/publish',
    {
      schema: {
        tags: ['intake'],
        summary:
          'Publish a reviewed draft as a DRAFT product. Requires an admin verification note.',
        params: IdParams,
        body: PublishBody,
        response: {
          200: Type.Object({
            productId: Type.String(),
            sessionId: Type.String(),
            targets: PublishTargets,
            /** Present only when printSticker was selected — the POS prints it. */
            labelData: Type.Optional(LabelData),
          }),
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const actorId = req.actor.id;
      const b = req.body;
      // Manual control: every channel opt-in, defaults all false (storefront
      // defaults true as the common case but still explicitly sent by the UI).
      const targets = b.targets ?? {
        storefront: false,
        ebay: false,
        socialFlyer: false,
        printSticker: false,
      };

      const productId = await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;

        // Guard INSIDE the transaction with FOR UPDATE (P1.5): the status check
        // was previously a separate statement that committed before the insert,
        // so two concurrent publishes of the same session BOTH passed it and
        // BOTH created a product (the second overwrote `product_id`, orphaning
        // the first). FOR UPDATE serialises publishers on the session row; the
        // loser blocks, re-reads 'PUBLISHED', and is rejected.
        const guard = (await tx.execute<{ status: string }>(sql`
          SELECT status::text AS status FROM intake_sessions
          WHERE id = ${req.params.id}::uuid FOR UPDATE
        `)) as unknown as Array<{ status: string }>;
        const cur = guard[0];
        if (!cur) throw new DraftNotFoundError(`Intake session ${req.params.id} not found`);
        if (cur.status !== 'READY_FOR_REVIEW') {
          throw new DraftPublishError(`Session is ${cur.status}, not READY_FOR_REVIEW`);
        }

        const inserted = (await tx.execute<{ id: string }>(sql`
          INSERT INTO products
            (sku, name, item_type, tax_treatment_code, acquisition_cost_eur, list_price_eur,
             status, listed_on_storefront)
          VALUES
            (${b.sku}, ${b.name}, ${b.itemType}::item_type, ${b.taxTreatmentCode},
             ${b.acquisitionCostEur}::numeric, ${b.listPriceEur}::numeric, 'DRAFT',
             ${targets.storefront})
          RETURNING id::text AS id
        `)) as unknown as Array<{ id: string }>;
        const pid = inserted[0]?.id;
        if (!pid) throw new DraftPublishError('product insert returned no row');

        // Persist verification note + the selected channels into final_data for
        // audit. The eBay mirror + social flyer are picked up by their own
        // reconcilers/worker jobs keyed off these flags.
        const finalPatch = JSON.stringify({
          admin_verification_note: b.adminVerificationNote,
          publish_targets: targets,
        });
        await tx.execute(sql`
          UPDATE intake_drafts
          SET final_data = COALESCE(final_data, '{}'::jsonb) || ${finalPatch}::jsonb, updated_at = now()
          WHERE session_id = ${req.params.id}::uuid
        `);
        await tx.execute(sql`
          UPDATE intake_sessions
          SET status = 'PUBLISHED', product_id = ${pid}::uuid,
              reviewer_user_id = ${actorId}::uuid, reviewer_decided_at = now()
          WHERE id = ${req.params.id}::uuid
        `);
        return pid;
      });

      // The label is printed client-side by the POS on success; echo the payload.
      const labelData = targets.printSticker
        ? {
            sku: b.sku,
            productName: b.name,
            weightGrams: b.weightGrams ?? null,
            karat: b.karat ?? null,
            storageLocation: b.storageLocation ?? null,
          }
        : undefined;

      return reply.status(200).send({
        productId,
        sessionId: req.params.id,
        targets,
        ...(labelData ? { labelData } : {}),
      });
    },
  );
};

export default intakeDraftsRoutes;
