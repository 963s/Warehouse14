/**
 * Closings + tax-export routes (Epic K — Part 2; Steuer-Export surface).
 *
 *   GET /api/closings                              — ADMIN | READONLY
 *   GET /api/closings/:id/export/datev             — ADMIN | READONLY + step-up
 *   GET /api/closings/:id/export/kassenbericht      — ADMIN | READONLY + step-up
 *
 * The DATEV route maps the day's FINALIZED transactions to SKR03 booking lines;
 * the Kassenbericht route re-expresses the stored daily_closing as a German cash
 * report. Both return a CSV file download. READONLY = the Steuerberater (read-
 * only fiscal access). A fresh PIN step-up guards every download — a full
 * bookkeeping export is exactly the single-actor, sensitive op §requireStepUp
 * covers — and the access is audit-logged. Exports are READ-ONLY (GoBD): no
 * fiscal row is ever mutated or recomputed here.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type DATEVRow, generateDatevCsv } from '../lib/datev-export.js';
import { type KassenberichtInput, buildKassenberichtCsv } from '../lib/kassenbericht-export.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ClosingNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

// ── GET /api/closings — list daily closings for the owner's Kassenabschluss ──

const ClosingListItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  businessDay: Type.String(),
  state: Type.Union([Type.Literal('COUNTING'), Type.Literal('FINALIZED')]),
  verkaufCount: Type.Integer(),
  ankaufCount: Type.Integer(),
  stornoCount: Type.Integer(),
  netVerkaufEur: Type.String(),
  netAnkaufEur: Type.String(),
  cashVarianceEur: Type.Union([Type.String(), Type.Null()]),
  tseFailedCount: Type.Integer(),
  finalizedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const ClosingListResponse = Type.Object({ items: Type.Array(ClosingListItem) });

type ClosingRow = {
  id: string;
  business_day: string;
  state: string;
  verkauf_count: number;
  ankauf_count: number;
  storno_count: number;
  net_verkauf_eur: string;
  net_ankauf_eur: string;
  cash_variance_eur: string | null;
  tse_failed_count: number;
  finalized_at: Date | null;
};

/** Full closing row for the Kassenbericht (re-expressed, never recomputed). */
type ClosingFullRow = {
  business_day: string;
  state: string;
  verkauf_count: number;
  ankauf_count: number;
  storno_count: number;
  gross_verkauf_eur: string;
  gross_ankauf_eur: string;
  net_verkauf_eur: string;
  net_ankauf_eur: string;
  vat_by_treatment: Record<string, string> | null;
  payments_by_method: Record<string, string> | null;
  cash_expected_eur: string | null;
  cash_counted_eur: string | null;
  cash_variance_eur: string | null;
  tse_finished_count: number;
  tse_pending_count: number;
  tse_failed_count: number;
  finalized_at: Date | null;
};

/** Standard SKR03 accounts for a counter-trade business (gold/coins/antiques). */
const KONTO_KASSE = '1000'; // Kasse
const KONTO_ERLOESE = '8400'; // Erlöse 19% USt
const KONTO_WARENEINGANG = '3200'; // Wareneingang

// A `type` (not `interface`) so it satisfies the `Record<string, unknown>`
// constraint on `db.execute<T>` (interfaces lack an implicit index signature).
type TxRow = {
  total_eur: string;
  direction: string;
  tax_treatment_code: string;
  receipt_locator: string;
  finalized_at: Date;
};

/** Map one transaction to a DATEV booking line. */
function toDatevRow(tx: TxRow): DATEVRow {
  const isAnkauf = tx.direction === 'ANKAUF';
  // Sale: Kasse an Erlöse (Konto=Kasse, debit). Purchase: Wareneingang an Kasse.
  const account = isAnkauf ? KONTO_WARENEINGANG : KONTO_KASSE;
  const contraAccount = isAnkauf ? KONTO_KASSE : KONTO_ERLOESE;
  return {
    amountEur: tx.total_eur,
    debitCredit: 'S', // Umsatz posts to the debit (Soll) side of Konto.
    account,
    contraAccount,
    date: new Date(tx.finalized_at).toISOString().slice(0, 10), // YYYY-MM-DD → DDMM in exporter
    reference: tx.receipt_locator,
    bookingText: `${tx.direction} ${tx.receipt_locator} (${tx.tax_treatment_code})`,
  };
}

const closingExportRoute: FastifyPluginAsync = async (app) => {
  // ── GET /api/closings — recent daily closings (ADMIN) ────────────────────
  app.get(
    '/api/closings',
    {
      schema: {
        tags: ['closings'],
        summary: 'List recent daily closings for the Owner Kassenabschluss surface (ADMIN).',
        description:
          'Newest-first (by business_day) snapshot of each daily closing: counts, net ' +
          'totals, cash-drawer variance, TSE health, and finalization state.',
        response: { 200: ClosingListResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');

      const rows = (await app.db.execute<ClosingRow>(sql`
        SELECT id::text AS id,
               business_day::text AS business_day,
               state::text AS state,
               verkauf_count, ankauf_count, storno_count,
               net_verkauf_eur::text AS net_verkauf_eur,
               net_ankauf_eur::text  AS net_ankauf_eur,
               cash_drawer_variance_eur::text AS cash_variance_eur,
               tse_failed_count,
               finalized_at
          FROM daily_closings
         ORDER BY business_day DESC
         LIMIT 90
      `)) as unknown as ClosingRow[];

      const items = rows.map((r) => ({
        id: r.id,
        businessDay: r.business_day,
        state: r.state === 'FINALIZED' ? ('FINALIZED' as const) : ('COUNTING' as const),
        verkaufCount: Number(r.verkauf_count),
        ankaufCount: Number(r.ankauf_count),
        stornoCount: Number(r.storno_count),
        netVerkaufEur: r.net_verkauf_eur,
        netAnkaufEur: r.net_ankauf_eur,
        cashVarianceEur: r.cash_variance_eur,
        tseFailedCount: Number(r.tse_failed_count),
        finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
      }));

      return reply.status(200).send({ items });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/closings/:id/export/datev',
    {
      schema: {
        tags: ['closings'],
        summary: 'Download a daily closing as a DATEV-importable CSV (ADMIN + step-up).',
        description:
          'Returns text/plain CSV (EXTF Buchungsstapel header + one booking line ' +
          'per finalized transaction of the closing business day).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { id } = req.params;

      const closingRows = await app.db.execute<{ business_day: string }>(sql`
        SELECT business_day::text AS business_day
          FROM daily_closings
         WHERE id = ${id}
         LIMIT 1`);
      const closing = closingRows[0];
      if (!closing) {
        throw new ClosingNotFoundError(`Daily closing ${id} not found.`);
      }

      // All transactions whose Berlin business day matches the closing.
      const txRows = await app.db.execute<TxRow>(sql`
        SELECT total_eur, direction::text AS direction, tax_treatment_code,
               receipt_locator, finalized_at
          FROM transactions
         WHERE berlin_business_day(finalized_at) = ${closing.business_day}::date
         ORDER BY finalized_at ASC`);

      const datevRows = txRows.map(toDatevRow);
      const csv = await generateDatevCsv(datevRows);

      const filename = `DATEV_${closing.business_day}.csv`;
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.type('text/plain; charset=utf-8');
      return reply.status(200).send(csv);
    },
  );

  // ── GET /api/closings/:id/export/kassenbericht — daily cash report CSV ────
  //    The real `daily_closings` row re-expressed as a German Kassenbericht.
  //    NO recompute / NO fabrication; READ-ONLY. ADMIN + READONLY + step-up.
  app.get<{ Params: { id: string } }>(
    '/api/closings/:id/export/kassenbericht',
    {
      schema: {
        tags: ['closings'],
        summary:
          'Download a daily closing as a German Kassenbericht CSV (ADMIN/READONLY + step-up).',
        description:
          'Returns text/plain CSV — the KassenSichV daily cash report built verbatim from ' +
          'the stored daily_closing (counts, net totals, VAT + payment breakdown, cash ' +
          'count/variance, TSE health). No fiscal figure is recomputed.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { id } = req.params;

      const rows = await app.db.execute<ClosingFullRow>(sql`
        SELECT business_day::text AS business_day,
               state::text AS state,
               verkauf_count, ankauf_count, storno_count,
               gross_verkauf_eur::text AS gross_verkauf_eur,
               gross_ankauf_eur::text  AS gross_ankauf_eur,
               net_verkauf_eur::text   AS net_verkauf_eur,
               net_ankauf_eur::text    AS net_ankauf_eur,
               vat_by_treatment, payments_by_method,
               cash_drawer_expected_eur::text AS cash_expected_eur,
               cash_drawer_counted_eur::text  AS cash_counted_eur,
               cash_drawer_variance_eur::text AS cash_variance_eur,
               tse_finished_count, tse_pending_count, tse_failed_count,
               finalized_at
          FROM daily_closings
         WHERE id = ${id}
         LIMIT 1`);
      const r = rows[0];
      if (!r) {
        throw new ClosingNotFoundError(`Daily closing ${id} not found.`);
      }

      const input: KassenberichtInput = {
        businessDay: r.business_day,
        state: r.state === 'FINALIZED' ? 'FINALIZED' : 'COUNTING',
        verkaufCount: Number(r.verkauf_count),
        ankaufCount: Number(r.ankauf_count),
        stornoCount: Number(r.storno_count),
        grossVerkaufEur: r.gross_verkauf_eur,
        grossAnkaufEur: r.gross_ankauf_eur,
        netVerkaufEur: r.net_verkauf_eur,
        netAnkaufEur: r.net_ankauf_eur,
        vatByTreatment: (r.vat_by_treatment ?? {}) as Record<string, string>,
        paymentsByMethod: (r.payments_by_method ?? {}) as Record<string, string>,
        cashExpectedEur: r.cash_expected_eur,
        cashCountedEur: r.cash_counted_eur,
        cashVarianceEur: r.cash_variance_eur,
        tseFinishedCount: Number(r.tse_finished_count),
        tsePendingCount: Number(r.tse_pending_count),
        tseFailedCount: Number(r.tse_failed_count),
        finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
      };

      const csv = buildKassenberichtCsv(input);
      const filename = `Kassenbericht_${r.business_day}.csv`;
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.type('text/plain; charset=utf-8');
      return reply.status(200).send(csv);
    },
  );
};

export default closingExportRoute;
