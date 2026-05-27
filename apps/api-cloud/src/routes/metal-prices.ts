/**
 * Metal-prices routes — Edelmetall-Kursmodul (Day 23).
 *
 *   GET  /api/metal-prices/current  — { prices: [{ metal, pricePerGramEur, … }] }
 *                                     Always 4 entries (gold/silver/platinum/palladium),
 *                                     `null` price when no row exists yet.
 *                                     ADMIN + CASHIER.
 *
 *   GET  /api/metal-prices/history?metal=&limit=&offset=
 *                                   — paged history. ADMIN-only.
 *
 *   POST /api/metal-prices          — Owner manual override.
 *                                     Body: { metal, pricePerGramEur, reason }
 *                                     Mandatory step-up. Writes audit_log.
 *                                     Performs close-out + insert in one TX
 *                                     against the partial UNIQUE.
 *
 *   GET  /api/products/:id/valuation — schmelzwert + collector_premium +
 *                                      suggested ask + margin-over-scrap.
 *                                      ADMIN + CASHIER.
 *
 * Money math relies on the SQL helpers `current_metal_price_eur_per_gram` and
 * `product_schmelzwert_eur` so rounding is identical to the DB-side view (the
 * Schmelzwert column ROUNDs HALF-AWAY-FROM-ZERO to 2dp via NUMERIC arithmetic).
 */

import { Type } from '@sinclair/typebox';
import { and, asc, count, desc, eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, metalPrices, METAL_KIND, type MetalKind } from '@warehouse14/db/schema';
import { Money } from '@warehouse14/domain';

import { DomainError, type ApiErrorCode } from '../plugins/error-handler.js';
import { requireAuth, requireOwnerStepUp, requireRole } from '../lib/auth-policy.js';
import {
  CurrentMetalPricesResponse,
  ManualOverrideBody,
  ManualOverrideResponse,
  MetalPriceHistoryQuery,
  MetalPriceHistoryResponse,
  ProductValuationParams,
  ProductValuationResponse,
  type TManualOverrideBody,
  type TMetalPriceHistoryQuery,
  type TProductValuationParams,
} from '../schemas/metal-prices.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const metalPricesRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/metal-prices/current
  // ────────────────────────────────────────────────────────────────────
  app.get('/api/metal-prices/current', {
    schema: {
      tags: ['metal-prices'],
      summary: 'Current price per gram (EUR) for all 4 metals.',
      description:
        'Always returns exactly 4 entries (gold/silver/platinum/palladium). ' +
        'When no row exists for a metal yet, fields are nulled — UI shows ' +
        '"awaiting first fix".',
      response: {
        200: CurrentMetalPricesResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'ADMIN', 'CASHIER');

    // One round-trip — SELECT the CURRENT row per metal.
    const rows = await app.db
      .select({
        metal: metalPrices.metal,
        pricePerGramEur: metalPrices.pricePerGramEur,
        source: metalPrices.source,
        fetchedAt: metalPrices.fetchedAt,
        validFrom: metalPrices.validFrom,
      })
      .from(metalPrices)
      .where(drizzleSql`${metalPrices.validTo} IS NULL`);

    const byMetal = new Map(rows.map((r) => [r.metal as MetalKind, r]));
    const prices = METAL_KIND.map((m) => {
      const r = byMetal.get(m);
      return r
        ? {
            metal: m,
            pricePerGramEur: r.pricePerGramEur,
            source: r.source,
            fetchedAt: r.fetchedAt.toISOString(),
            validFrom: r.validFrom.toISOString(),
          }
        : {
            metal: m,
            pricePerGramEur: null,
            source: null,
            fetchedAt: null,
            validFrom: null,
          };
    });

    return reply.status(200).send({ prices });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /api/metal-prices/history
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TMetalPriceHistoryQuery }>('/api/metal-prices/history', {
    schema: {
      tags: ['metal-prices'],
      summary: 'Paged metal-price history.',
      description:
        'Ordered DESC by valid_from. Filter by metal to narrow. ADMIN-only because ' +
        'the response carries the operator who issued each MANUAL override.',
      querystring: MetalPriceHistoryQuery,
      response: {
        200: MetalPriceHistoryResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'ADMIN');

    const q = req.query;
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    const whereClause = q.metal !== undefined ? eq(metalPrices.metal, q.metal) : undefined;

    const [rows, totalRow] = await Promise.all([
      app.db
        .select({
          id: metalPrices.id,
          metal: metalPrices.metal,
          pricePerGramEur: metalPrices.pricePerGramEur,
          source: metalPrices.source,
          validFrom: metalPrices.validFrom,
          validTo: metalPrices.validTo,
          fetchedAt: metalPrices.fetchedAt,
          manualOverrideByUserId: metalPrices.manualOverrideByUserId,
          manualOverrideReason: metalPrices.manualOverrideReason,
        })
        .from(metalPrices)
        .where(whereClause)
        .orderBy(desc(metalPrices.validFrom), asc(metalPrices.id))
        .limit(limit)
        .offset(offset),
      app.db.select({ n: count() }).from(metalPrices).where(whereClause),
    ]);

    const total = Number(totalRow[0]?.n ?? 0);

    return reply.status(200).send({
      items: rows.map((r) => ({
        id: r.id.toString(),
        metal: r.metal as MetalKind,
        pricePerGramEur: r.pricePerGramEur,
        source: r.source,
        validFrom: r.validFrom.toISOString(),
        validTo: r.validTo ? r.validTo.toISOString() : null,
        fetchedAt: r.fetchedAt.toISOString(),
        manualOverrideByUserId: r.manualOverrideByUserId,
        manualOverrideReason: r.manualOverrideReason,
      })),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /api/metal-prices — Owner MANUAL override
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TManualOverrideBody }>('/api/metal-prices', {
    schema: {
      tags: ['metal-prices'],
      summary: 'Owner manual override of the current metal price.',
      description:
        'Mandatory step-up + Owner-only. Closes any existing CURRENT row ' +
        'and inserts a new one with source=MANUAL plus the operator id and ' +
        'reason for forensics. Same TX writes audit_log.metal_price.overridden.',
      body: ManualOverrideBody,
      response: {
        200: ManualOverrideResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req); // narrows req.actor + req.session for the rest of the handler
    requireOwnerStepUp(req);

    const { deviceId } = req;
    if (deviceId == null) {
      throw new DeviceRequiredError(
        'Manual price override requires an mTLS-authenticated device.',
      );
    }
    const actorId = req.actor.id;
    const body = req.body;

    const result = await app.db.transaction(async (tx) => {
      // Close existing CURRENT row, if any.
      const currentRows = await tx
        .select({
          id: metalPrices.id,
          pricePerGramEur: metalPrices.pricePerGramEur,
        })
        .from(metalPrices)
        .where(
          and(
            eq(metalPrices.metal, body.metal),
            drizzleSql`${metalPrices.validTo} IS NULL`,
          ),
        )
        .limit(1);
      const previous = currentRows[0];

      if (previous) {
        await tx
          .update(metalPrices)
          .set({ validTo: drizzleSql`now()` })
          .where(eq(metalPrices.id, previous.id));
      }

      const [inserted] = await tx
        .insert(metalPrices)
        .values({
          metal: body.metal,
          pricePerGramEur: body.pricePerGramEur,
          source: 'MANUAL',
          sourcePayload: { manual: true } as Record<string, unknown>,
          manualOverrideByUserId: actorId,
          manualOverrideReason: body.reason,
        })
        .returning({
          metal: metalPrices.metal,
          pricePerGramEur: metalPrices.pricePerGramEur,
          validFrom: metalPrices.validFrom,
        });
      if (!inserted) {
        throw new Error('metal_prices INSERT returned no row');
      }

      await tx.insert(auditLog).values({
        eventType: 'metal_price.overridden',
        actorUserId: actorId,
        deviceId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: {
          metal: body.metal,
          newPricePerGramEur: body.pricePerGramEur,
          previousPricePerGramEur: previous?.pricePerGramEur ?? null,
          reason: body.reason,
        },
      });

      return {
        metal: inserted.metal as MetalKind,
        pricePerGramEur: inserted.pricePerGramEur,
        validFrom: inserted.validFrom.toISOString(),
        previousPricePerGramEur: previous?.pricePerGramEur ?? null,
      };
    });

    return reply.status(200).send({
      metal: result.metal,
      pricePerGramEur: result.pricePerGramEur,
      source: 'MANUAL' as const,
      validFrom: result.validFrom,
      previousPricePerGramEur: result.previousPricePerGramEur,
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /api/products/:id/valuation
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Params: TProductValuationParams }>('/api/products/:id/valuation', {
    schema: {
      tags: ['metal-prices', 'products'],
      summary: 'Schmelzwert + collector_premium + suggested ask price.',
      description:
        'Returns NULL fields when the underlying data is missing (no metal, ' +
        'no weight, no fineness, or no current price for the metal). Math is ' +
        'computed by the SQL helper product_schmelzwert_eur() so it matches ' +
        'every other read of the same value.',
      params: ProductValuationParams,
      response: {
        200: ProductValuationResponse,
        404: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
    },
  }, async (req, reply) => {
    requireAuth(req);
    requireRole(req, 'ADMIN', 'CASHIER');

    const productId = req.params.id;

    // Single round-trip: SELECT the product + helper output + current price.
    const rows = await app.db.execute<{
      id: string;
      metal: string | null;
      weight_grams: string | null;
      fineness_decimal: string | null;
      feingewicht_grams: string | null;
      collector_premium_eur: string | null;
      list_price_eur: string;
      current_price: string | null;
      schmelzwert: string | null;
      priced_at: Date | null;
    }>(drizzleSql`
      SELECT
        p.id,
        p.metal,
        p.weight_grams,
        p.fineness_decimal,
        p.feingewicht_grams,
        p.collector_premium_eur,
        p.list_price_eur,
        current_metal_price_eur_per_gram(p.metal)         AS current_price,
        product_schmelzwert_eur(p.id)                      AS schmelzwert,
        (SELECT valid_from FROM metal_prices
           WHERE metal = p.metal AND valid_to IS NULL
           LIMIT 1)                                        AS priced_at
      FROM products p
      WHERE p.id = ${productId}
      LIMIT 1`);

    const row = (rows as unknown as Array<{
      id: string;
      metal: string | null;
      weight_grams: string | null;
      fineness_decimal: string | null;
      feingewicht_grams: string | null;
      collector_premium_eur: string | null;
      list_price_eur: string;
      current_price: string | null;
      schmelzwert: string | null;
      priced_at: Date | null;
    }>)[0];

    if (!row) {
      throw new ProductNotFoundError(`Product ${productId} not found`);
    }

    // Derived figures — compute via Money so rounding matches the rest of the API.
    const schmelz = row.schmelzwert ? Money.parse(row.schmelzwert) : null;
    const premium = row.collector_premium_eur ? Money.parse(row.collector_premium_eur) : null;
    const list = Money.parse(row.list_price_eur);

    const suggested = schmelz && premium ? schmelz.add(premium).toString() : null;
    const marginOverScrap = schmelz ? list.subtract(schmelz).toString() : null;

    return reply.status(200).send({
      productId: row.id,
      metal: row.metal as MetalKind | null,
      weightGrams: row.weight_grams,
      finenessDecimal: row.fineness_decimal,
      feingewichtGrams: row.feingewicht_grams,
      currentPricePerGramEur: row.current_price,
      schmelzwertEur: row.schmelzwert,
      collectorPremiumEur: row.collector_premium_eur,
      suggestedAskPriceEur: suggested,
      listPriceEur: row.list_price_eur,
      marginOverScrapEur: marginOverScrap,
      pricedAt: row.priced_at ? row.priced_at.toISOString() : null,
    });
  });
};

export default metalPricesRoutes;
