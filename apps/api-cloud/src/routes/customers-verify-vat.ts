import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth, requireRole } from '../lib/auth-policy.js';

const QuerySchema = Type.Object({
  vatId: Type.String({ minLength: 4, maxLength: 32 }),
});

const ResponseSchema = Type.Object({
  valid: Type.Boolean(),
  name: Type.Optional(Type.String()),
  address: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export const customersVerifyVatRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { vatId: string } }>(
    '/api/customers/verify-vat',
    {
      schema: {
        tags: ['customers'],
        summary: 'Verify B2B VAT ID via EU VIES API.',
        description: 'Performs a real-time lookup with a 5s timeout. Handles errors gracefully.',
        querystring: QuerySchema,
        response: {
          200: ResponseSchema,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const rawVatId = req.query.vatId;
      const cleanVatId = rawVatId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

      if (cleanVatId.length < 4 || cleanVatId.length > 15) {
        return reply.status(200).send({
          valid: false,
          error: 'INVALID_FORMAT',
        });
      }

      const countryCode = cleanVatId.slice(0, 2);
      const vatNumber = cleanVatId.slice(2);

      // Validate country code is 2 letters
      if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z0-9]+$/.test(vatNumber)) {
        return reply.status(200).send({
          valid: false,
          error: 'INVALID_FORMAT',
        });
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Warehouse14/1.0.0',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // VIES returned a non-200 status code
          return reply.status(200).send({
            valid: false,
            error: 'VIES_UNAVAILABLE',
          });
        }

        const data = (await response.json()) as {
          isValid: boolean;
          name?: string;
          address?: string;
        };

        if (data.isValid) {
          // German (DE) and Spanish (ES) lookups might return valid but mask details.
          // Clean/standardize empty/masked values to '---' or trim them.
          const name = data.name && data.name.trim() !== '' ? data.name.trim() : '---';
          const address = data.address && data.address.trim() !== '' ? data.address.trim() : '---';

          return reply.status(200).send({
            valid: true,
            name,
            address,
          });
        }

        return reply.status(200).send({
          valid: false,
        });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return reply.status(200).send({
            valid: false,
            error: 'VIES_TIMEOUT',
          });
        }

        return reply.status(200).send({
          valid: false,
          error: 'VIES_UNAVAILABLE',
        });
      }
    },
  );
};
