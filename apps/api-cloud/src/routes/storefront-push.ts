/**
 * Kundengeräte für Benachrichtigungen (0105).
 *
 *   POST   /api/storefront/push-token   Marke des Kunden anmelden/auffrischen
 *   DELETE /api/storefront/push-token   Marke widerrufen (Abmelden, Abschalten)
 *
 * Das Gegenstück zu `routes/devices.ts`, aber für die KUNDSCHAFT: dort hängt die
 * Marke an einem Mitarbeiter (`user_id`), hier an einem Kunden (`shopper_id`),
 * und der Kanal ist `'shop'`. Basels Befund am 24.07.2026 war, dass genau diese
 * Hälfte fehlte: der Kunde erteilte im Shop die Erlaubnis, aber seine Marke
 * fand keinen Weg zum Server und starb auf dem Gerät.
 *
 * EINE MARKE GEHÖRT ZU EINEM GERÄT. Meldet sich auf demselben Telefon ein
 * anderer Mensch an, wandert die Marke mit (der eindeutige Index liegt auf der
 * Marke). Das `ON CONFLICT (token)` schreibt den Besitzer um, statt eine zweite
 * Zeile anzulegen, die dem Vorbesitzer weiter fremde Bestellungen meldete —
 * inklusive des Falls, dass ein Personalgerät (owner/cashier) und dann ein
 * Kunde dieselbe Marke tragen: der CHECK `device_push_tokens_owner_matches_app`
 * erzwingt, dass beim Umschreiben genau EIN Besitzer gesetzt ist.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireShopper } from '../lib/shopper.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const RegisterBody = Type.Object({
  token: Type.String({ minLength: 8, maxLength: 400 }),
  platform: Type.Union([Type.Literal('ios'), Type.Literal('android')]),
});
type TRegisterBody = { token: string; platform: 'ios' | 'android' };

const RevokeBody = Type.Object({ token: Type.String({ minLength: 8, maxLength: 400 }) });

const storefrontPushRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TRegisterBody }>(
    '/api/storefront/push-token',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Dieses Kundengerät für Benachrichtigungen anmelden.',
        body: RegisterBody,
        response: {
          200: Type.Object({ ok: Type.Boolean() }),
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      const b = req.body;
      // app='shop', user_id BLEIBT NULL — der CHECK verlangt genau das. Beim
      // Umschreiben einer Marke, die vorher einem Mitarbeiter gehörte, wird
      // user_id ausdrücklich auf NULL gesetzt, sonst verletzte die Zeile den
      // Besitzer-CHECK.
      await app.db.execute(drizzleSql`
        INSERT INTO device_push_tokens (shopper_id, user_id, token, platform, app)
        VALUES (${req.shopper.id}::uuid, NULL, ${b.token}, ${b.platform}, 'shop')
        ON CONFLICT (token) DO UPDATE
           SET shopper_id   = EXCLUDED.shopper_id,
               user_id      = NULL,
               platform     = EXCLUDED.platform,
               app          = 'shop',
               device_label = NULL,
               last_seen_at = now(),
               revoked_at   = NULL`);
      return reply.status(200).send({ ok: true });
    },
  );

  app.delete<{ Body: { token: string } }>(
    '/api/storefront/push-token',
    {
      schema: {
        tags: ['storefront'],
        summary: 'Dieses Kundengerät von Benachrichtigungen abmelden.',
        body: RevokeBody,
        response: {
          200: Type.Object({ ok: Type.Boolean(), revoked: Type.Boolean() }),
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      // `revoked` sagt ehrlich, ob wirklich etwas widerrufen wurde. Nur eigene
      // Marken: ein Kunde kann keine fremde abmelden.
      const rows = (await app.db.execute<{ id: string }>(drizzleSql`
        UPDATE device_push_tokens SET revoked_at = now()
         WHERE token = ${req.body.token}
           AND shopper_id = ${req.shopper.id}::uuid
           AND revoked_at IS NULL
        RETURNING id::text AS id`)) as unknown as Array<{ id: string }>;
      return reply.status(200).send({ ok: true, revoked: rows.length > 0 });
    },
  );
};

export default storefrontPushRoutes;
