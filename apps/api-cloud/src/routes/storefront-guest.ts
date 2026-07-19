/**
 * Storefront guest sessions.
 *
 *   POST /api/storefront/session/guest — mint an anonymous shopper session.
 *
 * A guest is a REAL shopper row (is_guest = TRUE, migration 0085) with a
 * synthetic unique email and no credential, 1:1 with a minimal customers row
 * named "Gast". Every downstream flow (cart, reserve, orders) then works
 * unchanged because it keys on shoppers.id.
 *
 * The client mints this LAZILY — on the first cart action, never at app
 * launch — so browsing leaves no rows behind. The customers row stays "Gast"
 * until the reservation form writes the real pickup contact onto it, and an
 * email sign-up from the same session upgrades the shopper row in place
 * (storefront-auth.ts), which keeps the cart.
 *
 * Idempotence: if the caller already HAS a live shopper session (guest or
 * registered), we return it untouched instead of minting a second identity.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { customers, shopperSessions, shoppers } from '@warehouse14/db/schema';

import {
  SHOPPER_SESSION_TTL_MS,
  newSessionToken,
  setShopperCookie,
} from './storefront-auth.js';

const GuestSessionResponse = Type.Object({
  shopperId: Type.String({ format: 'uuid' }),
  guest: Type.Boolean(),
});

const storefrontGuestRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/storefront/session/guest',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Mint an anonymous guest shopper session.',
        description:
          'Creates a guest shopper (is_guest, synthetic email, no credential) + a minimal ' +
          '"Gast" customers row + a 30-day session, and sets the shopper cookie. ' +
          'If the request already carries a live shopper session it is returned unchanged. ' +
          'Called lazily by the shop clients on the first cart action.',
        response: { 200: GuestSessionResponse, 201: GuestSessionResponse },
      },
    },
    async (req, reply) => {
      // Already a shopper (guest or registered)? Keep that identity.
      if (req.shopper) {
        return reply
          .status(200)
          .send({ shopperId: req.shopper.id, guest: req.shopper.isGuest });
      }

      const result = await app.withPii(async (tx) => {
        // Minimal customers row — the real pickup contact overwrites this at
        // reservation time. Same 5-year retention default as sign-up so a
        // guest who BUYS satisfies GoBD; abandoned guest rows are sweepable
        // via shoppers_guest_created_idx.
        const [c] = await tx
          .insert(customers)
          .values({
            fullNameEncrypted: drizzleSql`encrypt_pii(${'Gast'})` as never,
            retentionUntil: drizzleSql`(now() + interval '5 years')::date` as never,
          })
          .returning({ id: customers.id });
        if (!c) throw new Error('guest customer insert returned no row');

        // Synthetic unique address on a reserved-invalid domain (RFC 2606).
        // Encrypted + blind-indexed like any email; never disclosed, never
        // signable-in (no credential exists for this row).
        const syntheticEmail = `gast-${c.id}@gast.invalid`;
        const [s] = await tx
          .insert(shoppers)
          .values({
            customerId: c.id,
            emailEncrypted: drizzleSql`encrypt_pii(${syntheticEmail})` as never,
            emailBlindIndex: drizzleSql`blind_index(${syntheticEmail})` as never,
            isGuest: true,
          })
          .returning({ id: shoppers.id });
        if (!s) throw new Error('guest shopper insert returned no row');

        const token = newSessionToken();
        const expiresAt = new Date(Date.now() + SHOPPER_SESSION_TTL_MS);
        await tx.insert(shopperSessions).values({
          shopperId: s.id,
          token,
          expiresAt,
          ipAddress: (req.ip ?? null) as never,
          userAgent: req.headers['user-agent'] ?? null,
        });

        return { shopperId: s.id, token, expiresAt };
      });

      setShopperCookie(reply, result.token, result.expiresAt);
      return reply.status(201).send({ shopperId: result.shopperId, guest: true });
    },
  );
};

export default storefrontGuestRoutes;
