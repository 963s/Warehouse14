/**
 * Shop identity endpoint — the receipt header (Kassenbon).
 *
 *   GET /api/shop-info  — any authenticated actor (the POS cashier reads it).
 *
 * Returns the shop name / tagline / address / USt-IdNr. / phone from
 * `system_settings` (seeded by migration 0044, Owner-editable via
 * PATCH /api/settings/:key). The POS prints these on every receipt, falling
 * back to its bundled constant if the call fails.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth } from '../lib/auth-policy.js';

const ShopInfoResponse = Type.Object({
  name: Type.String(),
  tagline: Type.String(),
  addressLine1: Type.String(),
  addressLine2: Type.String(),
  vatId: Type.String(),
  phone: Type.String(),
});

type SettingTextRow = { key: string; value: string | null };

const shopInfoRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/shop-info',
    {
      schema: {
        tags: ['settings'],
        summary: 'Shop identity for the receipt header.',
        description: 'Reads the shop.* keys from system_settings (migration 0044).',
        response: { 200: ShopInfoResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);

      // `value #>> '{}'` extracts the text out of a jsonb string value.
      const rows = (await app.db.execute<SettingTextRow>(sql`
        SELECT key, value #>> '{}' AS value
          FROM system_settings
         WHERE key LIKE 'shop.%'
      `)) as unknown as SettingTextRow[];

      const map = new Map(rows.map((r) => [r.key, r.value ?? '']));
      return reply.status(200).send({
        name: map.get('shop.name') ?? 'WAREHOUSE 14',
        tagline: map.get('shop.tagline') ?? '',
        addressLine1: map.get('shop.address_line1') ?? '',
        addressLine2: map.get('shop.address_line2') ?? '',
        vatId: map.get('shop.vat_id') ?? '',
        phone: map.get('shop.phone') ?? '',
      });
    },
  );
};

export default shopInfoRoute;
