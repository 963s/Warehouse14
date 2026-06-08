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
import {
  type DsfinvkBundleInput,
  type DsfinvkReceiptInput,
  buildDsfinvkBundle,
  zipDsfinvkBundle,
} from '../lib/dsfinvk-export.js';
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

// TODO(steuerberater, pre-go-live): EVERY VERKAUF currently posts to the single
// revenue account 8400 (KONTO_ERLOESE) REGARDLESS of tax_treatment_code. This is
// almost certainly wrong for the differently-taxed sales:
//   • STANDARD_19          → 19% Erlöse  (8400 is plausible)
//   • REDUCED_7            → 7%  Erlöse
//   • MARGIN_25A           → Differenzbesteuerung §25a (separate revenue account)
//   • INVESTMENT_GOLD_25C  → steuerfreie Anlagegold-Lieferung §25c (separate account)
// QUESTION FOR THE ACCOUNTANT: which SKR03 revenue account should each
// tax_treatment_code map to? Once answered, replace this single constant with a
// per-treatment lookup. Do NOT guess the account numbers here.
// See docs/samples/README.md + the generated DATEV sample (all three treatments
// visibly share contra 8400 today).

// ── DSFinV-K export row shapes (READ-ONLY; mapped to the pure generator) ──
//   `type` (not `interface`) to satisfy the `Record<string, unknown>` bound on
//   `db.execute<T>`.
type ClosingDsfinvkRow = {
  business_day: string;
  finalized_at: Date | null;
  gross_verkauf_eur: string;
  gross_ankauf_eur: string;
  net_verkauf_eur: string;
  net_ankauf_eur: string;
  vat_by_treatment: Record<string, string> | null;
  payments_by_method: Record<string, string> | null;
  cash_counted_eur: string | null;
};

type DsfinvkTxRow = {
  id: string;
  receipt_locator: string;
  direction: string;
  finalized_at: Date;
  tax_treatment_code: string;
  subtotal_eur: string;
  vat_eur: string;
  total_eur: string;
  cashier_user_id: string;
  customer_id: string | null;
  is_storno: boolean;
};

type DsfinvkItemRow = {
  transaction_id: string;
  display_order: number;
  product_name: string;
  applied_tax_treatment_code: string;
  applied_vat_rate: string | null;
  line_subtotal_eur: string;
  line_vat_eur: string;
  line_total_eur: string;
};

type DsfinvkPaymentRow = {
  transaction_id: string;
  payment_method: string;
  amount_eur: string;
};

type DsfinvkTseRow = {
  transaction_id: string;
  fiskaly_tss_id: string;
  fiskaly_transaction_number: string;
  signature_counter: string;
  signature_value: string;
  signature_algorithm: string | null;
  process_type: string;
  tse_start_time: Date | null;
  tse_end_time: Date | null;
};

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

  // ── GET /api/closings/:id/export/dsfinvk — local DSFinV-K bundle (ZIP) ────
  //    The DFKA-Taxonomie Kassendaten export a Finanzamt requests in a §146b
  //    Kassen-Nachschau (Z3 Datenträgerüberlassung), built LOCALLY from the
  //    real fiscal rows. Same auth as DATEV (ADMIN/READONLY + step-up + mTLS).
  //    READ-ONLY (GoBD): nothing is mutated or recomputed — the generator only
  //    re-expresses existing transactions/items/payments/tse_signatures.
  //
  //    Body encoding:
  //      • default                → raw application/zip (Owner Desktop blob,
  //                                  curl, browser).
  //      • ?encoding=base64       → text/plain base64 of the SAME bytes, for the
  //                                  POS api-client (its file path is text-only;
  //                                  the WebView2 webview decodes base64 → Blob).
  app.get<{ Params: { id: string }; Querystring: { encoding?: string } }>(
    '/api/closings/:id/export/dsfinvk',
    {
      schema: {
        tags: ['closings'],
        summary:
          'Download a daily closing as a local DSFinV-K bundle ZIP (ADMIN/READONLY + step-up).',
        description:
          'Returns a ZIP of the DSFinV-K core taxonomy CSV files (cashpointclosing, ' +
          'bon_kopf, bon_pos, bon_pos_preise, bon_pos_ust, bon_ust, datapayment, tse) ' +
          '+ index.xml, built from the day’s real transactions/items/payments and ' +
          'tse_signatures. CORE, not certified — validate with the official DSFinV-K ' +
          'Prüftool before a real inspection. ?encoding=base64 returns the same bytes ' +
          'base64-encoded as text/plain (for the POS client).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({ encoding: Type.Optional(Type.String()) }),
        response: { 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { id } = req.params;

      const closingRows = await app.db.execute<ClosingDsfinvkRow>(sql`
        SELECT business_day::text AS business_day,
               finalized_at,
               gross_verkauf_eur::text AS gross_verkauf_eur,
               gross_ankauf_eur::text  AS gross_ankauf_eur,
               net_verkauf_eur::text   AS net_verkauf_eur,
               net_ankauf_eur::text    AS net_ankauf_eur,
               vat_by_treatment, payments_by_method,
               cash_drawer_counted_eur::text AS cash_counted_eur
          FROM daily_closings
         WHERE id = ${id}
         LIMIT 1`);
      const closing = closingRows[0];
      if (!closing) {
        throw new ClosingNotFoundError(`Daily closing ${id} not found.`);
      }
      const businessDay = closing.business_day;

      // All transactions of the Berlin business day (header columns).
      const txRows = await app.db.execute<DsfinvkTxRow>(sql`
        SELECT id::text AS id,
               receipt_locator,
               direction::text AS direction,
               finalized_at,
               tax_treatment_code,
               subtotal_eur::text AS subtotal_eur,
               vat_eur::text      AS vat_eur,
               total_eur::text    AS total_eur,
               cashier_user_id::text AS cashier_user_id,
               customer_id::text     AS customer_id,
               (storno_of_transaction_id IS NOT NULL) AS is_storno
          FROM transactions
         WHERE berlin_business_day(finalized_at) = ${businessDay}::date
         ORDER BY finalized_at ASC`);

      const txIds = txRows.map((t) => t.id);

      // Lines, payments, TSE signatures — empty arrays if the day is empty.
      const itemRows =
        txIds.length === 0
          ? []
          : await app.db.execute<DsfinvkItemRow>(sql`
              SELECT ti.transaction_id::text AS transaction_id,
                     ti.display_order,
                     COALESCE(p.name, '') AS product_name,
                     ti.applied_tax_treatment_code,
                     ti.applied_vat_rate::text AS applied_vat_rate,
                     ti.line_subtotal_eur::text AS line_subtotal_eur,
                     ti.line_vat_eur::text      AS line_vat_eur,
                     ti.line_total_eur::text    AS line_total_eur
                FROM transaction_items ti
                LEFT JOIN products p ON p.id = ti.product_id
               WHERE ti.transaction_id = ANY(${txIds}::uuid[])
               ORDER BY ti.transaction_id, ti.display_order ASC`);

      const paymentRows =
        txIds.length === 0
          ? []
          : await app.db.execute<DsfinvkPaymentRow>(sql`
              SELECT transaction_id::text AS transaction_id,
                     payment_method::text AS payment_method,
                     amount_eur::text     AS amount_eur
                FROM transaction_payments
               WHERE transaction_id = ANY(${txIds}::uuid[])
               ORDER BY transaction_id, created_at ASC`);

      const tseRows =
        txIds.length === 0
          ? []
          : await app.db.execute<DsfinvkTseRow>(sql`
              SELECT transaction_id::text AS transaction_id,
                     fiskaly_tss_id::text  AS fiskaly_tss_id,
                     fiskaly_transaction_number::text AS fiskaly_transaction_number,
                     signature_counter::text          AS signature_counter,
                     signature_value,
                     signature_algorithm,
                     process_type,
                     tse_start_time,
                     tse_end_time
                FROM tse_signatures
               WHERE transaction_id = ANY(${txIds}::uuid[])`);

      // Group children by transaction.
      const itemsByTx = new Map<string, DsfinvkItemRow[]>();
      for (const it of itemRows) {
        const arr = itemsByTx.get(it.transaction_id) ?? [];
        arr.push(it);
        itemsByTx.set(it.transaction_id, arr);
      }
      const paymentsByTx = new Map<string, DsfinvkPaymentRow[]>();
      for (const p of paymentRows) {
        const arr = paymentsByTx.get(p.transaction_id) ?? [];
        arr.push(p);
        paymentsByTx.set(p.transaction_id, arr);
      }
      const tseByTx = new Map<string, DsfinvkTseRow>();
      for (const s of tseRows) tseByTx.set(s.transaction_id, s);

      // Cash-register identity: our data has no dedicated register-serial field,
      // so the most-recent TSS id of the day is used as the TSE serial surrogate
      // (documented in dsfinvk-export.ts). Brand/model are fixed product idents.
      const tssSerial = tseRows[0]?.fiskaly_tss_id ?? '';

      const receipts: DsfinvkReceiptInput[] = txRows.map((t) => {
        const lines = (itemsByTx.get(t.id) ?? []).map((it, idx) => ({
          lineNumber: idx + 1,
          productName: it.product_name,
          quantity: '1.000', // qty is not stored per line today → spec default 1.
          appliedTaxTreatmentCode: it.applied_tax_treatment_code,
          appliedVatRate: it.applied_vat_rate,
          lineSubtotalEur: it.line_subtotal_eur,
          lineVatEur: it.line_vat_eur,
          lineTotalEur: it.line_total_eur,
        }));
        const payments = (paymentsByTx.get(t.id) ?? []).map((p) => ({
          paymentMethod: p.payment_method,
          amountEur: p.amount_eur,
        }));
        const s = tseByTx.get(t.id);
        return {
          transactionId: t.id,
          receiptLocator: t.receipt_locator,
          direction: t.direction === 'ANKAUF' ? 'ANKAUF' : 'VERKAUF',
          finalizedAt: new Date(t.finalized_at).toISOString(),
          taxTreatmentCode: t.tax_treatment_code,
          subtotalEur: t.subtotal_eur,
          vatEur: t.vat_eur,
          totalEur: t.total_eur,
          cashierUserId: t.cashier_user_id,
          customerId: t.customer_id,
          isStorno: t.is_storno === true,
          lines,
          payments,
          tse: s
            ? {
                fiskalyTransactionNumber: s.fiskaly_transaction_number,
                signatureCounter: s.signature_counter,
                signatureValue: s.signature_value,
                signatureAlgorithm: s.signature_algorithm,
                fiskalyTssId: s.fiskaly_tss_id,
                processType: s.process_type,
                tseStartTime: s.tse_start_time ? new Date(s.tse_start_time).toISOString() : null,
                tseEndTime: s.tse_end_time ? new Date(s.tse_end_time).toISOString() : null,
              }
            : null,
        };
      });

      const bundleInput: DsfinvkBundleInput = {
        businessDay,
        closing: {
          finalizedAt: closing.finalized_at ? new Date(closing.finalized_at).toISOString() : null,
          grossVerkaufEur: closing.gross_verkauf_eur,
          grossAnkaufEur: closing.gross_ankauf_eur,
          netVerkaufEur: closing.net_verkauf_eur,
          netAnkaufEur: closing.net_ankauf_eur,
          vatByTreatment: (closing.vat_by_treatment ?? {}) as Record<string, string>,
          paymentsByMethod: (closing.payments_by_method ?? {}) as Record<string, string>,
          cashCountedEur: closing.cash_counted_eur,
        },
        cashRegister: {
          id: 'POS-1',
          serialNumber: tssSerial,
          brand: 'Warehouse14',
          model: 'tauri-pos',
        },
        receipts,
      };

      const zip = zipDsfinvkBundle(buildDsfinvkBundle(bundleInput));
      const filename = `DSFinV-K_${businessDay}.zip`;

      if (req.query.encoding === 'base64') {
        // POS api-client path: same bytes, base64 in a text/plain body.
        reply.header('Content-Disposition', `attachment; filename="${filename}.b64"`);
        reply.type('text/plain; charset=utf-8');
        return reply.status(200).send(zip.toString('base64'));
      }

      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.type('application/zip');
      return reply.status(200).send(zip);
    },
  );
};

export default closingExportRoute;
