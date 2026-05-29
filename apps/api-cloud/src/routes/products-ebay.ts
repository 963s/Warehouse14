/**
 * eBay listing state-machine routes (Phase 2 Day 2 — closes the Day-24
 * deferred surface).
 *
 *   PATCH /api/products/:id/ebay-state    — Owner-only, validated 9-stage
 *                                           transition; DB trigger handles
 *                                           the inventory side effect
 *   GET   /api/products/:id/ebay-history  — paged append-only event log
 *
 * The state-machine table lives in `schemas/products-ebay.ts` so the
 * front-end Kanban can render permitted transitions deterministically.
 *
 * Source attribution: the route always writes `changed_by_source = 'OWNER'`
 * (the only path that flows through here). The EBAY_WEBHOOK + WORKER + SYSTEM
 * variants come from Phase 1.5 reconciler & webhook routes.
 */

import { Type } from '@sinclair/typebox';
import { and, count, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { productEbayListingEvents, products } from '@warehouse14/db/schema';

import { requireAuth, requireOwnerStepUp, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  ALLOWED_EBAY_TRANSITIONS,
  EBAY_SOLD_CLUSTER,
  EbayHistoryQuery,
  EbayHistoryResponse,
  ProductIdParams,
  type TEbayHistoryQuery,
  type TProductIdParams,
  type TTransitionEbayStateBody,
  TransitionEbayStateBody,
  TransitionEbayStateResponse,
} from '../schemas/products-ebay.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class IllegalEbayTransitionError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const productsEbayRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/products/:id/ebay-state
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TProductIdParams; Body: TTransitionEbayStateBody }>(
    '/api/products/:id/ebay-state',
    {
      schema: {
        tags: ['products', 'ebay'],
        summary: '9-stage eBay listing transition (Owner-only).',
        description:
          'Validates the transition against ALLOWED_EBAY_TRANSITIONS, writes ' +
          'the event log row, and lets the DB trigger from migration 0022 ' +
          'handle inventory side effects (auto-RESERVE on VERKAUFT, alert ' +
          'on POS/STOREFRONT conflict or local SOLD).',
        params: ProductIdParams,
        body: TransitionEbayStateBody,
        response: {
          200: TransitionEbayStateResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwnerStepUp(req);

      const { deviceId } = req;
      if (deviceId == null) {
        throw new DeviceRequiredError('eBay state changes require an mTLS-paired device.');
      }
      const actorId = req.actor.id;
      const { toState, ebayOrderId, notes } = req.body;

      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: products.id,
            ebayState: products.ebayState,
            status: products.status,
            reservedByChannel: products.reservedByChannel,
          })
          .from(products)
          .where(eq(products.id, req.params.id))
          .limit(1);
        if (!current) throw new ProductNotFoundError(`Product ${req.params.id} not found`);

        // Validate transition.
        const fromKey = current.ebayState ?? '__NULL__';
        const allowed = ALLOWED_EBAY_TRANSITIONS[fromKey] ?? [];
        if (!allowed.includes(toState)) {
          throw new IllegalEbayTransitionError(
            `Illegal eBay transition ${current.ebayState ?? 'NULL'} → ${toState}`,
          );
        }

        // Predict what the trigger will do (so the route response can echo
        // the side effect back to the operator UI without a second read).
        let sideEffect:
          | 'AUTO_RESERVED'
          | 'IDEMPOTENT_NO_OP'
          | 'CONFLICT_LOCAL_RESERVATION'
          | 'CONFLICT_LOCAL_SOLD'
          | 'NONE' = 'NONE';
        const enteringSoldCluster =
          EBAY_SOLD_CLUSTER.includes(toState) && current.ebayState !== toState;
        if (enteringSoldCluster) {
          if (current.status === 'AVAILABLE') sideEffect = 'AUTO_RESERVED';
          else if (current.status === 'RESERVED' && current.reservedByChannel === 'EBAY')
            sideEffect = 'IDEMPOTENT_NO_OP';
          else if (current.status === 'RESERVED') sideEffect = 'CONFLICT_LOCAL_RESERVATION';
          else if (current.status === 'SOLD') sideEffect = 'CONFLICT_LOCAL_SOLD';
        }

        // Apply the state change — trigger picks up the rest.
        const [updated] = await tx
          .update(products)
          .set({
            ebayState: toState,
            // Note: ebay_state_changed_at is also stamped by the trigger;
            // we set it here explicitly for the route's response shape.
            ebayStateChangedAt: drizzleSql`now()`,
          })
          .where(eq(products.id, req.params.id))
          .returning({
            id: products.id,
            ebayState: products.ebayState,
            ebayStateChangedAt: products.ebayStateChangedAt,
          });
        if (!updated) throw new Error('UPDATE returned no row');

        // Append the event log row (raw SQL because the bigserial id needs no
        // explicit ::text cast — Drizzle handles it via the schema).
        await tx.insert(productEbayListingEvents).values({
          productId: updated.id,
          fromState: current.ebayState,
          toState,
          changedByUserId: actorId,
          changedBySource: 'OWNER',
          ebayOrderId: ebayOrderId ?? null,
          notes: notes ?? null,
          payload: { sideEffect } as Record<string, unknown>,
        });

        return { updated, sideEffect, fromState: current.ebayState };
      });

      return reply.status(200).send({
        productId: result.updated.id,
        fromState: result.fromState,
        toState: result.updated.ebayState!,
        ebayStateChangedAt: result.updated.ebayStateChangedAt!.toISOString(),
        inventorySideEffect: result.sideEffect,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/products/:id/ebay-history
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Params: TProductIdParams; Querystring: TEbayHistoryQuery }>(
    '/api/products/:id/ebay-history',
    {
      schema: {
        tags: ['products', 'ebay'],
        summary: "Paged append-only event log for a product's eBay state.",
        params: ProductIdParams,
        querystring: EbayHistoryQuery,
        response: { 200: EbayHistoryResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const limit = req.query.limit ?? 50;
      const offset = req.query.offset ?? 0;
      const whereClause = eq(productEbayListingEvents.productId, req.params.id);

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(productEbayListingEvents)
          .where(whereClause)
          .orderBy(desc(productEbayListingEvents.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(productEbayListingEvents).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);
      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id.toString(),
          productId: r.productId,
          fromState: r.fromState,
          toState: r.toState,
          changedByUserId: r.changedByUserId,
          changedBySource: r.changedBySource as 'OWNER' | 'EBAY_WEBHOOK' | 'WORKER' | 'SYSTEM',
          ebayOrderId: r.ebayOrderId,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );

  // Suppress "imported but unused" — and gives `and` a use if filters expand.
  void and;
};

export default productsEbayRoutes;
