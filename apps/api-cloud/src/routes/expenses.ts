/**
 * operating_expenses CRUD — one-off Betriebsausgaben (migration 0075).
 *
 *   GET   /api/expenses           — list (date range + category filter, paged)
 *   POST  /api/expenses           — create  (ADMIN + step-up + audit)
 *   PATCH /api/expenses/:id        — edit    (ADMIN + step-up + audit)
 *
 * Mutating routes mirror the house pattern: requireAuth → requireRole(ADMIN)
 * → requireStepUp → write + audit_log row in ONE transaction. Money is
 * INTEGER CENTS end-to-end. `created_by_user_id` is always req.actor.id and is
 * never client-overridable.
 *
 * No DELETE: corrections are an UPDATE / a new offsetting row (GoBD — records
 * stay nachvollziehbar; the audit_log carries the actor + delta).
 */

import { type SQL, and, count, desc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, operatingExpenses } from '@warehouse14/db/schema';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CreateExpenseBody,
  ErrorResponse,
  ExpenseIdParams,
  ListExpensesQuery,
  ListExpensesResponse,
  type TCreateExpenseBody,
  type TExpenseIdParams,
  type TListExpensesQuery,
  type TUpdateExpenseBody,
  UpdateExpenseBody,
} from '../schemas/finance.js';

class ExpenseNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class ExpenseValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

type ExpenseRowDb = typeof operatingExpenses.$inferSelect;

function serialize(row: ExpenseRowDb): Record<string, unknown> {
  return {
    id: row.id,
    date: row.businessDay,
    category: row.category,
    amountCents: row.amountCents,
    note: row.note,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const expensesRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/expenses
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TListExpensesQuery }>(
    '/api/expenses',
    {
      schema: {
        tags: ['finance'],
        summary: 'List one-off operating expenses (paged, filtered).',
        querystring: ListExpensesQuery,
        response: { 200: ListExpensesResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;

      const preds: Array<SQL | undefined> = [
        q.from !== undefined ? gte(operatingExpenses.businessDay, q.from) : undefined,
        q.to !== undefined ? lte(operatingExpenses.businessDay, q.to) : undefined,
        q.category !== undefined ? eq(operatingExpenses.category, q.category) : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(operatingExpenses)
          .where(whereClause)
          .orderBy(desc(operatingExpenses.businessDay), desc(operatingExpenses.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(operatingExpenses).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);
      return reply.status(200).send({
        items: rows.map(serialize),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/expenses
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TCreateExpenseBody }>(
    '/api/expenses',
    {
      schema: {
        tags: ['finance'],
        summary: 'Book a one-off operating expense.',
        description: 'ADMIN + PIN step-up. Records the actor + delta to audit_log.',
        body: CreateExpenseBody,
        response: {
          200: ListExpensesResponse.properties.items.items,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const body = req.body;

      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(operatingExpenses)
          .values({
            businessDay: body.date,
            category: body.category,
            amountCents: body.amountCents,
            note: body.note ?? null,
            createdByUserId: req.actor.id,
          })
          .returning();
        if (!inserted) throw new Error('operating_expenses INSERT returned no row');

        await tx.insert(auditLog).values({
          eventType: 'operating_expense.created',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            expenseId: inserted.id,
            date: inserted.businessDay,
            category: inserted.category,
            amountCents: inserted.amountCents,
            note: inserted.note,
          },
        });
        return inserted;
      });

      return reply.status(200).send(serialize(row));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/expenses/:id
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TExpenseIdParams; Body: TUpdateExpenseBody }>(
    '/api/expenses/:id',
    {
      schema: {
        tags: ['finance'],
        summary: 'Edit a one-off operating expense.',
        description: 'ADMIN + PIN step-up. Records actor + before/after to audit_log.',
        params: ExpenseIdParams,
        body: UpdateExpenseBody,
        response: {
          200: ListExpensesResponse.properties.items.items,
          400: ErrorResponse,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const updates: Partial<typeof operatingExpenses.$inferInsert> = {};
      if (req.body.date !== undefined) updates.businessDay = req.body.date;
      if (req.body.category !== undefined) updates.category = req.body.category;
      if (req.body.amountCents !== undefined) updates.amountCents = req.body.amountCents;
      if (req.body.note !== undefined) updates.note = req.body.note;

      if (Object.keys(updates).length === 0) {
        throw new ExpenseValidationError('no editable fields provided');
      }

      const row = await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(operatingExpenses)
          .where(eq(operatingExpenses.id, req.params.id))
          .limit(1);
        if (!before) throw new ExpenseNotFoundError(`Expense ${req.params.id} not found`);

        const [updated] = await tx
          .update(operatingExpenses)
          .set(updates)
          .where(eq(operatingExpenses.id, req.params.id))
          .returning();
        if (!updated) throw new ExpenseNotFoundError(`Expense ${req.params.id} not found`);

        await tx.insert(auditLog).values({
          eventType: 'operating_expense.updated',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            expenseId: updated.id,
            before: {
              date: before.businessDay,
              category: before.category,
              amountCents: before.amountCents,
              note: before.note,
            },
            after: {
              date: updated.businessDay,
              category: updated.category,
              amountCents: updated.amountCents,
              note: updated.note,
            },
          },
        });
        return updated;
      });

      return reply.status(200).send(serialize(row));
    },
  );
};

export default expensesRoutes;
