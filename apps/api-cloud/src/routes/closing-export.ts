/**
 * DATEV export route (Epic K — Part 2).
 *
 *   GET /api/closings/:id/export/datev  — ADMIN + step-up.
 *
 * Loads a daily closing, gathers its day's FINALIZED transactions, maps each to
 * a DATEV booking line, and returns a DATEV-importable CSV as a file download.
 *
 * Auth: ADMIN only + a fresh PIN step-up — a full bookkeeping export is exactly
 * the kind of single-actor, sensitive operation §requireStepUp guards.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type DATEVRow, generateDatevCsv } from '../lib/datev-export.js';
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
    date: tx.finalized_at.toISOString().slice(0, 10), // YYYY-MM-DD → DDMM in exporter
    reference: tx.receipt_locator,
    bookingText: `${tx.direction} ${tx.receipt_locator} (${tx.tax_treatment_code})`,
  };
}

const closingExportRoute: FastifyPluginAsync = async (app) => {
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
      requireRole(req, 'ADMIN');
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
};

export default closingExportRoute;
