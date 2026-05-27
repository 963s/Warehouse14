/**
 * Shifts routes — Kassensturz / Blindsturz (Day 21).
 *
 *   POST /api/shifts/open                — opens a shift for the cashier's device
 *   POST /api/shifts/:id/cash-movements  — bank drop / safe transit / injection
 *   POST /api/shifts/:id/close           — Blindsturz: blind_count first, then variance revealed
 *   GET  /api/shifts/current             — fetch the cashier's current open shift (if any)
 *
 * Close requires step-up (fiscal action). The Blindsturz pattern: the
 * cashier-typed `blind_count_eur` is persisted FIRST, then the route computes
 * `system_expected_eur` from cash movements + cash sales and stores it.
 * The generated `variance_eur` column reveals the discrepancy AFTER the fact.
 */

import { Type } from '@sinclair/typebox';
import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { cashMovements, shifts } from '@warehouse14/db/schema';

import { DomainError, type ApiErrorCode } from '../plugins/error-handler.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { DecimalString } from '../schemas/money.js';

class ShiftNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class ShiftConflictError extends DomainError {
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

const ShiftView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  deviceId: Type.String({ format: 'uuid' }),
  openedByUserId: Type.String({ format: 'uuid' }),
  openedAt: Type.String({ format: 'date-time' }),
  openingFloatEur: DecimalString,
  status: Type.Union([Type.Literal('OPEN'), Type.Literal('CLOSED')]),
  blindCountEur: Type.Union([DecimalString, Type.Null()]),
  systemExpectedEur: Type.Union([DecimalString, Type.Null()]),
  varianceEur: Type.Union([Type.String(), Type.Null()]),
  closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const shiftsRoutes: FastifyPluginAsync = async (app) => {
  // ════════════════════════════════════════════════════════════════════
  // POST /api/shifts/open
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Body: { openingFloatEur: string; notes?: string } }>('/api/shifts/open', {
    schema: {
      tags: ['shifts'],
      summary: 'Open a shift for the cashier\'s mTLS-paired device.',
      body: Type.Object({
        openingFloatEur: DecimalString,
        notes: Type.Optional(Type.String({ maxLength: 1024 })),
      }),
      response: { 200: ShiftView, 401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'CASHIER', 'ADMIN');
    if (req.actor.role === 'CASHIER' && !req.deviceId) {
      throw new DeviceRequiredError('Opening a shift requires a paired POS device cert.');
    }
    const deviceId = req.deviceId;
    if (!deviceId) {
      throw new DeviceRequiredError('Opening a shift requires a paired POS device.');
    }
    try {
      const [s] = await app.db
        .insert(shifts)
        .values({
          deviceId,
          openedByUserId: req.actor.id,
          openingFloatEur: req.body.openingFloatEur,
          notes: req.body.notes ?? null,
        })
        .returning();
      if (!s) throw new Error('shift insert returned no row');
      return reply.status(200).send({
        id: s.id,
        deviceId: s.deviceId,
        openedByUserId: s.openedByUserId,
        openedAt: s.openedAt.toISOString(),
        openingFloatEur: s.openingFloatEur,
        status: s.status,
        blindCountEur: s.blindCountEur,
        systemExpectedEur: s.systemExpectedEur,
        varianceEur: s.varianceEur,
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('shifts_one_open_per_device_uq')) {
        throw new ShiftConflictError('A shift is already OPEN on this device.');
      }
      throw err;
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // GET /api/shifts/current
  // ════════════════════════════════════════════════════════════════════

  app.get('/api/shifts/current', {
    schema: {
      tags: ['shifts'],
      summary: 'Get the OPEN shift on the requesting device.',
      response: { 200: Type.Union([ShiftView, Type.Null()]), 401: ErrorResponse, 403: ErrorResponse },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'CASHIER', 'ADMIN');
    if (!req.deviceId) return reply.status(200).send(null);
    const [row] = await app.db
      .select()
      .from(shifts)
      .where(and(eq(shifts.deviceId, req.deviceId), eq(shifts.status, 'OPEN')))
      .limit(1);
    if (!row) return reply.status(200).send(null);
    return reply.status(200).send({
      id: row.id,
      deviceId: row.deviceId,
      openedByUserId: row.openedByUserId,
      openedAt: row.openedAt.toISOString(),
      openingFloatEur: row.openingFloatEur,
      status: row.status,
      blindCountEur: row.blindCountEur,
      systemExpectedEur: row.systemExpectedEur,
      varianceEur: row.varianceEur,
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/shifts/:id/cash-movements
  // ════════════════════════════════════════════════════════════════════

  app.post<{
    Params: { id: string };
    Body: {
      direction: 'INJECTION' | 'BANK_DROP' | 'SAFE_TRANSIT';
      amountEur: string;
      reason: string;
      witnessUserId?: string;
      externalRef?: string;
    };
  }>('/api/shifts/:id/cash-movements', {
    schema: {
      tags: ['shifts'],
      summary: 'Record a cash movement (bank drop / safe transit / injection).',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        direction: Type.Union([
          Type.Literal('INJECTION'),
          Type.Literal('BANK_DROP'),
          Type.Literal('SAFE_TRANSIT'),
        ]),
        amountEur: DecimalString,
        reason: Type.String({ minLength: 3, maxLength: 1024 }),
        witnessUserId: Type.Optional(Type.String({ format: 'uuid' })),
        externalRef: Type.Optional(Type.String({ maxLength: 256 })),
      }),
      response: { 200: Type.Object({ id: Type.String({ format: 'uuid' }) }), 401: ErrorResponse, 404: ErrorResponse },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'CASHIER', 'ADMIN');

    // Ensure the shift exists + is OPEN.
    const [s] = await app.db
      .select({ id: shifts.id, status: shifts.status })
      .from(shifts).where(eq(shifts.id, req.params.id)).limit(1);
    if (!s) throw new ShiftNotFoundError(`Shift ${req.params.id} not found.`);
    if (s.status !== 'OPEN') throw new ShiftConflictError('Cannot record cash movement on a CLOSED shift.');

    const [row] = await app.db.insert(cashMovements).values({
      shiftId: s.id,
      direction: req.body.direction,
      amountEur: req.body.amountEur,
      reason: req.body.reason,
      witnessUserId: req.body.witnessUserId ?? null,
      performedByUserId: req.actor.id,
      externalRef: req.body.externalRef ?? null,
    }).returning({ id: cashMovements.id });
    return reply.status(200).send({ id: row!.id });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/shifts/:id/close  (Blindsturz)
  // ════════════════════════════════════════════════════════════════════

  app.post<{
    Params: { id: string };
    Body: { blindCountEur: string; notes?: string };
  }>('/api/shifts/:id/close', {
    schema: {
      tags: ['shifts'],
      summary: 'Close a shift with Blindsturz (blind count first, variance reveals).',
      description:
        'Mandatory PIN step-up. The cashier supplies blindCountEur (their physical drawer count) ' +
        'BEFORE seeing the system-computed expected balance. The route computes expected = ' +
        'opening_float + Σ(cash sales on this shift) + Σ(INJECTIONs) − Σ(BANK_DROPs + SAFE_TRANSITs) ' +
        'and stores it. variance_eur is auto-generated (blind − expected).',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        blindCountEur: DecimalString,
        notes: Type.Optional(Type.String({ maxLength: 1024 })),
      }),
      response: { 200: ShiftView, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'CASHIER', 'ADMIN');
    requireStepUp(req);

    const result = await app.db.transaction(async (tx) => {
      const [s] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.id, req.params.id))
        .limit(1);
      if (!s) throw new ShiftNotFoundError(`Shift ${req.params.id} not found.`);
      if (s.status !== 'OPEN') throw new ShiftConflictError('Shift is already CLOSED.');

      // Compute the expected drawer balance:
      //   opening_float
      // + Σ(cash payments on this shift) [transaction_payments.method='CASH' for transactions where shift_id = this]
      // + Σ(INJECTIONs)
      // − Σ(BANK_DROPs)
      // − Σ(SAFE_TRANSITs)
      const [agg] = await tx.execute<{
        cash_sales: string | null;
        injections: string | null;
        bank_drops: string | null;
        safe_transits: string | null;
      }>(drizzleSql`
        SELECT
          (SELECT COALESCE(SUM(tp.amount_eur), 0)::text
             FROM transaction_payments tp
             JOIN transactions t ON t.id = tp.transaction_id
            WHERE t.shift_id = ${s.id}
              AND tp.payment_method = 'CASH'::payment_method) AS cash_sales,
          (SELECT COALESCE(SUM(amount_eur), 0)::text
             FROM cash_movements
            WHERE shift_id = ${s.id} AND direction = 'INJECTION'::cash_movement_direction) AS injections,
          (SELECT COALESCE(SUM(amount_eur), 0)::text
             FROM cash_movements
            WHERE shift_id = ${s.id} AND direction = 'BANK_DROP'::cash_movement_direction) AS bank_drops,
          (SELECT COALESCE(SUM(amount_eur), 0)::text
             FROM cash_movements
            WHERE shift_id = ${s.id} AND direction = 'SAFE_TRANSIT'::cash_movement_direction) AS safe_transits
      `);

      const cents = (x: string | null): bigint => {
        const v = x ?? '0';
        const [whole, frac = '00'] = v.split('.');
        return BigInt(whole!) * 100n + BigInt(((frac ?? '00').padEnd(2, '0').slice(0, 2)));
      };
      const expectedCents =
        cents(s.openingFloatEur)
        + cents(agg!.cash_sales)
        + cents(agg!.injections)
        - cents(agg!.bank_drops)
        - cents(agg!.safe_transits);
      const expectedEur = `${expectedCents / 100n}.${String(expectedCents % 100n).padStart(2, '0')}`;

      const [updated] = await tx
        .update(shifts)
        .set({
          status: 'CLOSED',
          blindCountEur: req.body.blindCountEur,
          systemExpectedEur: expectedEur,
          closedByUserId: req.actor.id,
          closedAt: new Date(),
          notes: req.body.notes ?? s.notes,
        })
        .where(eq(shifts.id, s.id))
        .returning();
      if (!updated) throw new Error('shift close UPDATE returned no row');
      return updated;
    });

    return reply.status(200).send({
      id: result.id,
      deviceId: result.deviceId,
      openedByUserId: result.openedByUserId,
      openedAt: result.openedAt.toISOString(),
      openingFloatEur: result.openingFloatEur,
      status: result.status,
      blindCountEur: result.blindCountEur,
      systemExpectedEur: result.systemExpectedEur,
      varianceEur: result.varianceEur,
      closedAt: result.closedAt ? result.closedAt.toISOString() : null,
    });
  });
};

export default shiftsRoutes;
