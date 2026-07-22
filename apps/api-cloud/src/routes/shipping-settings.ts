/**
 * Versandzonen und Versandpreise, die der Inhaber selbst pflegt.
 *
 *   GET    /api/shipping/zones            (ADMIN) — Zonen samt Preisen
 *   POST   /api/shipping/rates            (ADMIN) — einen Preis anlegen
 *   PATCH  /api/shipping/rates/:id        (ADMIN) — einen Preis ändern
 *   DELETE /api/shipping/rates/:id        (ADMIN) — einen Preis stilllegen
 *
 * WARUM DAS DEM INHABER GEHÖRT UND NICHT DEM CODE. Ein Versandpreis ist eine
 * Geschäftsentscheidung, die sich mit dem Portotarif ändert, nicht eine
 * Konstante. Stünde er im Quelltext, bräuchte jede Portoerhöhung einen
 * Entwickler und einen Deploy. Die Migration 0098 hat die Zonen deshalb
 * angelegt und die Preise BEWUSST leer gelassen: ein erfundener Startpreis
 * wäre eine Zahl, die niemand entschieden hat, und der Kunde bekäme sie im
 * Checkout zu sehen.
 *
 * STILLLEGEN STATT LÖSCHEN. Ein Preis, nach dem einmal abgerechnet wurde,
 * hängt an Sendungen und Bestellungen. Wird er entfernt, verliert eine alte
 * Bestellung die Begründung ihres Betrags. `DELETE` setzt darum `active` auf
 * falsch; die Zeile bleibt als Beleg stehen und taucht in keinem neuen
 * Angebot mehr auf.
 *
 * Zonen sind hier absichtlich NUR lesbar. Ihre Ländergruppen bilden die drei
 * umsatzsteuerlichen Fälle ab (Inland, übriges Gemeinschaftsgebiet,
 * Drittland). Wer sie frei verschiebt, verschiebt die Steuerlogik mit, und das
 * ist eine Entscheidung für den Steuerberater, nicht für ein Formular.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class RateNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class RateValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const Money = Type.String({ pattern: '^\\d{1,10}(\\.\\d{1,2})?$' });

const RateView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  zoneId: Type.String({ format: 'uuid' }),
  serviceCode: Type.String(),
  nameDe: Type.String(),
  minWeightG: Type.Integer(),
  maxWeightG: Type.Union([Type.Integer(), Type.Null()]),
  priceEur: Type.String(),
  insuredUpToEur: Type.Union([Type.String(), Type.Null()]),
  freeAboveEur: Type.Union([Type.String(), Type.Null()]),
  active: Type.Boolean(),
  sortOrder: Type.Integer(),
});

const ZoneView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  code: Type.String(),
  nameDe: Type.String(),
  countryCodes: Type.Array(Type.String()),
  isCatchAll: Type.Boolean(),
  active: Type.Boolean(),
  sortOrder: Type.Integer(),
  rates: Type.Array(RateView),
});

const CreateRateBody = Type.Object({
  zoneId: Type.String({ format: 'uuid' }),
  serviceCode: Type.String({ minLength: 1, maxLength: 40 }),
  nameDe: Type.String({ minLength: 1, maxLength: 120 }),
  minWeightG: Type.Integer({ minimum: 0 }),
  maxWeightG: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  priceEur: Money,
  insuredUpToEur: Type.Optional(Type.Union([Money, Type.Null()])),
  freeAboveEur: Type.Optional(Type.Union([Money, Type.Null()])),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
});

const PatchRateBody = Type.Partial(
  Type.Object({
    nameDe: Type.String({ minLength: 1, maxLength: 120 }),
    minWeightG: Type.Integer({ minimum: 0 }),
    maxWeightG: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    priceEur: Money,
    insuredUpToEur: Type.Union([Money, Type.Null()]),
    freeAboveEur: Type.Union([Money, Type.Null()]),
    active: Type.Boolean(),
    sortOrder: Type.Integer({ minimum: 0 }),
  }),
);

type ZoneRow = {
  id: string;
  code: string;
  name_de: string;
  country_codes: string[] | null;
  is_catch_all: boolean;
  active: boolean;
  sort_order: number;
};

type RateRow = {
  id: string;
  zone_id: string;
  service_code: string;
  name_de: string;
  min_weight_g: number;
  max_weight_g: number | null;
  price_eur: string;
  insured_up_to_eur: string | null;
  free_above_eur: string | null;
  active: boolean;
  sort_order: number;
};

function toRateView(r: RateRow) {
  return {
    id: r.id,
    zoneId: r.zone_id,
    serviceCode: r.service_code,
    nameDe: r.name_de,
    minWeightG: Number(r.min_weight_g),
    maxWeightG: r.max_weight_g == null ? null : Number(r.max_weight_g),
    priceEur: r.price_eur,
    insuredUpToEur: r.insured_up_to_eur,
    freeAboveEur: r.free_above_eur,
    active: r.active,
    sortOrder: Number(r.sort_order),
  };
}

/**
 * Zwei Bänder derselben Zone und desselben Produkts dürfen sich nicht
 * überlappen. Täten sie es, hinge der Preis davon ab, welche Zeile die
 * Abfrage zuerst zurückgibt, und derselbe Warenkorb kostete mal so und mal
 * so. Die Datenbank kann das nicht ausdrücken (es ist eine Bereichsprüfung
 * über mehrere Zeilen), also prüft es die Route.
 */
function overlaps(
  a: { minWeightG: number; maxWeightG: number | null },
  b: { minWeightG: number; maxWeightG: number | null },
): boolean {
  const aMax = a.maxWeightG ?? Number.MAX_SAFE_INTEGER;
  const bMax = b.maxWeightG ?? Number.MAX_SAFE_INTEGER;
  return a.minWeightG <= bMax && b.minWeightG <= aMax;
}

const shippingSettingsRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/shipping/zones ───────────────────────────────────────────────
  app.get(
    '/api/shipping/zones',
    {
      schema: {
        tags: ['shipping'],
        summary: 'Versandzonen mit ihren Preisen (ADMIN).',
        description:
          'Die drei Zonen bilden die umsatzsteuerlichen Fälle ab: Inland, übriges ' +
          'Gemeinschaftsgebiet, Drittland. Preise sind je Zone in Gewichtsbändern hinterlegt; ' +
          'ein einziges Band von 0 bis offen ist der Pauschalpreis.',
        response: {
          200: Type.Object({ items: Type.Array(ZoneView) }),
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const zones = (await app.db.execute<ZoneRow>(sql`
        SELECT id::text, code, name_de, country_codes, is_catch_all, active, sort_order
          FROM shipping_zones ORDER BY sort_order, code
      `)) as unknown as ZoneRow[];

      const rates = (await app.db.execute<RateRow>(sql`
        SELECT id::text, zone_id::text, service_code, name_de, min_weight_g, max_weight_g,
               price_eur::text, insured_up_to_eur::text, free_above_eur::text, active, sort_order
          FROM shipping_rates ORDER BY sort_order, min_weight_g
      `)) as unknown as RateRow[];

      return reply.status(200).send({
        items: zones.map((z) => ({
          id: z.id,
          code: z.code,
          nameDe: z.name_de,
          countryCodes: z.country_codes ?? [],
          isCatchAll: z.is_catch_all,
          active: z.active,
          sortOrder: Number(z.sort_order),
          rates: rates.filter((r) => r.zone_id === z.id).map(toRateView),
        })),
      });
    },
  );

  // ── POST /api/shipping/rates ──────────────────────────────────────────────
  app.post<{ Body: typeof CreateRateBody.static }>(
    '/api/shipping/rates',
    {
      schema: {
        tags: ['shipping'],
        summary: 'Einen Versandpreis anlegen (ADMIN).',
        body: CreateRateBody,
        response: { 201: RateView, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const b = req.body;

      if (b.maxWeightG != null && b.maxWeightG <= b.minWeightG) {
        throw new RateValidationError(
          'Das obere Gewicht muss über dem unteren liegen. Für ein nach oben offenes Band bitte kein oberes Gewicht angeben.',
        );
      }

      const siblings = (await app.db.execute<RateRow>(sql`
        SELECT id::text, zone_id::text, service_code, name_de, min_weight_g, max_weight_g,
               price_eur::text, insured_up_to_eur::text, free_above_eur::text, active, sort_order
          FROM shipping_rates
         WHERE zone_id = ${b.zoneId} AND service_code = ${b.serviceCode} AND active
      `)) as unknown as RateRow[];

      const clash = siblings.find((s) =>
        overlaps(
          { minWeightG: b.minWeightG, maxWeightG: b.maxWeightG },
          { minWeightG: Number(s.min_weight_g), maxWeightG: s.max_weight_g == null ? null : Number(s.max_weight_g) },
        ),
      );
      if (clash) {
        throw new RateValidationError(
          `Dieses Gewichtsband überschneidet sich mit „${clash.name_de}". Sonst hinge der Preis davon ab, welche Zeile zuerst gefunden wird.`,
        );
      }

      const rows = (await app.db.execute<RateRow>(sql`
        INSERT INTO shipping_rates
          (zone_id, service_code, name_de, min_weight_g, max_weight_g, price_eur,
           insured_up_to_eur, free_above_eur, sort_order)
        VALUES (${b.zoneId}::uuid, ${b.serviceCode}, ${b.nameDe}, ${b.minWeightG}, ${b.maxWeightG},
                ${b.priceEur}::numeric, ${b.insuredUpToEur ?? null}::numeric,
                ${b.freeAboveEur ?? null}::numeric, ${b.sortOrder ?? 0})
        RETURNING id::text, zone_id::text, service_code, name_de, min_weight_g, max_weight_g,
                  price_eur::text, insured_up_to_eur::text, free_above_eur::text, active, sort_order
      `)) as unknown as RateRow[];

      return reply.status(201).send(toRateView(rows[0]!));
    },
  );

  // ── PATCH /api/shipping/rates/:id ─────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: typeof PatchRateBody.static }>(
    '/api/shipping/rates/:id',
    {
      schema: {
        tags: ['shipping'],
        summary: 'Einen Versandpreis ändern (ADMIN).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: PatchRateBody,
        response: { 200: RateView, 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const b = req.body;

      const rows = (await app.db.execute<RateRow>(sql`
        UPDATE shipping_rates SET
          name_de           = COALESCE(${b.nameDe ?? null}, name_de),
          min_weight_g      = COALESCE(${b.minWeightG ?? null}, min_weight_g),
          max_weight_g      = CASE WHEN ${b.maxWeightG === undefined} THEN max_weight_g
                                   ELSE ${b.maxWeightG ?? null} END,
          price_eur         = COALESCE(${b.priceEur ?? null}::numeric, price_eur),
          insured_up_to_eur = CASE WHEN ${b.insuredUpToEur === undefined} THEN insured_up_to_eur
                                   ELSE ${b.insuredUpToEur ?? null}::numeric END,
          free_above_eur    = CASE WHEN ${b.freeAboveEur === undefined} THEN free_above_eur
                                   ELSE ${b.freeAboveEur ?? null}::numeric END,
          active            = COALESCE(${b.active ?? null}, active),
          sort_order        = COALESCE(${b.sortOrder ?? null}, sort_order),
          updated_at        = now()
        WHERE id = ${req.params.id}
        RETURNING id::text, zone_id::text, service_code, name_de, min_weight_g, max_weight_g,
                  price_eur::text, insured_up_to_eur::text, free_above_eur::text, active, sort_order
      `)) as unknown as RateRow[];

      const row = rows[0];
      if (!row) throw new RateNotFoundError(`Versandpreis ${req.params.id} wurde nicht gefunden.`);
      return reply.status(200).send(toRateView(row));
    },
  );

  // ── DELETE /api/shipping/rates/:id ────────────────────────────────────────
  //    Stilllegen, nicht entfernen: eine alte Bestellung muss die Begründung
  //    ihres Betrags behalten.
  app.delete<{ Params: { id: string } }>(
    '/api/shipping/rates/:id',
    {
      schema: {
        tags: ['shipping'],
        summary: 'Einen Versandpreis stilllegen (ADMIN).',
        description:
          'Setzt `active` auf falsch. Die Zeile bleibt als Beleg bestehen, damit ' +
          'abgerechnete Bestellungen ihre Begründung behalten, und erscheint in keinem ' +
          'neuen Angebot mehr.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: RateView, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const rows = (await app.db.execute<RateRow>(sql`
        UPDATE shipping_rates SET active = false, updated_at = now()
         WHERE id = ${req.params.id}
        RETURNING id::text, zone_id::text, service_code, name_de, min_weight_g, max_weight_g,
                  price_eur::text, insured_up_to_eur::text, free_above_eur::text, active, sort_order
      `)) as unknown as RateRow[];

      const row = rows[0];
      if (!row) throw new RateNotFoundError(`Versandpreis ${req.params.id} wurde nicht gefunden.`);
      return reply.status(200).send(toRateView(row));
    },
  );
};

export default shippingSettingsRoutes;
export { overlaps };
