/**
 * POST /api/closings/finalize — write the legal Z-Bon (Tagesabschluss).
 *
 * THIS WAS THE MISSING KEYSTONE: nothing wrote `daily_closings`, so DSFinV-K,
 * DATEV, Kassenbericht and the nightly Fiskaly push all read an empty table and
 * produced nothing — a Kassen-Nachschau (§146b AO) would find no Z-Bon at all
 * (§158 AO Verwerfung der Buchführung). This route aggregates a business day's
 * finalized transactions into ONE immutable FINALIZED `daily_closings` row that
 * the whole export chain reads.
 *
 * Semantics are locked to how the Kassenbericht (`lib/kassenbericht-export.ts`)
 * presents the figures:
 *   • gross_*  = SUM(total_eur)     per direction (brutto, incl. VAT; stornos net in)
 *   • net_*    = SUM(subtotal_eur)  per direction (netto)
 *   • vat_by_treatment   = SUM(vat_eur) grouped by tax_treatment_code (VERKAUF output VAT)
 *   • payments_by_method = SUM(amount_eur) grouped by payment_method (VERKAUF tender)
 *   • cash_*   = aggregated from the day's CLOSED shifts' Blindsturz (expected/counted/variance)
 *   • tse_*    = signature evidence counts
 *   • ledger_anchor_* = the chain head at finalize time (ADR-0008 checkpoint)
 *
 * The day must be settled first: no OPEN shift may remain for the business day,
 * and a day with sales must have at least one CLOSED shift (so the drawer is
 * counted). Once written the row is immutable (the validate-state trigger locks
 * every figure except `notes`). Re-finalizing a day is a 409.
 *
 * ADMIN + step-up — the same gate as the fiscal exports.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { fromCents, toCents } from '../lib/money-cents.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ClosingConflictError extends DomainError {
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

const FinalizeBody = Type.Object({
  /** Berlin business day (YYYY-MM-DD). Omit to finalize the current business day. */
  businessDay: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
});

const FinalizeResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  businessDay: Type.String(),
  state: Type.Literal('FINALIZED'),
  verkaufCount: Type.Integer(),
  ankaufCount: Type.Integer(),
  stornoCount: Type.Integer(),
  grossVerkaufEur: Type.String(),
  netVerkaufEur: Type.String(),
  cashExpectedEur: Type.String(),
  cashCountedEur: Type.String(),
  cashVarianceEur: Type.String(),
  finalizedAt: Type.String({ format: 'date-time' }),
});

const closingsFinalizeRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { businessDay?: string } }>(
    '/api/closings/finalize',
    {
      schema: {
        tags: ['closings'],
        summary: 'Finalize the legal Z-Bon (Tagesabschluss) for a business day.',
        description:
          "Aggregates the day's finalized transactions + the closed shifts' cash count into one " +
          'immutable FINALIZED daily_closings row — the source the DSFinV-K / DATEV / Kassenbericht ' +
          'exports read. ADMIN + step-up. Re-finalizing a day returns 409.',
        body: FinalizeBody,
        response: {
          200: FinalizeResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const out = await app.db.transaction(async (tx) => {
        // 1. Resolve the target Berlin business day (body, else current).
        const [dayRow] = await tx.execute<{ day: string }>(sql`
          SELECT COALESCE(${req.body.businessDay ?? null}::date, berlin_business_day(now()))::text AS day`);
        const day = dayRow!.day;

        // E3: take the EXCLUSIVE advisory lock on this business day BEFORE reading
        // any aggregate. It waits for every in-flight sale-finalize (each holds
        // the SHARED lock on the same key) to commit, then blocks new ones for the
        // rest of this transaction, so the aggregates below see a consistent
        // snapshot: no sale can commit into the day while we compute and write its
        // Z-Bon. Same key derivation as transactions-finalize. Released at COMMIT.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(1146, (${day}::date - DATE '1970-01-01')::int)`);

        // 2. Not already finalized for this day.
        const existing = await tx.execute<{ id: string }>(sql`
          SELECT id FROM daily_closings WHERE business_day = ${day}::date LIMIT 1`);
        if (existing[0]) {
          throw new ClosingConflictError(`Der Tagesabschluss für ${day} besteht bereits.`);
        }

        // 3. The day must be settled — no OPEN shift opened on that day.
        const openShift = await tx.execute<{ id: string }>(sql`
          SELECT id FROM shifts
           WHERE status = 'OPEN' AND berlin_business_day(opened_at) = ${day}::date
           LIMIT 1`);
        if (openShift[0]) {
          throw new ClosingConflictError(
            `Für ${day} ist noch eine Kasse geöffnet. Bitte zuerst die Schicht abschließen (Kassensturz).`,
          );
        }

        // 4. Transaction aggregates for the day.
        const [agg] = await tx.execute<{
          verkauf_count: number;
          ankauf_count: number;
          storno_count: number;
          gross_verkauf: string;
          net_verkauf: string;
          gross_ankauf: string;
          net_ankauf: string;
          tx_total: number;
        }>(sql`
          SELECT
            COUNT(*) FILTER (WHERE direction = 'VERKAUF' AND storno_of_transaction_id IS NULL)::int AS verkauf_count,
            COUNT(*) FILTER (WHERE direction = 'ANKAUF'  AND storno_of_transaction_id IS NULL)::int AS ankauf_count,
            COUNT(*) FILTER (WHERE storno_of_transaction_id IS NOT NULL)::int                       AS storno_count,
            COALESCE(SUM(total_eur)    FILTER (WHERE direction = 'VERKAUF'), 0)::text AS gross_verkauf,
            COALESCE(SUM(subtotal_eur) FILTER (WHERE direction = 'VERKAUF'), 0)::text AS net_verkauf,
            COALESCE(SUM(total_eur)    FILTER (WHERE direction = 'ANKAUF'),  0)::text AS gross_ankauf,
            COALESCE(SUM(subtotal_eur) FILTER (WHERE direction = 'ANKAUF'),  0)::text AS net_ankauf,
            COUNT(*)::int AS tx_total
          FROM transactions
         WHERE berlin_business_day(finalized_at) = ${day}::date`);

        // 5. VAT per treatment (VERKAUF output VAT) + payments per method (VERKAUF tender).
        //
        // Grouped at ITEM level, not receipt level. A receipt whose lines span
        // several treatments carries the transaction-level code 'MIXED', and
        // grouping by that produced a bucket literally named MIXED holding VAT
        // that belongs to no tax rate. On 2026-06-08 that was 27,78 EUR sitting
        // outside every rate: unusable for a Umsatzsteuervoranmeldung, where
        // each amount has to land in a specific rate box, and irreconcilable
        // with the DATEV export, which already splits mixed receipts per
        // treatment (see toDatevRows in closing-export.ts). Same day, same
        // money, two different answers.
        //
        // The item rows carry `applied_tax_treatment_code` and `line_vat_eur`,
        // and they sum EXACTLY to the receipt VAT (verified on the live mixed
        // receipt: 16,76 + 11,02 = 27,78, difference 0,00). So this only
        // re-attributes; the day's total output VAT is unchanged to the cent.
        //
        // The LEFT JOIN plus COALESCE keeps a receipt that has no item rows at
        // all: it falls back to its own transaction-level code and vat_eur,
        // exactly like the DATEV builder does, so no VAT can silently vanish.
        const [vatRow] = await tx.execute<{ vat: Record<string, string> }>(sql`
          SELECT COALESCE(jsonb_object_agg(code, amt), '{}'::jsonb) AS vat FROM (
            SELECT code, SUM(vat)::text AS amt FROM (
              SELECT COALESCE(i.applied_tax_treatment_code::text, t.tax_treatment_code::text) AS code,
                     COALESCE(i.line_vat_eur, t.vat_eur) AS vat
                FROM transactions t
                LEFT JOIN transaction_items i ON i.transaction_id = t.id
               WHERE berlin_business_day(t.finalized_at) = ${day}::date
                 AND t.direction = 'VERKAUF'
            ) lines
             GROUP BY code
          ) q`);
        const [payRow] = await tx.execute<{ pay: Record<string, string> }>(sql`
          SELECT COALESCE(jsonb_object_agg(method, amt), '{}'::jsonb) AS pay FROM (
            SELECT tp.payment_method::text AS method, SUM(tp.amount_eur)::text AS amt
              FROM transaction_payments tp
              JOIN transactions t ON t.id = tp.transaction_id
             WHERE berlin_business_day(t.finalized_at) = ${day}::date AND t.direction = 'VERKAUF'
             GROUP BY tp.payment_method
          ) q`);

        // 6. Cash drawer — aggregate the day's CLOSED shifts' Blindsturz.
        const [cash] = await tx.execute<{
          expected: string | null;
          counted: string | null;
          shift_count: number;
        }>(sql`
          SELECT
            SUM(system_expected_eur)::text AS expected,
            SUM(blind_count_eur)::text     AS counted,
            COUNT(*)::int                  AS shift_count
          FROM shifts
         WHERE status = 'CLOSED' AND berlin_business_day(closed_at) = ${day}::date`);

        const txTotal = agg!.tx_total;
        const closedShifts = cash!.shift_count;
        // A day with sales must have a counted drawer (a closed shift). Otherwise
        // the cash position is unknown and finalizing would book a false 0.
        if (txTotal > 0 && closedShifts === 0) {
          throw new ClosingConflictError(
            `Für ${day} liegen Belege vor, aber kein Kassensturz. Bitte zuerst die Schicht abschließen.`,
          );
        }
        const expectedCents = closedShifts > 0 ? toCents(cash!.expected) : 0n;
        const countedCents = closedShifts > 0 ? toCents(cash!.counted) : 0n;
        const varianceCents = countedCents - expectedCents;

        // 7. TSE evidence counts — keyed to the day's TRANSACTIONS (joined by
        //    transaction_id), NOT by the signature's recorded_at (which is the
        //    server record time and can fall on the next day for a sale near
        //    midnight). `finished` = this day's transactions that HAVE a signature;
        //    `pending` = a real anti-join (this day's transactions with none).
        //    tse_failed is not yet wired to a failure source — reported as 0 (the
        //    Fiskaly state machine lives in a separate tse_transactions table; a
        //    follow-up surfaces genuine FAILED here). See task 103.
        const [tse] = await tx.execute<{ finished: number; pending: number }>(sql`
          SELECT
            COUNT(*) FILTER (WHERE s.transaction_id IS NOT NULL)::int AS finished,
            COUNT(*) FILTER (WHERE s.transaction_id IS NULL)::int     AS pending
          FROM transactions t
          LEFT JOIN tse_signatures s ON s.transaction_id = t.id
         WHERE berlin_business_day(t.finalized_at) = ${day}::date`);
        const finished = tse!.finished;
        const pending = tse!.pending;

        // 8. Ledger checkpoint anchor — the chain head at finalize time. The
        //    FINALIZED CHECK requires a non-null 32-byte anchor, so a system with
        //    no ledger events cannot be finalized (never the case in production).
        const [anchor] = await tx.execute<{ id: string; row_hash: Uint8Array }>(sql`
          SELECT id::text AS id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`);
        if (!anchor || !anchor.row_hash) {
          throw new ClosingConflictError(
            'Kein Ledger-Anker vorhanden — der Tagesabschluss kann nicht gesetzt werden.',
          );
        }

        // A truly empty day (no transactions, no closed shift) has no counted
        // drawer; the FINALIZED CHECK forbids NULL cash, so we book 0,00 but mark
        // it honestly so it is never mistaken for an actual Kassensturz of 0.
        const emptyDayNote =
          txTotal === 0 && closedShifts === 0 ? 'Umsatzloser Tag — kein Kassensturz.' : null;

        // 9. Write the immutable FINALIZED Z-Bon (one INSERT; the validate-state
        //    trigger is UPDATE-only, so a direct FINALIZED insert is allowed —
        //    the finalized-has-evidence CHECK is satisfied by the fields below).
        //    jsonb is bound as a parameterized text value then cast (injection-safe).
        //    NOTE (V1 single-shop): shop_id is NULL; a multi-shop future must scope
        //    every aggregate + the uniqueness by shop_id (tracked: task 103).
        //    A shift that spans midnight (opened day A, closed day B) is attributed
        //    to its closed_at day here — a documented edge for an overnight till.
        let row: { id: string; finalized_at: string } | undefined;
        try {
          [row] = await tx.execute<{ id: string; finalized_at: string }>(sql`
            INSERT INTO daily_closings (
              business_day, state,
              verkauf_count, ankauf_count, storno_count,
              gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
              vat_by_treatment, payments_by_method,
              cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
              tse_finished_count, tse_pending_count, tse_failed_count,
              ledger_anchor_id, ledger_anchor_hash,
              counted_by_user_id, counted_at, finalized_by_user_id, finalized_at, notes
            ) VALUES (
              ${day}::date, 'FINALIZED'::closing_state,
              ${agg!.verkauf_count}, ${agg!.ankauf_count}, ${agg!.storno_count},
              ${agg!.gross_verkauf}, ${agg!.gross_ankauf}, ${agg!.net_verkauf}, ${agg!.net_ankauf},
              ${JSON.stringify(vatRow!.vat)}::jsonb, ${JSON.stringify(payRow!.pay)}::jsonb,
              ${fromCents(expectedCents)}, ${fromCents(countedCents)}, ${fromCents(varianceCents)},
              ${finished}, ${pending}, 0,
              ${anchor.id}::bigint, ${anchor.row_hash},
              ${req.actor.id}::uuid, now(), ${req.actor.id}::uuid, now(), ${emptyDayNote}
            )
            RETURNING id::text AS id, finalized_at::text AS finalized_at`);
        } catch (e) {
          // A concurrent finalize for the same day loses the business_day UNIQUE
          // race — surface it as a clean 409, not a raw 23505 → 500. In the V1
          // single-shop model (shop_id NULL) the winning guard is the partial
          // index daily_closings_business_day_null_shop_uq (migration 0079); the
          // shop-scoped constraint applies once shop_id is set. Either way it is
          // SQLSTATE 23505.
          const code = (e as { code?: string }).code;
          const msg = (e as Error).message ?? '';
          if (
            code === '23505' ||
            msg.includes('daily_closings_business_day_shop_uq') ||
            msg.includes('daily_closings_business_day_null_shop_uq')
          ) {
            throw new ClosingConflictError(`Der Tagesabschluss für ${day} besteht bereits.`);
          }
          throw e;
        }

        return {
          id: row!.id,
          businessDay: day,
          verkaufCount: agg!.verkauf_count,
          ankaufCount: agg!.ankauf_count,
          stornoCount: agg!.storno_count,
          grossVerkaufEur: agg!.gross_verkauf,
          netVerkaufEur: agg!.net_verkauf,
          cashExpectedEur: fromCents(expectedCents),
          cashCountedEur: fromCents(countedCents),
          cashVarianceEur: fromCents(varianceCents),
          finalizedAt: new Date(row!.finalized_at).toISOString(),
        };
      });

      return reply.status(200).send({ state: 'FINALIZED' as const, ...out });
    },
  );
};

export default closingsFinalizeRoute;
