/**
 * storefront-account-rights.ts — the two rights a customer can exercise alone.
 *
 *   GET    /api/storefront/account/export — DSGVO Art. 15 + 20, everything we
 *                                           hold about them, in one JSON file.
 *   DELETE /api/storefront/account        — DSGVO Art. 17, erase the account.
 *
 * WHY THIS FILE EXISTS: the customer app already had both buttons, wired to
 * these two paths. Neither route existed, so every customer who tapped either
 * one got a 404 dressed up as an error message. The right to a copy of your
 * data and the right to have it erased are not features you advertise and then
 * do not implement.
 *
 * ── On "delete everything" ────────────────────────────────────────────────
 * Complete deletion is NOT what German law permits here, and a shop that did
 * it would be breaking a different law to satisfy this one. Once a purchase
 * exists, § 147 AO and § 257 HGB require the business records to be kept for
 * ten years, and Art. 17(3)(b) DSGVO explicitly yields to that obligation.
 *
 * So erasure means: every piece of personal data that is not legally nailed
 * down is destroyed or overwritten, and the fiscal skeleton that must survive
 * keeps only a pseudonym. That is exactly what erase_customer() (migration
 * 0078) already does across roughly fifteen tables, and it is the same
 * function the staff-side Art. 17 route uses. This route does not reinvent
 * it; it authorises the CUSTOMER to trigger it on their own record, which is
 * the part that was missing.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { deleteKycImage } from '../lib/kyc-store.js';
import { requireShopper } from '../lib/shopper.js';

export interface StorefrontAccountRightsOpts {
  env: Env;
}

/** One order or reservation, as the customer's own copy should read. */
interface ExportOrderRow extends Record<string, unknown> {
  id: string;
  status: string;
  created_at: string;
  reserved_at: string | null;
  expires_at: string | null;
  items: unknown;
}

const storefrontAccountRightsRoutes: FastifyPluginAsync<
  StorefrontAccountRightsOpts
> = async (app, opts) => {
  // ── GET /api/storefront/account/export ───────────────────────────────────
  app.get(
    '/api/storefront/account/export',
    {
      schema: {
        tags: ['storefront'],
        summary:
          'DSGVO Art. 15 and 20: a machine readable copy of everything stored ' +
          'about the signed in customer.',
        response: {
          200: Type.Object({
            generatedAt: Type.String(),
            format: Type.String(),
            account: Type.Any(),
            addresses: Type.Any(),
            orders: Type.Array(Type.Any()),
            note: Type.String(),
          }),
        },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      const shopperId = req.shopper.id;

      const payload = await app.withPii(async (tx) => {
        const who = await tx.execute<{
          full_name: string | null;
          given_name: string | null;
          family_name: string | null;
          email: string | null;
          phone: string | null;
          preferred_language: string | null;
          marketing_consent: boolean;
          marketing_consent_at: string | null;
          email_verified_at: string | null;
          created_at: string;
          last_seen_at: string | null;
          registered_with_google: boolean;
          customer_number: string | null;
          ship_name: string | null;
          ship_line1: string | null;
          ship_line2: string | null;
          ship_postal: string | null;
          ship_city: string | null;
          shipping_country: string | null;
        }>(drizzleSql`
          SELECT decrypt_pii(c.full_name_encrypted)              AS full_name,
                 decrypt_pii(s.given_name_encrypted)             AS given_name,
                 decrypt_pii(s.family_name_encrypted)            AS family_name,
                 decrypt_pii(s.email_encrypted)                  AS email,
                 decrypt_pii(s.phone_encrypted)                  AS phone,
                 s.preferred_language,
                 s.marketing_consent,
                 s.marketing_consent_at::text                    AS marketing_consent_at,
                 s.email_verified_at::text                       AS email_verified_at,
                 s.created_at::text                              AS created_at,
                 s.last_seen_at::text                            AS last_seen_at,
                 (s.google_sub IS NOT NULL)                      AS registered_with_google,
                 c.customer_number,
                 decrypt_pii(s.shipping_recipient_name_encrypted) AS ship_name,
                 decrypt_pii(s.shipping_address_line1_encrypted)  AS ship_line1,
                 decrypt_pii(s.shipping_address_line2_encrypted)  AS ship_line2,
                 decrypt_pii(s.shipping_postal_code_encrypted)    AS ship_postal,
                 decrypt_pii(s.shipping_city_encrypted)           AS ship_city,
                 s.shipping_country
            FROM shoppers s
            JOIN customers c ON c.id = s.customer_id
           WHERE s.id = ${shopperId}
           LIMIT 1`);
        const r = who[0];

        // Their whole order history, each with its lines. A copy of your data
        // that omits what you actually bought is not a copy of your data.
        const orders = await tx.execute<ExportOrderRow>(drizzleSql`
          SELECT ca.id,
                 ca.status::text        AS status,
                 ca.created_at::text    AS created_at,
                 ca.reserved_at::text   AS reserved_at,
                 -- The pickup deadline is NOT on carts. It lives on the
                 -- reserved products, reachable through the reservation
                 -- session, which is how the staff orders endpoint derives
                 -- it too. Taking the latest keeps the whole basket honest.
                 (SELECT MAX(pr.reservation_expires_at)::text
                    FROM products pr
                   WHERE pr.reserved_by_session_id = ca.reservation_session_id) AS expires_at,
                 COALESCE(
                   (SELECT json_agg(json_build_object(
                             'name', p.name,
                             'sku', p.sku,
                             'unitPriceEur', ci.unit_price_eur::text)
                           ORDER BY ci.added_at)
                      FROM cart_items ci
                      JOIN products p ON p.id = ci.product_id
                     WHERE ci.cart_id = ca.id),
                   '[]'::json) AS items
            FROM carts ca
           WHERE ca.shopper_id = ${shopperId}
           ORDER BY ca.created_at DESC`);

        return {
          generatedAt: new Date().toISOString(),
          format: 'application/json',
          account: {
            customerNumber: r?.customer_number ?? null,
            fullName: r?.full_name ?? null,
            givenName: r?.given_name ?? null,
            familyName: r?.family_name ?? null,
            email: r?.email ?? null,
            phone: r?.phone ?? null,
            preferredLanguage: r?.preferred_language ?? null,
            emailVerifiedAt: r?.email_verified_at ?? null,
            registeredWithGoogle: r?.registered_with_google ?? false,
            marketingConsent: r?.marketing_consent ?? false,
            marketingConsentAt: r?.marketing_consent_at ?? null,
            createdAt: r?.created_at ?? null,
            lastSeenAt: r?.last_seen_at ?? null,
          },
          addresses: {
            shipping: r?.ship_line1
              ? {
                  recipient: r.ship_name,
                  line1: r.ship_line1,
                  line2: r.ship_line2,
                  postalCode: r.ship_postal,
                  city: r.ship_city,
                  country: r.shipping_country,
                }
              : null,
          },
          orders: Array.from(orders).map((o) => ({
            reference: o.id,
            status: o.status,
            createdAt: o.created_at,
            reservedAt: o.reserved_at,
            collectBy: o.expires_at,
            items: o.items,
          })),
          note:
            'Diese Datei enthält alle personenbezogenen Daten, die wir zu Ihrem ' +
            'Konto gespeichert haben (Art. 15 und Art. 20 DSGVO). Kaufbelege ' +
            'unterliegen zusätzlich der steuerlichen Aufbewahrungspflicht.',
        };
      });

      return reply.status(200).send(payload);
    },
  );

  // ── DELETE /api/storefront/account ───────────────────────────────────────
  app.delete(
    '/api/storefront/account',
    {
      schema: {
        tags: ['storefront'],
        summary:
          'DSGVO Art. 17: erase the signed in customer. Open reservations are ' +
          'released first. Fiscal records are kept with the personal data removed.',
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            erasedAt: Type.String(),
            releasedReservations: Type.Integer(),
          }),
        },
      },
    },
    async (req, reply) => {
      requireShopper(req);
      const shopperId = req.shopper.id;

      const result = await app.withPii(async (tx) => {
        const own = await tx.execute<{ customer_id: string }>(drizzleSql`
          SELECT customer_id FROM shoppers WHERE id = ${shopperId} LIMIT 1`);
        const customerId = own[0]?.customer_id;
        if (!customerId) return null;

        // ── Release what the shop is holding, BEFORE erasing ───────────────
        // Basel's rule: goods never stay reserved for someone who no longer
        // exists in the system. Cancel the carts and hand the pieces back to
        // the catalog in one statement each, so nothing is left held for a
        // person nobody can contact any more.
        const released = await tx.execute<{ id: string }>(drizzleSql`
          UPDATE carts
             SET status = 'CANCELLED'::cart_status, updated_at = now()
           WHERE shopper_id = ${shopperId}
             AND status IN ('ACTIVE'::cart_status, 'RESERVED'::cart_status)
          RETURNING id`);

        await tx.execute(drizzleSql`
          UPDATE products p
             SET status = 'AVAILABLE'::product_status,
                 reserved_by_session_id = NULL,
                 reserved_by_channel = NULL,
                 reserved_by_user_id = NULL,
                 reserved_at = NULL,
                 reservation_expires_at = NULL,
                 updated_at = now()
            FROM cart_items ci
            JOIN carts ca ON ca.id = ci.cart_id
           WHERE ci.product_id = p.id
             AND ca.shopper_id = ${shopperId}
             AND p.status = 'RESERVED'::product_status`);

        // The proven Art. 17 path. The customer is the actor on their own
        // record, which is what the audit entry should say.
        const keys = await tx.execute<{ keys: { kyc_storage_keys?: string[] } }>(
          drizzleSql`SELECT erase_customer(${customerId}::uuid, NULL) AS keys`,
        );

        // WER es veranlasst hat (0103): hier war es der Mensch selbst. Die
        // Akte trägt das ab jetzt sichtbar, damit die Kundenliste „hat sein
        // Konto selbst gelöscht" von „wurde von uns gelöscht" unterscheiden
        // kann, statt beides gleich aussehen zu lassen. Kundennummer und alle
        // Vorgänge bleiben in beiden Fällen unberührt.
        await tx.execute(
          drizzleSql`UPDATE customers SET erasure_initiated_by = 'CUSTOMER' WHERE id = ${customerId}::uuid`,
        );

        // Eine Tagebuchzeile, auch beim kunden-eigenen Löschen. Bisher schrieb
        // NUR die Personal-Route eine, und erase_customer selbst keine, also
        // hinterließ eine kunden-initiierte Löschung überhaupt keine Spur: auf
        // der Produktion standen zwei gelöschte Konten null „customer.erased"-
        // Zeilen gegenüber. DSGVO Art. 5 Abs. 2 verlangt aber, dass der
        // Verantwortliche eine Löschung NACHWEISEN kann. actor_user_id bleibt
        // NULL, weil der Handelnde kein Personal ist; die Kundennummer im
        // Rumpf macht die Zeile auffindbar, ohne die gelöschten Daten zu nennen.
        await tx.execute(drizzleSql`
          INSERT INTO audit_log (event_type, actor_user_id, ip_address, user_agent, payload)
          VALUES ('customer.erased', NULL, ${req.ip ?? null}, ${req.headers['user-agent'] ?? null},
                  ${JSON.stringify({ customerId, initiatedBy: 'customer' })}::jsonb)`);

        // Every session dies with the account, including the one making this
        // request. Sign-out only SOFT-revokes (revoked_at, 0106) to keep a
        // forensic trail; an ERASURE is the opposite intent — the person is
        // gone, so their session rows must leave entirely, not linger revoked.
        // Hence a hard DELETE here. erase_customer does this too; doing it here
        // as well is harmless and keeps the route's own guarantee true even if
        // the function is changed.
        await tx.execute(drizzleSql`
          DELETE FROM shopper_sessions WHERE shopper_id = ${shopperId}`);

        return {
          released: Array.from(released).length,
          storageKeys: keys[0]?.keys?.kyc_storage_keys ?? [],
        };
      });

      if (!result) {
        return reply.status(200).send({
          ok: true,
          erasedAt: new Date().toISOString(),
          releasedReservations: 0,
        });
      }

      // Unlink identity images only AFTER the transaction committed: a rolled
      // back erasure with the files already gone would be unrecoverable.
      for (const key of result.storageKeys) {
        await deleteKycImage(opts.env.KYC_PHOTOS_DIR, key).catch((err: unknown) => {
          req.log.warn({ err, key }, 'account erasure: image unlink failed');
        });
      }

      return reply.status(200).send({
        ok: true,
        erasedAt: new Date().toISOString(),
        releasedReservations: result.released,
      });
    },
  );
};

export default storefrontAccountRightsRoutes;
