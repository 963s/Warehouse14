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
import {
  composeOrderAccepted,
  composeOrderReady,
  composeDeadlineExtended,
  composeItemRemoved,
  composeReservationCancelled,
  enqueueEmail,
} from '@warehouse14/email';
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

/**
 * Warum eine Bestellung nicht mehr bearbeitbar ist, in der Sprache des Hauses.
 * Nur die Zustände, die eine Bestellung mit Nummer überhaupt annehmen kann;
 * ein unbekannter Wert wird roh genannt statt geraten.
 */
const CART_STATUS_DE: Record<string, string> = {
  ABANDONED: 'verfallen',
  CANCELLED: 'storniert',
  CONVERTED: 'bereits übergeben und abgerechnet',
  ACTIVE: 'nicht mehr reserviert',
  CHECKOUT: 'nicht mehr reserviert',
};

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
  fulfilment_method: string;
  fulfilment_status: string;
  shipping_address: string | null;
  shipping_country: string | null;
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
  /** ABHOLUNG oder VERSAND. Entscheidet, welche Arbeit ansteht. */
  fulfilmentMethod: string;
  fulfilmentStatus: string;
  /**
   * Die Lieferanschrift als mehrzeiliger Text, oder null bei einer Abholung.
   * Sie ist der Inhalt der Versandmarke.
   */
  shippingAddress: string | null;
  /** Zweibuchstabiges Land der Lieferung, oder null. */
  shippingCountry: string | null;
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
    fulfilmentMethod: r.fulfilment_method,
    fulfilmentStatus: r.fulfilment_status,
    shippingAddress: r.shipping_address,
    shippingCountry: r.shipping_country,
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
         c.fulfilment_method::text           AS fulfilment_method,
         c.fulfilment_status::text           AS fulfilment_status,
         -- Die Lieferanschrift, entschlüsselt INNERHALB von withPii. Sie ist
         -- der Inhalt der Versandmarke: ohne sie kann niemand ein Paket
         -- adressieren. Bei einer Abholung ist sie NULL, und das ist richtig.
         decrypt_pii(c.shipping_address_encrypted) AS shipping_address,
         c.shipping_country                  AS shipping_country,
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
           c.fulfilment_method, c.fulfilment_status,
           c.shipping_address_encrypted, c.shipping_country,
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
           WHERE c.status = 'RESERVED'
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
      // Der geschützte UPDATE kann aus drei verschiedenen Gründen null Zeilen
      // treffen, und der Mensch am Tresen muss erfahren, welcher es war. Die
      // Diagnose liest deshalb BEIDE Bedingungen zurück, nicht nur den Stand:
      // eine verfallene Reservierung stand am 23.07.2026 live auf „OFFEN" und
      // die Meldung sagte trotzdem „steht nicht mehr auf OFFEN (jetzt: OFFEN)".
      // Ein Satz, der sich selbst widerspricht, ist schlimmer als keiner.
      const exists = (await app.db.execute<{ status: string; pickup_stage: string | null }>(drizzleSql`
        SELECT status::text AS status, pickup_stage::text AS pickup_stage FROM carts
         WHERE order_number = ${orderNumber} AND fulfilment_method = 'PICKUP' LIMIT 1`)) as unknown as Array<{
        status: string;
        pickup_stage: string | null;
      }>;
      const found = exists[0];
      if (!found) {
        throw new OrderNotFoundError(`Bestellung ${orderNumber} nicht gefunden`);
      }
      if (found.status !== 'RESERVED') {
        throw new WrongStageError(
          `Bestellung ${orderNumber} ist ${CART_STATUS_DE[found.status] ?? `im Zustand ${found.status}`} und kann nicht mehr bearbeitet werden.`,
        );
      }
      throw new WrongStageError(
        `Bestellung ${orderNumber} steht nicht mehr auf „${from}“ (jetzt: ${found.pickup_stage ?? 'unbekannt'}).`,
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


  /**
   * Wer zu einer Bestellung gehört, entschlüsselt gelesen.
   *
   * Dieselbe Abfrage brauchen der Annahme-, der Abholbereit- und der
   * Absage-Brief. Einmal geschrieben statt dreimal, damit eine Korrektur an
   * einer Stelle nicht zwei stille Abweichungen hinterlässt.
   *
   * Eine Gast-Anschrift auf `@gast.invalid` ist KEINE Anschrift: sie ist der
   * Platzhalter für einen Gast, der nur eine Telefonnummer hinterlassen hat.
   * An sie wird nicht geschrieben, und der Aufrufer erfährt es an `null`.
   */
  async function orderRecipient(
    tx: { execute: (q: ReturnType<typeof drizzleSql>) => Promise<unknown> },
    orderNumber: string,
  ): Promise<{
    orderNumber: string | null;
    name: string | null;
    email: string | null;
    locale: string;
    customerId: string | null;
  } | null> {
    const rows = (await tx.execute(drizzleSql`
      SELECT c.order_number,
             decrypt_pii(cu.full_name_encrypted) AS name,
             CASE WHEN s.is_guest THEN decrypt_pii(cu.email_encrypted)
                  ELSE decrypt_pii(s.email_encrypted) END AS email,
             COALESCE(s.preferred_language, 'de') AS locale,
             cu.id::text AS customer_id
        FROM carts c
        JOIN shoppers s ON s.id = c.shopper_id
        JOIN customers cu ON cu.id = s.customer_id
       WHERE c.order_number = ${orderNumber} LIMIT 1`)) as unknown as Array<{
      order_number: string | null;
      name: string | null;
      email: string | null;
      locale: string | null;
      customer_id: string | null;
    }>;
    const r = rows[0];
    if (!r) return null;
    const usable = r.email && !r.email.endsWith('@gast.invalid') ? r.email : null;
    return {
      orderNumber: r.order_number,
      name: r.name,
      email: usable,
      locale: r.locale ?? 'de',
      customerId: r.customer_id,
    };
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

  /**
   * `/ready` braucht ein EIGENES Antwortschema.
   *
   * Fastify serialisiert streng nach dem erklärten Schema und wirft jedes
   * Feld weg, das dort nicht steht. Mit dem gemeinsamen `transitionSchema`
   * schickte die Route zwar `{ ok, mailed }`, beim Tresen kam aber nur
   * `{ ok: true }` an — die eine Auskunft, für die der ganze try/catch
   * gebaut wurde, verschwand lautlos. Live gemessen am 23.07.2026.
   */
  const readySchema = {
    ...transitionSchema,
    response: {
      ...transitionSchema.response,
      200: Type.Object({ ok: Type.Boolean(), mailed: Type.Boolean() }),
    },
  };

  // OFFEN → ANGENOMMEN
  app.post<{ Params: { orderNumber: string } }>(
    '/api/orders/:orderNumber/approve',
    { schema: { ...readySchema, summary: 'Reservierung annehmen (ADMIN + CASHIER).' } },
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

      // Der einzige Brief zwischen Reservieren und Bereitliegen. Er sagt der
      // Kundschaft, dass ein Mensch zugesagt hat. Best-effort wie die anderen,
      // aber `mailed` verschweigt nichts: die Oberfläche erfährt, ob er
      // wirklich eingereiht wurde.
      let mailed = false;
      try {
        await app.withPii(async (tx) => {
          const r = await orderRecipient(tx, req.params.orderNumber);
          if (r?.email) {
            await enqueueEmail(
              tx,
              r.email,
              composeOrderAccepted(r.name, r.orderNumber ?? req.params.orderNumber, r.locale),
              r.customerId,
            );
            mailed = true;
          }
        });
      } catch (err) {
        req.log.warn({ err }, 'Annahme-Brief konnte nicht eingereiht werden');
      }

      return reply.status(200).send({ ok: true, mailed });
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
    { schema: { ...readySchema, summary: 'Als abholbereit melden (ADMIN + CASHIER).' } },
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

  // ── Ablehnen ──────────────────────────────────────────────────────────────
  //
  // Ablehnen ist bewusst KEIN weiterer Abholstand, sondern das Ende: die
  // Stücke gehen zurück ins Regal und der Beleg wird CANCELLED, ein Zustand,
  // den der Kundenshop bereits überall richtig anzeigt. Ein zusätzlicher Stand
  // hätte jede Abfrage, jeden Filter und jede Bedingung angefasst, um dasselbe
  // zu sagen.
  //
  // Erlaubt aus JEDEM laufenden Stand, auch aus „abholbereit": es kommt vor,
  // dass ein Stück beim Vorbereiten als beschädigt auffällt, und dann muss man
  // absagen dürfen, statt einen Menschen für nichts kommen zu lassen.
  app.post<{ Params: { orderNumber: string }; Body: { reason?: string } }>(
    '/api/orders/:orderNumber/reject',
    {
      schema: {
        tags: ['orders'],
        summary: 'Bestellung ablehnen und die Stücke freigeben (ADMIN + CASHIER).',
        params: Type.Object({ orderNumber: Type.String({ maxLength: 32 }) }),
        body: Type.Object({ reason: Type.Optional(Type.String({ maxLength: 500 })) }),
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            released: Type.Integer(),
            mailed: Type.Boolean(),
          }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      const orderNumber = req.params.orderNumber;
      const reason = req.body?.reason?.trim() || null;
      const actorId = req.actor?.id ?? null;

      // Der geschützte UPDATE und die Freigabe in EINEM Vorgang. Bräche die
      // Freigabe nach dem Storno, läge ein Stück für immer auf RESERVED für
      // eine Bestellung, die es nicht mehr gibt.
      const result = await app.db.transaction(async (tx) => {
        const cancelled = (await tx.execute<{ id: string; session: string | null }>(drizzleSql`
          UPDATE carts
             SET status               = 'CANCELLED',
                 cancelled_at         = now(),
                 cancelled_by_user_id = ${actorId}::uuid,
                 cancelled_by_role    = 'STAFF',
                 cancellation_reason  = ${reason},
                 updated_at           = now()
           WHERE order_number = ${orderNumber}
             AND status       = 'RESERVED'
          RETURNING id::text AS id, reservation_session_id::text AS session`)) as unknown as Array<{
          id: string;
          session: string | null;
        }>;

        if (cancelled.length === 0) {
          const exists = (await tx.execute<{ status: string }>(drizzleSql`
            SELECT status::text AS status FROM carts
             WHERE order_number = ${orderNumber} LIMIT 1`)) as unknown as Array<{ status: string }>;
          const found = exists[0];
          if (!found) throw new OrderNotFoundError(`Bestellung ${orderNumber} nicht gefunden`);
          throw new WrongStageError(
            `Bestellung ${orderNumber} ist ${CART_STATUS_DE[found.status] ?? `im Zustand ${found.status}`} und kann nicht mehr abgelehnt werden.`,
          );
        }

        // Die Stücke zurück ins Regal. Nur die, die dieser Halt wirklich hält.
        const session = cancelled[0]!.session;
        const freed = session
          ? ((await tx.execute<{ id: string }>(drizzleSql`
              UPDATE products
                 SET status                 = 'AVAILABLE'::product_status,
                     reserved_by_session_id = NULL,
                     reserved_by_channel    = NULL,
                     reserved_by_user_id    = NULL,
                     reserved_at            = NULL,
                     reservation_expires_at = NULL
               WHERE reserved_by_session_id = ${session}::uuid
                 AND status = 'RESERVED'::product_status
              RETURNING id::text AS id`)) as unknown as Array<{ id: string }>)
          : [];

        await tx.insert(auditLog).values({
          eventType: 'web_order.rejected',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: { orderNumber, reason, releasedCount: freed.length },
        });

        return { released: freed.length };
      });

      // Die Absage an die Kundschaft. Wie die anderen Briefe: best-effort,
      // aber `mailed` sagt ehrlich, ob sie eingereiht wurde.
      let mailed = false;
      try {
        await app.withPii(async (tx) => {
          const r = await orderRecipient(tx, orderNumber);
          if (r?.email) {
            await enqueueEmail(
              tx,
              r.email,
              composeReservationCancelled(r.name, r.orderNumber ?? orderNumber, r.locale),
              r.customerId,
            );
            mailed = true;
          }
        });
      } catch (err) {
        req.log.warn({ err }, 'Absage-Brief konnte nicht eingereiht werden');
      }

      return reply.status(200).send({ ok: true, released: result.released, mailed });
    },
  );

  // ── Eine EINZELNE Position herausnehmen ────────────────────────────────────
  //
  // Basels Wunsch, 23.07.2026: „يختار يلغي يغير يعدل يبدل من الطلبات".
  //
  // Bis hierher konnte das Personal eine Bestellung nur GANZ ablehnen. War
  // eines von drei Stücken beim Vorbereiten beschädigt, musste die ganze
  // Bestellung sterben — die Kundschaft bekam eine Absage für zwei Stücke, die
  // tadellos im Regal lagen. Das ist kein fehlendes Feature, das ist ein
  // verlorener Verkauf und ein unnötig enttäuschter Mensch.
  //
  // Das Stück geht in DERSELBEN Transaktion zurück in den Verkauf. Bräche die
  // Freigabe nach dem Löschen der Position, läge es für immer auf RESERVED für
  // eine Bestellung, die es nicht mehr enthält.
  //
  // DIE LETZTE POSITION IST KEINE ENTFERNUNG, SONDERN EINE ABSAGE. Sie wird
  // deshalb abgelehnt, mit dem Hinweis auf den richtigen Weg: eine leere
  // Bestellung, die weiter auf RESERVED steht, wäre ein Gespenst in der
  // Warteschlange, das niemand mehr abholen kann.
  app.delete<{ Params: { orderNumber: string; productId: string } }>(
    '/api/orders/:orderNumber/items/:productId',
    {
      schema: {
        tags: ['orders'],
        summary: 'Eine Position aus der Bestellung nehmen und das Stück freigeben.',
        params: Type.Object({
          orderNumber: Type.String({ maxLength: 32 }),
          productId: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            remaining: Type.Integer(),
            mailed: Type.Boolean(),
          }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      const { orderNumber, productId } = req.params;
      const actorId = req.actor?.id ?? null;

      const result = await app.db.transaction(async (tx) => {
        const carts = (await tx.execute<{ id: string; session: string | null; anzahl: number }>(
          drizzleSql`
          SELECT c.id::text AS id, c.reservation_session_id::text AS session,
                 (SELECT COUNT(*)::int FROM cart_items WHERE cart_id = c.id) AS anzahl
            FROM carts c
           WHERE c.order_number = ${orderNumber} AND c.status = 'RESERVED'
           LIMIT 1`,
        )) as unknown as Array<{ id: string; session: string | null; anzahl: number }>;

        const cart = carts[0];
        if (!cart) {
          throw new OrderNotFoundError(
            `Bestellung ${orderNumber} ist nicht offen. Nur eine laufende Reservierung lässt sich ändern.`,
          );
        }
        if (cart.anzahl <= 1) {
          throw new WrongStageError(
            'Das ist die letzte Position. Eine Bestellung ohne Stücke gibt es nicht — ' +
              'bitte die Bestellung ablehnen, dann erfährt die Kundschaft auch den Grund.',
          );
        }

        const removed = (await tx.execute<{ name: string | null }>(drizzleSql`
          DELETE FROM cart_items ci
           USING products p
           WHERE ci.cart_id = ${cart.id}::uuid
             AND ci.product_id = ${productId}::uuid
             AND p.id = ci.product_id
          RETURNING p.name AS name`)) as unknown as Array<{ name: string | null }>;

        if (removed.length === 0) {
          throw new OrderNotFoundError('Diese Position gehört nicht zu dieser Bestellung.');
        }

        // Zurück in den Verkauf, in DERSELBEN Transaktion.
        await tx.execute(drizzleSql`
          UPDATE products
             SET status = 'AVAILABLE', reserved_by_session_id = NULL,
                 reservation_expires_at = NULL, updated_at = now()
           WHERE id = ${productId}::uuid
             AND reserved_by_session_id = ${cart.session}::uuid`);

        await tx.insert(auditLog).values({
          eventType: 'web_order.item_removed',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            orderNumber,
            cartId: cart.id,
            productId,
            productName: removed[0]?.name ?? null,
            remaining: cart.anzahl - 1,
          },
        });

        return { remaining: cart.anzahl - 1, name: removed[0]?.name ?? null };
      });

      // Der Brief. Was die Kundschaft abholt und zahlt, hat sich geändert —
      // das darf sie nicht erst am Tresen erfahren.
      let mailed = false;
      try {
        await app.withPii(async (tx) => {
          const r = await orderRecipient(tx, orderNumber);
          if (r?.email) {
            await enqueueEmail(
              tx,
              r.email,
              composeItemRemoved(
                r.name,
                r.orderNumber ?? orderNumber,
                result.name ?? 'ein Stück',
                result.remaining,
                r.locale,
              ),
              r.customerId,
            );
            mailed = true;
          }
        });
      } catch (err) {
        req.log.error({ err }, 'Brief zur entfernten Position konnte nicht eingereiht werden');
      }

      return reply.status(200).send({ ok: true, remaining: result.remaining, mailed });
    },
  );

  // ── Die Abholfrist verlängern ──────────────────────────────────────────────
  //
  // Der zweite Teil derselben Freiheit. Ruft jemand an und sagt, er schaffe es
  // erst Samstag, konnte das Personal bisher NICHTS tun: die Reservierung
  // verfiel nach drei Tagen, die Stücke gingen zurück in den Verkauf, und die
  // Vertrauensstufe zählte es als Nichtabholung. Ein Mensch wurde also dafür
  // bestraft, dass er angerufen hat.
  //
  // Die Frist hängt an den STÜCKEN (`products.reservation_expires_at`), nicht
  // am Warenkorb — sie werden deshalb alle zusammen verlängert, sonst ginge
  // eines früher zurück in den Verkauf als das andere.
  //
  // Der Erinnerungs-Merker wird zurückgesetzt: die neue Frist verdient ihre
  // eigene Erinnerung, sonst bekäme die Kundschaft für die verlängerte Frist
  // gar keine mehr.
  app.post<{ Params: { orderNumber: string }; Body: { days?: number } }>(
    '/api/orders/:orderNumber/extend',
    {
      schema: {
        tags: ['orders'],
        summary: 'Die Abholfrist einer laufenden Reservierung verlängern.',
        params: Type.Object({ orderNumber: Type.String({ maxLength: 32 }) }),
        body: Type.Object({
          // Eine Obergrenze, weil eine Reservierung ein Versprechen an ANDERE
          // Interessenten ist: das Stück ist so lange aus dem Verkauf.
          days: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 3 })),
        }),
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            newDeadline: Type.String({ format: 'date-time' }),
            items: Type.Integer(),
            mailed: Type.Boolean(),
          }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      const orderNumber = req.params.orderNumber;
      const days = req.body?.days ?? 3;
      const actorId = req.actor?.id ?? null;

      const result = await app.db.transaction(async (tx) => {
        const carts = (await tx.execute<{ id: string; session: string | null }>(drizzleSql`
          SELECT id::text AS id, reservation_session_id::text AS session
            FROM carts
           WHERE order_number = ${orderNumber} AND status = 'RESERVED'
           LIMIT 1`)) as unknown as Array<{ id: string; session: string | null }>;

        const cart = carts[0];
        if (!cart) {
          throw new OrderNotFoundError(
            `Bestellung ${orderNumber} ist nicht offen. Nur eine laufende Reservierung lässt sich verlängern.`,
          );
        }

        // Ab JETZT, nicht ab der alten Frist: ist sie schon abgelaufen, wäre
        // eine Verlängerung „um drei Tage" sonst eine Frist in der
        // Vergangenheit — also gar keine.
        const rows = (await tx.execute<{ neu: string }>(drizzleSql`
          UPDATE products
             SET reservation_expires_at = now() + (${days} || ' days')::interval,
                 updated_at = now()
           WHERE reserved_by_session_id = ${cart.session}::uuid
             AND status = 'RESERVED'
          RETURNING to_char(reservation_expires_at AT TIME ZONE 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS neu`)) as unknown as Array<{
          neu: string;
        }>;

        if (rows.length === 0) {
          throw new WrongStageError(
            'Zu dieser Bestellung liegt kein reserviertes Stück mehr. Die Frist lässt sich nicht verlängern.',
          );
        }

        // Die neue Frist verdient eine neue Erinnerung.
        await tx.execute(drizzleSql`
          UPDATE carts SET expiry_reminder_sent_at = NULL, updated_at = now()
           WHERE id = ${cart.id}::uuid`);

        await tx.insert(auditLog).values({
          eventType: 'web_order.deadline_extended',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: { orderNumber, cartId: cart.id, days, items: rows.length },
        });

        return { newDeadline: rows[0]!.neu, items: rows.length };
      });

      let mailed = false;
      try {
        await app.withPii(async (tx) => {
          const r = await orderRecipient(tx, orderNumber);
          if (r?.email) {
            await enqueueEmail(
              tx,
              r.email,
              composeDeadlineExtended(
                r.name,
                r.orderNumber ?? orderNumber,
                new Date(result.newDeadline),
                r.locale,
              ),
              r.customerId,
            );
            mailed = true;
          }
        });
      } catch (err) {
        req.log.error({ err }, 'Brief zur verlaengerten Frist konnte nicht eingereiht werden');
      }

      return reply
        .status(200)
        .send({ ok: true, newDeadline: result.newDeadline, items: result.items, mailed });
    },
  );
};

export default ordersRoutes;
