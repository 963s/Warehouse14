/**
 * Das Benachrichtigungs- und Marketing-Zentrum (0105).
 *
 *   POST /api/broadcasts   Ein Rundschreiben an die Kundschaft senden
 *   GET  /api/broadcasts   Was zuletzt hinausging (ehrliches Gedaechtnis)
 *
 * Basels Wunsch am 24.07.2026:
 *   „مركز الاشعارات خانة جديده لارسال اشعارات للتطبيق المتجر... احدد الهدف
 *    تطبيق او ايميل وارسل لهم اشعار او ايميل تسويقي اذا كانو موافقين"
 *
 * Der Inhaber schreibt EINEN Gruss (Dank, Feiertag, Neuigkeit), waehlt den
 * Kanal (App-Benachrichtigung, E-Mail oder beides) und den Kreis, und der
 * Server traegt ihn aus — jedem in SEINER Sprache.
 *
 * ZWEI EHRLICHKEITEN, die das Gesetz und der Anstand verlangen:
 *
 *  1. E-MAIL LAEUFT IMMER UEBER DIE EINWILLIGUNG. Eine Werbe-Mail ohne
 *     Zustimmung ist nach UWG §7 unzulaessig. Deshalb erreicht ein
 *     E-Mail-Rundschreiben NUR, wer `marketing_consent = true` gesetzt hat —
 *     unabhaengig davon, was der Absender als Kreis waehlt. Bei der App-
 *     Benachrichtigung ist die Erlaubnis im Betriebssystem die Zustimmung; der
 *     Kreis 'ALL' ist dort zulaessig, 'MARKETING' schraenkt zusaetzlich ein.
 *
 *  2. DIE ZAHLEN SIND GETRENNT UND WAHR. Wie viele je Kanal eingereiht wurden,
 *     und wie viele NICHT erreicht wurden, weil die Einwilligung fehlt. Eine
 *     geschoente Gesamtzahl waere hier dieselbe Luege wie ein stiller Versand.
 *
 * Der Versand selbst liegt wie ueberall im worker (push_outbox, email_outbox);
 * diese Route reiht nur ein und behauptet ueber das Zustellen nichts.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { composeBroadcast, enqueueEmail } from '@warehouse14/email';
import { auditLog } from '@warehouse14/db/schema';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { enqueuePushShopper } from '../lib/push-outbox.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

/** Ein Titel + ein Text je Sprache. Deutsch ist Pflicht (die Haussprache). */
const LocaleContent = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  body: Type.String({ minLength: 1, maxLength: 4000 }),
});

const SendBody = Type.Object({
  viaPush: Type.Boolean(),
  viaEmail: Type.Boolean(),
  audience: Type.Union([Type.Literal('ALL'), Type.Literal('MARKETING')]),
  // Sprach-Karte: { de: {title, body}, ar: {...}, ... }. 'de' Pflicht.
  content: Type.Record(Type.String({ pattern: '^[a-z]{2}$' }), LocaleContent),
  deepLink: Type.Optional(Type.String({ maxLength: 200 })),
});
type TSendBody = {
  viaPush: boolean;
  viaEmail: boolean;
  audience: 'ALL' | 'MARKETING';
  content: Record<string, { title: string; body: string }>;
  deepLink?: string;
};

/** Den Text in der Sprache des Empfaengers, sonst auf Deutsch zurueckfallend. */
function pickContent(
  content: Record<string, { title: string; body: string }>,
  locale: string | null | undefined,
): { title: string; body: string } {
  const code = (locale ?? '').trim().slice(0, 2).toLowerCase();
  return content[code] ?? content.de!;
}

const broadcastsRoutes: FastifyPluginAsync = async (app) => {
  // ── Senden ─────────────────────────────────────────────────────────────────
  app.post<{ Body: TSendBody }>(
    '/api/broadcasts',
    {
      schema: {
        tags: ['broadcasts'],
        summary: 'Ein Rundschreiben an die Kundschaft senden (nur Inhaber).',
        body: SendBody,
        response: {
          200: Type.Object({
            id: Type.String(),
            queuedPush: Type.Integer(),
            queuedEmail: Type.Integer(),
            skippedNoConsent: Type.Integer(),
          }),
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      // Rundschreiben sind Sache des Inhabers, nicht jeder Kasse.
      requireRole(req, 'ADMIN');
      const b = req.body;

      if (!b.viaPush && !b.viaEmail) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION',
            message: 'Mindestens ein Kanal (App oder E-Mail) muss gewaehlt sein.',
            requestId: req.id,
          },
        });
      }
      if (!b.content.de) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION',
            message: 'Der deutsche Text ist Pflicht — er ist die Rueckfallsprache.',
            requestId: req.id,
          },
        });
      }

      // 1. Das Gedaechtnis anlegen, BEVOR gesendet wird. Selbst wenn danach
      //    etwas schiefgeht, ist nachlesbar, was versucht wurde.
      const inserted = (await app.db.execute<{ id: string }>(drizzleSql`
        INSERT INTO customer_broadcasts
          (created_by_user_id, via_push, via_email, audience, content, deep_link)
        VALUES (${req.actor!.id}::uuid, ${b.viaPush}, ${b.viaEmail}, ${b.audience},
                ${JSON.stringify(b.content)}::jsonb, ${b.deepLink ?? null})
        RETURNING id::text AS id`)) as unknown as Array<{ id: string }>;
      const broadcastId = inserted[0]!.id;

      let queuedPush = 0;
      let queuedEmail = 0;

      // 2. App-Benachrichtigungen. Kein PII noetig: Marken und Sprache stehen
      //    unverschluesselt. Bei 'MARKETING' zusaetzlich die Einwilligung.
      if (b.viaPush) {
        const consentClause =
          b.audience === 'MARKETING' ? drizzleSql`AND s.marketing_consent = true` : drizzleSql``;
        const devices = (await app.db.execute(drizzleSql`
          SELECT d.token, COALESCE(s.preferred_language, 'de') AS locale
            FROM device_push_tokens d
            JOIN shoppers s ON s.id = d.shopper_id
           WHERE d.app = 'shop' AND d.revoked_at IS NULL
             AND s.soft_deleted_at IS NULL
             ${consentClause}`)) as unknown as Array<{ token: string; locale: string | null }>;
        for (const dv of devices) {
          const c = pickContent(b.content, dv.locale);
          queuedPush += await enqueuePushShopper(app.db, [{ token: dv.token }], {
            title: c.title,
            body: c.body,
            data: { kind: 'broadcast', ...(b.deepLink ? { deepLink: b.deepLink } : {}) },
          });
        }
      }

      // 3. E-Mails — IMMER nur an Einwilligende, unabhaengig vom gewaehlten
      //    Kreis (UWG). Braucht PII: Adresse und Name werden im Umschlag
      //    entschluesselt.
      if (b.viaEmail) {
        await app.withPii(async (tx) => {
          const recipients = (await tx.execute(drizzleSql`
            SELECT s.id::text AS shopper_id,
                   decrypt_pii(s.email_encrypted) AS email,
                   decrypt_pii(cu.full_name_encrypted) AS name,
                   COALESCE(s.preferred_language, 'de') AS locale,
                   cu.id::text AS customer_id
              FROM shoppers s
              JOIN customers cu ON cu.id = s.customer_id
             WHERE s.marketing_consent = true
               AND s.soft_deleted_at IS NULL
               AND s.is_guest = false
               AND s.email_encrypted IS NOT NULL`)) as unknown as Array<{
            shopper_id: string;
            email: string | null;
            name: string | null;
            locale: string | null;
            customer_id: string | null;
          }>;
          for (const r of recipients) {
            const email = r.email;
            if (!email || email.endsWith('@gast.invalid')) continue;
            const c = pickContent(b.content, r.locale);
            await enqueueEmail(
              tx,
              email,
              composeBroadcast(c.title, c.body, r.name, r.locale),
              r.customer_id,
            );
            queuedEmail += 1;
          }
        });
      }

      // 4. Wie viele blieben AUSSEN, weil die Einwilligung fehlt? Distinkt je
      //    Mensch, nur ueber die Kanaele, die die Einwilligung wirklich
      //    verlangen: E-Mail immer, Push nur bei 'MARKETING'.
      const emailGate = b.viaEmail;
      const pushGate = b.viaPush && b.audience === 'MARKETING';
      let skippedNoConsent = 0;
      if (emailGate || pushGate) {
        const skipRows = (await app.db.execute<{ n: number }>(drizzleSql`
          SELECT count(*)::int AS n FROM shoppers s
           WHERE s.marketing_consent = false
             AND s.soft_deleted_at IS NULL
             AND (
               ${emailGate ? drizzleSql`(s.is_guest = false AND s.email_encrypted IS NOT NULL)` : drizzleSql`false`}
               OR
               ${pushGate ? drizzleSql`EXISTS (SELECT 1 FROM device_push_tokens d WHERE d.shopper_id = s.id AND d.app = 'shop' AND d.revoked_at IS NULL)` : drizzleSql`false`}
             )`)) as unknown as Array<{ n: number }>;
        skippedNoConsent = skipRows[0]?.n ?? 0;
      }

      // 5. Die ehrlichen Zahlen zurueckschreiben.
      await app.db.execute(drizzleSql`
        UPDATE customer_broadcasts
           SET queued_push = ${queuedPush},
               queued_email = ${queuedEmail},
               skipped_no_consent = ${skippedNoConsent}
         WHERE id = ${broadcastId}::uuid`);

      await app.db.insert(auditLog).values({
        eventType: 'customer.broadcast_sent',
        actorUserId: req.actor!.id,
        deviceId: req.deviceId ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: {
          broadcastId,
          viaPush: b.viaPush,
          viaEmail: b.viaEmail,
          audience: b.audience,
          queuedPush,
          queuedEmail,
          skippedNoConsent,
        },
      });

      return reply.status(200).send({ id: broadcastId, queuedPush, queuedEmail, skippedNoConsent });
    },
  );

  // ── Verlauf ──────────────────────────────────────────────────────────────
  app.get(
    '/api/broadcasts',
    {
      schema: {
        tags: ['broadcasts'],
        summary: 'Die zuletzt gesendeten Rundschreiben (nur Inhaber).',
        response: {
          200: Type.Object({
            items: Type.Array(
              Type.Object({
                id: Type.String(),
                createdAt: Type.String(),
                viaPush: Type.Boolean(),
                viaEmail: Type.Boolean(),
                audience: Type.String(),
                title: Type.String(),
                queuedPush: Type.Integer(),
                queuedEmail: Type.Integer(),
                skippedNoConsent: Type.Integer(),
              }),
            ),
          }),
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const rows = (await app.db.execute(drizzleSql`
        SELECT id::text AS id,
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
               via_push, via_email, audience,
               COALESCE(content->'de'->>'title', '') AS title,
               queued_push, queued_email, skipped_no_consent
          FROM customer_broadcasts
         ORDER BY created_at DESC
         LIMIT 50`)) as unknown as Array<{
        id: string;
        created_at: string;
        via_push: boolean;
        via_email: boolean;
        audience: string;
        title: string;
        queued_push: number;
        queued_email: number;
        skipped_no_consent: number;
      }>;
      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          viaPush: r.via_push,
          viaEmail: r.via_email,
          audience: r.audience,
          title: r.title,
          queuedPush: r.queued_push,
          queuedEmail: r.queued_email,
          skippedNoConsent: r.skipped_no_consent,
        })),
      });
    },
  );
};

export default broadcastsRoutes;
