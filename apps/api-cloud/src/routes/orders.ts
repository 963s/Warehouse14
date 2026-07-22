/**
 * Bestellungen — die Personal-Sicht auf Web-Reservierungen (0099).
 *
 * Bis hierher gab es keine einzige Route, mit der das Personal eine
 * Online-Reservierung annehmen, vorbereiten, als abholbereit melden oder
 * übergeben konnte. Es gab nur die Kunden-Routen und eine kunden-gebundene
 * Lesesicht. Diese Datei schließt die Lücke:
 *
 *   GET  /api/orders                      Warteschlange (alle offenen Abholungen)
 *   GET  /api/orders/:orderNumber         eine Bestellung, mit den Positionen und
 *                                         der Reservierungs-Sitzung, damit die
 *                                         Kasse sie zur Übergabe laden kann
 *   POST /api/orders/:orderNumber/approve   OFFEN            → ANGENOMMEN
 *   POST /api/orders/:orderNumber/prepare   ANGENOMMEN       → IN_VORBEREITUNG
 *   POST /api/orders/:orderNumber/ready     IN_VORBEREITUNG  → ABHOLBEREIT (+ Brief)
 *
 * Die eigentliche Übergabe (ABHOLBEREIT → abgeholt) ist KEIN eigener
 * Fiskalpfad: sie läuft über /api/transactions/finalize mit webOrderNumber,
 * damit der Kassenbon und die §146a-Trigger dieselben bleiben. Diese Datei
 * bereitet den Vorgang nur vor.
 *
 * Jede Zustandsänderung ist ein geschützter UPDATE mit dem ERWARTETEN
 * Ausgangsstand in der WHERE-Klausel. Trifft er null Zeilen, hat ein anderer
 * den Stand schon weitergeschaltet, und wir sagen das ehrlich (409), statt
 * blind zu überschreiben. Jede Änderung schreibt eine Tagebuchzeile.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { auditLog } from '@warehouse14/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { composeOrderReady, enqueueEmail } from '../lib/email-outbox.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class OrderNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
/** Der Beleg steht nicht im erwarteten Stand: schon weitergeschaltet, storniert
 *  oder verfallen. 409, damit die Oberfläche neu laden kann. */
class WrongStageError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

/** Die deutschen Abholstufen aus 0099, in ihrer Reihenfolge. */
const PICKUP_STAGES = ['OFFEN', 'ANGENOMMEN', 'IN_VORBEREITUNG', 'ABHOLBEREIT'] as const;

interface OrderRow {
  id: string;
  order_number: string | null;
  pickup_stage: string | null;
  reservation_session_id: string | null;
  created_at: string;
  expires_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  item_count: number;
  total_eur: string;
  lines: unknown;
}

interface OrderShape {
  id: string;
  orderNumber: string | null;
  pickupStage: string | null;
  reservationSessionId: string | null;
  createdAt: string;
  expiresAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  itemCount: number;
  totalEur: string;
  lines: {
    productId: string | null;
    name: string;
    sku: string | null;
    quantity: number;
    unitPriceEur: string;
  }[];
}

function shape(r: OrderRow): OrderShape {
  return {
    id: r.id,
    orderNumber: r.order_number,
    pickupStage: r.pickup_stage,
    reservationSessionId: r.reservation_session_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    itemCount: r.item_count,
    totalEur: r.total_eur,
    lines: (typeof r.lines === 'string' ? JSON.parse(r.lines) : r.lines) as OrderShape['lines'],
  };
}

/**
 * Das gemeinsame SELECT für eine oder alle Bestellungen. Die Kontaktdaten
 * liegen auf der `customers`-Zeile (dort schreibt sie die Reservierung), also
 * wird innerhalb von `withPii` entschlüsselt. Das Land bleibt außen vor: es
 * geht hier um Abholung, nicht um Versand.
 */
const ORDER_SELECT = drizzleSql`
  SELECT c.id::text AS id,
         c.order_number,
         c.pickup_stage::text AS pickup_stage,
         c.reservation_session_id::text AS reservation_session_id,
         to_char(COALESCE(c.reserved_at, c.created_at) AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
         (SELECT to_char(MAX(pr.reservation_expires_at) AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            FROM products pr
           WHERE pr.reserved_by_session_id = c.reservation_session_id) AS expires_at,
         decrypt_pii(cu.full_name_encrypted) AS contact_name,
         decrypt_pii(cu.phone_encrypted)     AS contact_phone,
         decrypt_pii(cu.email_encrypted)     AS contact_email,
         COUNT(ci.id)::int AS item_count,
         COALESCE(SUM(ci.unit_price_eur * ci.quantity), 0)::text AS total_eur,
         COALESCE(
           json_agg(
             json_build_object(
               'productId', ci.product_id,
               'name', p.name,
               'sku', p.sku,
               'quantity', ci.quantity,
               'unitPriceEur', ci.unit_price_eur::text
             ) ORDER BY ci.added_at
           ) FILTER (WHERE ci.id IS NOT NULL),
           '[]'::json
         ) AS lines
    FROM carts c
    JOIN shoppers s ON s.id = c.shopper_id
    JOIN customers cu ON cu.id = s.customer_id
    LEFT JOIN cart_items ci ON ci.cart_id = c.id
    LEFT JOIN products p ON p.id = ci.product_id`;

const ORDER_GROUP_BY = drizzleSql`
  GROUP BY c.id, c.order_number, c.pickup_stage, c.reservation_session_id,
           c.reserved_at, c.created_at,
           cu.full_name_encrypted, cu.phone_encrypted, cu.email_encrypted`;

const ordersRoutes: FastifyPluginAsync = async (app) => {
  // ── Die Warteschlange ─────────────────────────────────────────────────────
  app.get<{ Querystring: { stage?: string } }>(
    '/api/orders',
    {
      schema: {
        tags: ['orders'],
        summary: 'Offene Abhol-Reservierungen für das Personal (ADMIN + CASHIER).',
        querystring: Type.Object({
          stage: Type.Optional(
            Type.Union(PICKUP_STAGES.map((s) => Type.Literal(s))),
          ),
        }),
        response: { 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const stage = req.query.stage;
      const rows = (await app.withPii((tx) =>
        tx.execute(drizzleSql`
          ${ORDER_SELECT}
           WHERE c.status = 'RESERVED' AND c.fulfilment_method = 'PICKUP'
             ${stage ? drizzleSql`AND c.pickup_stage = ${stage}::pickup_stage` : drizzleSql``}
          ${ORDER_GROUP_BY}
          ORDER BY COALESCE(c.reserved_at, c.created_at) ASC
          LIMIT 200`),
      )) as unknown as OrderRow[];

      return reply.status(200).send({ items: rows.map(shape) });
    },
  );

  // ── Eine Bestellung, zum Laden an der Kasse ───────────────────────────────
  app.get<{ Params: { orderNumber: string } }>(
    '/api/orders/:orderNumber',
    {
      schema: {
        tags: ['orders'],
        summary: 'Eine Web-Bestellung mit Positionen und Reservierungs-Sitzung.',
        params: Type.Object({ orderNumber: Type.String({ maxLength: 32 }) }),
        response: { 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const rows = (await app.withPii((tx) =>
        tx.execute(drizzleSql`
          ${ORDER_SELECT}
           WHERE c.order_number = ${req.params.orderNumber}
             AND c.fulfilment_method = 'PICKUP'
          ${ORDER_GROUP_BY}
          LIMIT 1`),
      )) as unknown as OrderRow[];

      const row = rows[0];
      if (!row) {
        throw new OrderNotFoundError(`Bestellung ${req.params.orderNumber} nicht gefunden`);
      }
      return reply.status(200).send(shape(row));
    },
  );

  /**
   * Ein Übergang: der geschützte UPDATE von einem erwarteten Stand auf den
   * nächsten, plus eine Tagebuchzeile. `stampColumn` merkt den Zeitpunkt, der
   * zu diesem Schritt gehört. Gibt die Bestellnummer zurück, damit der Aufrufer
   * antworten kann, ohne erneut zu lesen.
   */
  async function transition(
    req: FastifyRequest,
    orderNumber: string,
    from: (typeof PICKUP_STAGES)[number],
    to: string,
    stampColumn: 'approved_at' | 'preparation_started_at' | 'ready_at',
    stampActor: boolean,
    eventType: string,
  ): Promise<void> {
    const actorId = req.actor?.id ?? null;
    const updated = (await app.db.execute<{ id: string }>(drizzleSql`
      UPDATE carts
         SET pickup_stage = ${to}::pickup_stage,
             ${drizzleSql.raw(stampColumn)} = now()
             ${stampActor ? drizzleSql`, approved_by_user_id = ${actorId}::uuid` : drizzleSql``}
       WHERE order_number = ${orderNumber}
         AND status = 'RESERVED'
         AND fulfilment_method = 'PICKUP'
         AND pickup_stage = ${from}::pickup_stage
      RETURNING id::text AS id`)) as unknown as Array<{ id: string }>;

    if (updated.length === 0) {
      // Existiert die Bestellung überhaupt? Dann ist es der falsche Stand,
      // sonst gibt es sie nicht (mehr).
      const exists = (await app.db.execute<{ pickup_stage: string | null }>(drizzleSql`
        SELECT pickup_stage::text AS pickup_stage FROM carts
         WHERE order_number = ${orderNumber} AND fulfilment_method = 'PICKUP' LIMIT 1`)) as unknown as Array<{
        pickup_stage: string | null;
      }>;
      if (exists.length === 0) {
        throw new OrderNotFoundError(`Bestellung ${orderNumber} nicht gefunden`);
      }
      throw new WrongStageError(
        `Bestellung ${orderNumber} steht nicht mehr auf „${from}“ (jetzt: ${exists[0]?.pickup_stage ?? 'unbekannt'}).`,
      );
    }

    await app.db.insert(auditLog).values({
      eventType,
      actorUserId: actorId,
      deviceId: req.deviceId ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      payload: { orderNumber, from, to },
    });
  }

  const transitionSchema = {
    tags: ['orders'],
    params: Type.Object({ orderNumber: Type.String({ maxLength: 32 }) }),
    response: {
      200: Type.Object({ ok: Type.Boolean() }),
      401: ErrorResponse,
      403: ErrorResponse,
      404: ErrorResponse,
      409: ErrorResponse,
    },
  };

  // OFFEN → ANGENOMMEN
  app.post<{ Params: { orderNumber: string } }>(
    '/api/orders/:orderNumber/approve',
    { schema: { ...transitionSchema, summary: 'Reservierung annehmen (ADMIN + CASHIER).' } },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      await transition(
        req,
        req.params.orderNumber,
        'OFFEN',
        'ANGENOMMEN',
        'approved_at',
        true,
        'web_order.approved',
      );
      return reply.status(200).send({ ok: true });
    },
  );

  // ANGENOMMEN → IN_VORBEREITUNG
  app.post<{ Params: { orderNumber: string } }>(
    '/api/orders/:orderNumber/prepare',
    { schema: { ...transitionSchema, summary: 'Vorbereitung beginnen (ADMIN + CASHIER).' } },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      await transition(
        req,
        req.params.orderNumber,
        'ANGENOMMEN',
        'IN_VORBEREITUNG',
        'preparation_started_at',
        false,
        'web_order.prepared',
      );
      return reply.status(200).send({ ok: true });
    },
  );

  // IN_VORBEREITUNG → ABHOLBEREIT (+ der Brief „Ihr Stück liegt bereit")
  app.post<{ Params: { orderNumber: string } }>(
    '/api/orders/:orderNumber/ready',
    { schema: { ...transitionSchema, summary: 'Als abholbereit melden (ADMIN + CASHIER).' } },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      await transition(
        req,
        req.params.orderNumber,
        'IN_VORBEREITUNG',
        'ABHOLBEREIT',
        'ready_at',
        false,
        'web_order.ready',
      );

      // Der wichtigste Brief des ganzen Ablaufs: er sagt der Kundschaft, dass
      // sie kommen kann. Best-effort, aber NICHT still verschluckt: schlägt das
      // Einreihen fehl, wird es im Beleg festgehalten (return sagt mailed:false),
      // damit niemand glaubt, der Brief sei unterwegs.
      let mailed = false;
      try {
        await app.withPii(async (tx) => {
          const who = (await tx.execute(drizzleSql`
            SELECT c.order_number,
                   decrypt_pii(cu.full_name_encrypted) AS name,
                   CASE WHEN s.is_guest THEN decrypt_pii(cu.email_encrypted)
                        ELSE decrypt_pii(s.email_encrypted) END AS email,
                   COALESCE(s.preferred_language, 'de') AS locale,
                   cu.id::text AS customer_id
              FROM carts c
              JOIN shoppers s ON s.id = c.shopper_id
              JOIN customers cu ON cu.id = s.customer_id
             WHERE c.order_number = ${req.params.orderNumber} LIMIT 1`)) as unknown as Array<{
            order_number: string | null;
            name: string | null;
            email: string | null;
            locale: string | null;
            customer_id: string | null;
          }>;
          const r = who[0];
          if (r?.email && !r.email.endsWith('@gast.invalid')) {
            await enqueueEmail(
              tx,
              r.email,
              composeOrderReady(r.name, r.order_number ?? req.params.orderNumber, r.locale ?? 'de'),
              r.customer_id,
            );
            mailed = true;
          }
        });
      } catch (err) {
        req.log.warn({ err }, 'order-ready email enqueue failed (non-blocking)');
      }

      return reply.status(200).send({ ok: true, mailed });
    },
  );
};

export default ordersRoutes;
