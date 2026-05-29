/**
 * POST /api/inventory/release — RESERVED → AVAILABLE (Day 15 §2).
 *
 * Releases a reservation back to AVAILABLE. The `sessionId` argument is the
 * cross-session guard — a stale actor cannot accidentally release another
 * session's hold. `ReservationOwnershipError` (from inventory-lock) maps to
 * 409 PRODUCT_NOT_RESERVABLE.
 *
 * Gatekeepers:
 *   • requireAuth + requireRole('CASHIER','ADMIN')
 *   • CASHIER requires a paired device (POS)
 *   • No step-up: release is reversible (reserve() again) and non-fiscal.
 *
 * Auto-release of expired reservations is a SEPARATE flow (worker job
 * `autoReleaseExpired` per ADR-0016 §3). This route is for explicit human
 * intent only.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { ReservationOwnershipError, release } from '@warehouse14/inventory-lock';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  ReleaseBody,
  ReleaseResponse,
  type ReleaseBody as TReleaseBody,
} from '../schemas/inventory.js';

class ProductNotReservableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'PRODUCT_NOT_RESERVABLE';
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

const inventoryRelease: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TReleaseBody }>(
    '/api/inventory/release',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Release a reservation (RESERVED → AVAILABLE) — session-guarded.',
        description:
          'Returns the product to AVAILABLE. The `sessionId` MUST match the ' +
          "row's `reserved_by_session_id` — cross-session releases are refused. " +
          '409 PRODUCT_NOT_RESERVABLE on mismatch or when the row is not RESERVED.',
        body: ReleaseBody,
        response: {
          200: ReleaseResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      if (req.actor.role === 'CASHIER' && req.deviceId == null) {
        throw new DeviceRequiredError('CASHIER actions require a paired POS device cert.');
      }

      const { productId, sessionId, reason } = req.body;

      try {
        // userId guard (§19.2 C-1): only the cashier who reserved can
        // release. requireAuth narrowed req.actor to non-null.
        await release(app.db, {
          productId,
          sessionId,
          userId: req.actor.id,
          reason,
        });
      } catch (err) {
        if (err instanceof ReservationOwnershipError) {
          throw new ProductNotReservableError(err.message);
        }
        throw err;
      }

      return reply.status(200).send({
        productId,
        releasedAt: new Date().toISOString(),
        reason,
      });
    },
  );
};

export default inventoryRelease;
