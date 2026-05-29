/**
 * Inventory session routes — Stichtagsinventur (Day 21).
 *
 *   POST /api/inventory-sessions          — open a session (ADMIN-only)
 *   POST /api/inventory-sessions/:id/scans — record one barcode scan
 *   POST /api/inventory-sessions/:id/close — compute Schwund + close
 *   GET  /api/inventory-sessions/current   — current OPEN session, if any
 *
 * Constraint: at most ONE OPEN session globally (partial UNIQUE on (1)).
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { inventoryScans, inventorySessions, products } from '@warehouse14/db/schema';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class SessionNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class SessionConflictError extends DomainError {
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

const SessionView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: Type.Union([Type.Literal('OPEN'), Type.Literal('CLOSED')]),
  openedAt: Type.String({ format: 'date-time' }),
  closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  expectedCount: Type.Integer(),
  matchedCount: Type.Union([Type.Integer(), Type.Null()]),
  missingCount: Type.Union([Type.Integer(), Type.Null()]),
  unexpectedCount: Type.Union([Type.Integer(), Type.Null()]),
});

const inventorySessionsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/inventory-sessions',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Open an inventory session (Stichtagsinventur). ADMIN-only.',
        response: { 201: SessionView, 401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      try {
        const result = await app.db.transaction(async (tx) => {
          const [count] = await tx.execute<{ c: string }>(drizzleSql`
          SELECT COUNT(*)::text AS c FROM products
           WHERE status IN ('AVAILABLE'::product_status, 'RESERVED'::product_status)
             AND archived_at IS NULL
        `);
          const expected = Number.parseInt(count!.c, 10);
          const [s] = await tx
            .insert(inventorySessions)
            .values({
              openedByUserId: req.actor.id,
              expectedCount: expected,
            })
            .returning();
          if (!s) throw new Error('session insert returned no row');
          return s;
        });
        return reply.status(201).send({
          id: result.id,
          status: result.status,
          openedAt: result.openedAt.toISOString(),
          closedAt: result.closedAt ? result.closedAt.toISOString() : null,
          expectedCount: result.expectedCount,
          matchedCount: result.matchedCount,
          missingCount: result.missingCount,
          unexpectedCount: result.unexpectedCount,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('inventory_sessions_one_open_uq')) {
          throw new SessionConflictError('An inventory session is already OPEN.');
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/inventory-sessions/current',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Get the OPEN inventory session, if any.',
        response: { 200: Type.Union([SessionView, Type.Null()]), 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const [row] = await app.db
        .select()
        .from(inventorySessions)
        .where(eq(inventorySessions.status, 'OPEN'))
        .limit(1);
      if (!row) return reply.status(200).send(null);
      return reply.status(200).send({
        id: row.id,
        status: row.status,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        expectedCount: row.expectedCount,
        matchedCount: row.matchedCount,
        missingCount: row.missingCount,
        unexpectedCount: row.unexpectedCount,
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { rawBarcode: string } }>(
    '/api/inventory-sessions/:id/scans',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Record a barcode scan. Classifies match_status.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ rawBarcode: Type.String({ minLength: 1, maxLength: 256 }) }),
        response: {
          200: Type.Object({
            id: Type.String({ format: 'uuid' }),
            matchStatus: Type.String(),
            productId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
          }),
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const result = await app.db.transaction(async (tx) => {
        const [s] = await tx
          .select({ id: inventorySessions.id, status: inventorySessions.status })
          .from(inventorySessions)
          .where(eq(inventorySessions.id, req.params.id))
          .limit(1);
        if (!s) throw new SessionNotFoundError(`Inventory session ${req.params.id} not found.`);
        if (s.status !== 'OPEN') throw new SessionConflictError('Inventory session is CLOSED.');

        const [product] = await tx
          .select({ id: products.id, status: products.status, archivedAt: products.archivedAt })
          .from(products)
          .where(eq(products.barcode, req.body.rawBarcode))
          .limit(1);

        let matchStatus:
          | 'MATCHED'
          | 'UNKNOWN_BARCODE'
          | 'DUPLICATE'
          | 'EXPECTED_BUT_SOLD'
          | 'UNEXPECTED';
        let productId: string | null = null;
        if (!product) {
          matchStatus = 'UNKNOWN_BARCODE';
        } else {
          productId = product.id;
          const [dup] = await tx.execute<{ id: string }>(drizzleSql`
          SELECT id FROM inventory_scans
           WHERE session_id = ${req.params.id} AND product_id = ${product.id}
             AND match_status = 'MATCHED'::inventory_scan_match
           LIMIT 1
        `);
          if (dup) matchStatus = 'DUPLICATE';
          else if (product.archivedAt !== null) matchStatus = 'EXPECTED_BUT_SOLD';
          else if (product.status === 'SOLD') matchStatus = 'EXPECTED_BUT_SOLD';
          else if (product.status === 'DRAFT') matchStatus = 'UNEXPECTED';
          else matchStatus = 'MATCHED';
        }

        const [scan] = await tx
          .insert(inventoryScans)
          .values({
            sessionId: req.params.id,
            rawBarcode: req.body.rawBarcode,
            productId,
            matchStatus,
            scannedByUserId: req.actor.id,
          })
          .returning({ id: inventoryScans.id });
        return { id: scan!.id, matchStatus, productId };
      });
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: { notes?: string } }>(
    '/api/inventory-sessions/:id/close',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Close session: compute Schwund + matched + unexpected.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ notes: Type.Optional(Type.String({ maxLength: 2048 })) }),
        response: {
          200: SessionView,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const result = await app.db.transaction(async (tx) => {
        const [s] = await tx
          .select()
          .from(inventorySessions)
          .where(eq(inventorySessions.id, req.params.id))
          .limit(1);
        if (!s) throw new SessionNotFoundError(`Inventory session ${req.params.id} not found.`);
        if (s.status !== 'OPEN') throw new SessionConflictError('Session is already CLOSED.');

        const [counts] = await tx.execute<{
          matched: string;
          unexpected: string;
          missing: string;
        }>(drizzleSql`
        WITH session_matched AS (
          SELECT DISTINCT product_id FROM inventory_scans
           WHERE session_id = ${req.params.id}
             AND match_status = 'MATCHED'::inventory_scan_match
             AND product_id IS NOT NULL
        )
        SELECT
          (SELECT COUNT(*)::text FROM session_matched) AS matched,
          (SELECT COUNT(*)::text FROM inventory_scans
            WHERE session_id = ${req.params.id}
              AND match_status IN ('UNKNOWN_BARCODE'::inventory_scan_match,
                                   'EXPECTED_BUT_SOLD'::inventory_scan_match,
                                   'UNEXPECTED'::inventory_scan_match)) AS unexpected,
          (SELECT COUNT(*)::text FROM products
            WHERE status IN ('AVAILABLE'::product_status, 'RESERVED'::product_status)
              AND archived_at IS NULL
              AND id NOT IN (SELECT product_id FROM session_matched WHERE product_id IS NOT NULL)
          ) AS missing
      `);

        const matched = Number.parseInt(counts!.matched, 10);
        const missing = Number.parseInt(counts!.missing, 10);
        const unexpected = Number.parseInt(counts!.unexpected, 10);

        const [updated] = await tx
          .update(inventorySessions)
          .set({
            status: 'CLOSED',
            closedAt: new Date(),
            closedByUserId: req.actor.id,
            matchedCount: matched,
            missingCount: missing,
            unexpectedCount: unexpected,
            notes: req.body.notes ?? s.notes,
          })
          .where(eq(inventorySessions.id, s.id))
          .returning();
        if (!updated) throw new Error('session close UPDATE returned no row');

        if (missing > 0) {
          await tx.execute(drizzleSql`
          INSERT INTO ledger_events (event_type, entity_table, entity_id, actor_user_id, payload)
          VALUES ('inventory.session_closed_with_shrinkage', 'inventory_sessions',
                  ${updated.id}, ${req.actor.id},
                  jsonb_build_object('matched', ${matched}, 'missing', ${missing},
                                     'unexpected', ${unexpected}, 'expected', ${updated.expectedCount}))
        `);
        }

        return updated;
      });
      return reply.status(200).send({
        id: result.id,
        status: result.status,
        openedAt: result.openedAt.toISOString(),
        closedAt: result.closedAt ? result.closedAt.toISOString() : null,
        expectedCount: result.expectedCount,
        matchedCount: result.matchedCount,
        missingCount: result.missingCount,
        unexpectedCount: result.unexpectedCount,
      });
    },
  );
};

export default inventorySessionsRoutes;
