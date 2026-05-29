/**
 * Shipping routes (Epic D) — DHL label generation for WEB orders.
 *
 *   POST /api/shipping/dhl-label  — { transactionId } → { trackingNumber,
 *                                    labelBase64 }. ADMIN + CASHIER.
 *
 * Guards: the transaction must be a WEB sale still PENDING shipment. The
 * recipient address is decrypted via `app.withPii` (pgcrypto, key bound to the
 * request) and handed to the DHL client opaquely — it is never logged. On
 * success the transaction is marked SHIPPED with the DHL tracking number.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { transactions } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { createDhlLabel } from '../lib/dhl-client.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class TransactionNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class NotShippableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class DhlError extends DomainError {
  public readonly httpStatus = 502;
  public readonly code: ApiErrorCode = 'EXTERNAL_SERVICE_FAILED';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const DhlLabelBody = Type.Object({
  transactionId: Type.String({ format: 'uuid' }),
});
type TDhlLabelBody = { transactionId: string };

const DhlLabelResponse = Type.Object({
  trackingNumber: Type.String(),
  /** Base64-encoded PDF shipping label. */
  labelBase64: Type.String(),
  /** True when DHL credentials are absent and a mock label was produced. */
  mock: Type.Boolean(),
});

export interface ShippingRouteOpts {
  env: Env;
}

const shippingRoutes: FastifyPluginAsync<ShippingRouteOpts> = async (app, opts) => {
  app.post<{ Body: TDhlLabelBody }>(
    '/api/shipping/dhl-label',
    {
      schema: {
        tags: ['shipping'],
        summary: 'Generate a DHL shipping label for a WEB order (ADMIN + CASHIER).',
        description:
          'Requires sales_channel=WEB and shipping_status=PENDING. Decrypts the ' +
          'recipient address, calls DHL (mock when credentials absent), stores the ' +
          'tracking number, and flips shipping_status → SHIPPED.',
        body: DhlLabelBody,
        response: {
          200: DhlLabelResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const { transactionId } = req.body;

      // Load shipment state + decrypt the recipient address (key bound per
      // request inside withPii). decrypt_pii(NULL) → NULL.
      const rows = await app.withPii((tx) =>
        tx.execute(drizzleSql`
          SELECT sales_channel  AS sales_channel,
                 shipping_status AS shipping_status,
                 decrypt_pii(shipping_address_encrypted) AS address
            FROM transactions
           WHERE id = ${transactionId}
           LIMIT 1`),
      );
      const row = (
        rows as unknown as Array<{
          sales_channel: string;
          shipping_status: string;
          address: string | null;
        }>
      )[0];

      if (!row) {
        throw new TransactionNotFoundError(`transaction ${transactionId} not found`);
      }
      if (row.sales_channel !== 'WEB') {
        throw new NotShippableError('only WEB orders can be shipped via this route');
      }
      if (row.shipping_status !== 'PENDING') {
        throw new NotShippableError(`shipping_status is ${row.shipping_status}, expected PENDING`);
      }
      if (!row.address) {
        throw new NotShippableError('transaction has no shipping address');
      }

      let label: Awaited<ReturnType<typeof createDhlLabel>>;
      try {
        label = await createDhlLabel(
          {
            user: opts.env.DHL_API_USER,
            signature: opts.env.DHL_API_SIGNATURE,
            ekp: opts.env.DHL_API_EKP,
          },
          { reference: transactionId, recipientAddress: row.address },
        );
      } catch {
        // Never surface the underlying message — it may echo the address.
        throw new DhlError('DHL label generation failed');
      }

      await app.db
        .update(transactions)
        .set({
          shippingStatus: 'SHIPPED',
          shippingCarrier: 'DHL',
          trackingNumber: label.trackingNumber,
        })
        .where(eq(transactions.id, transactionId));

      return reply.status(200).send({
        trackingNumber: label.trackingNumber,
        labelBase64: label.labelBase64,
        mock: label.mock,
      });
    },
  );
};

export default shippingRoutes;
