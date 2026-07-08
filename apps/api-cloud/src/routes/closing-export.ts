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
const KONTO_ERLOESE_19 = '8400'; // Erlöse 19% USt (Automatikkonto) — fallback
const KONTO_WARENEINGANG = '3200'; // Wareneingang

// Per-tax-treatment SKR03 revenue account + DATEV BU-Schlüssel (Buchungsschlüssel),
// confirmed by the Steuerberater (2026). Routing the Gegenkonto BY treatment is
// what ends the "steuerlich blinde" collapse where every sale landed on 8400 and
// got taxed at 19% — wrongly including exempt investment gold (§25c) and the
// margin-taxed used goods (§25a).
//   • STANDARD_19          → 8400 Erlöse 19% USt                       · BU 3 (19%)
//   • REDUCED_7            → 8300 Erlöse 7% USt                        · BU 2 (7%)
//   • MARGIN_25A           → 8200 Erlöse §25a Differenzbesteuerung     · BU leer (Konto trägt die Behandlung)
//   • INVESTMENT_GOLD_25C  → 8150 steuerfreie Erlöse §25c Anlagegold   · BU leer (0% USt)
// §25a note: the Gegenkonto is now correct; §25a taxes only the MARGIN, which the
// 8200 Differenzbesteuerungs-Konto models — the gross sale is posted there by
// design. Unknown codes fall back to 8400 (and the Buchungstext names the code)
// so nothing posts silently into the wrong tax bucket.
const ERLOES_BY_TREATMENT: Record<string, { konto: string; bu: string }> = {
  STANDARD_19: { konto: '8400', bu: '3' },
  REDUCED_7: { konto: '8300', bu: '2' },
  MARGIN_25A: { konto: '8200', bu: '' },
  INVESTMENT_GOLD_25C: { konto: '8150', bu: '' },
};

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

/**
 * The minimal per-line view the DATEV builder needs to split a MIXED receipt:
 * the line's own tax treatment and its gross line total. Reuses the same
 * columns the DSFinV-K path reads from `transaction_items`.
 */
export type DatevItemRow = {
  applied_tax_treatment_code: string;
  line_total_eur: string;
};

// ── Integer-cents math (no float; mirrors transactions-ankauf.ts) ───────────
//    Used only to SUM existing NUMERIC(18,2) line totals per treatment group;
//    every leg is read verbatim from the DB, summed in bigint cents, and the
//    group sum re-expressed as a "123.45" string. No rounding ever occurs.

/** "123.45" → 12345n. Throws on a malformed decimal (defensive; DB-sourced). */
function eurToCents(eur: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(eur.trim())) {
    // DB-sourced NUMERIC(18,2) — a non-decimal here is a server invariant break.
    throw new Error(`closing-export: invalid line total "${eur}"`);
  }
  const v = eur.trim();
  const sign = v.startsWith('-') ? -1n : 1n;
  const abs = v.startsWith('-') ? v.slice(1) : v;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}

/** 12345n → "123.45". */
function centsToEur(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** "-595.00" → "595.00"; "595.00" → "595.00" (drop the sign, keep magnitude). */
function absEur(eur: string): string {
  const t = eur.trim();
  return t.startsWith('-') ? t.slice(1) : t;
}

/**
 * STORNO polarity. A storno is a NEW transaction row with a NEGATIVE total_eur
 * (DB CHECK `transactions_sign_discipline`: total_eur <= 0 on a storno). DATEV's
 * `Umsatz` field must be a POSITIVE magnitude; the direction is carried ENTIRELY
 * by the Soll/Haben (S/H) flag. So a storno REVERSES the original posting: it
 * keeps the same Konto/Gegenkonto/BU but flips S↔H and emits the absolute amount
 * — a clean reversing line a Prüfer accepts. (A negative Umsatz with `S` is non-
 * conforming.) `storno_of_transaction_id` is not on the lean TxRow the exporter
 * reads, so the negative total is the storno signal (set on storno rows only).
 */
function isStornoRow(totalEur: string): boolean {
  return totalEur.trim().startsWith('-');
}

/** The booking-side for an original (S) flipped to (H) on a storno reversal. */
function debitCreditFor(originalSide: 'S' | 'H', storno: boolean): 'S' | 'H' {
  if (!storno) return originalSide;
  return originalSide === 'S' ? 'H' : 'S';
}

/**
 * A tz-aware timestamp → its Europe/Berlin calendar date as `YYYY-MM-DD`.
 * Mirrors the DB `berlin_business_day()` ((ts AT TIME ZONE 'Europe/Berlin')::date,
 * DST-correct) EXACTLY, so the DATEV Belegdatum matches the Berlin business day
 * the export is scoped to (`WHERE berlin_business_day(finalized_at) = business_day`).
 * The UTC date would book a post-midnight-Berlin sale to the previous day.
 */
function berlinDate(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Map one transaction to a DATEV booking line.
 * VERKAUF: Kasse (Soll) an the per-treatment Erlöskonto, with the matching
 * BU-Schlüssel. ANKAUF: Wareneingang an Kasse (no output VAT). A STORNO row
 * (negative total) reverses the original: same accounts/BU, flipped S→H, and a
 * POSITIVE Umsatz. Exported for the fiscal-mapping unit test.
 */
export function toDatevRow(tx: TxRow): DATEVRow {
  const isAnkauf = tx.direction === 'ANKAUF';
  // Sale: Kasse an Erlöse (Konto=Kasse, debit). Purchase: Wareneingang an Kasse.
  const account = isAnkauf ? KONTO_WARENEINGANG : KONTO_KASSE;
  let contraAccount: string;
  let taxKey: string;
  if (isAnkauf) {
    contraAccount = KONTO_KASSE;
    taxKey = ''; // Ankauf from a private seller — no output VAT key.
  } else {
    const m = ERLOES_BY_TREATMENT[tx.tax_treatment_code] ?? {
      konto: KONTO_ERLOESE_19,
      bu: '',
    };
    contraAccount = m.konto;
    taxKey = m.bu;
  }
  const storno = isStornoRow(tx.total_eur);
  return {
    // DATEV Umsatz is always a positive magnitude; the storno's negativity is
    // expressed by the flipped Soll/Haben below, not by a minus sign.
    amountEur: absEur(tx.total_eur),
    // Originals post to the debit (Soll) side of Konto; a storno reverses to H.
    debitCredit: debitCreditFor('S', storno),
    account,
    contraAccount,
    // Omit the optional BU-Schlüssel entirely when empty (exactOptionalPropertyTypes).
    ...(taxKey === '' ? {} : { taxKey }),
    date: berlinDate(tx.finalized_at), // Europe/Berlin business day → DDMM in exporter
    reference: tx.receipt_locator,
    bookingText: `${storno ? 'STORNO ' : ''}${tx.direction} ${tx.receipt_locator} (${tx.tax_treatment_code})`,
  };
}

/**
 * Map one transaction to its DATEV booking line(s).
 *
 * Single-treatment receipts (and every ANKAUF) produce EXACTLY ONE row, byte-
 * identical to `toDatevRow` — so the existing behaviour is unchanged. A MIXED
 * VERKAUF (transaction tax_treatment_code = 'MIXED', or more robustly any sale
 * whose items span >1 applied treatment) is split: the items are grouped by
 * `applied_tax_treatment_code`, each group's `line_total_eur` summed in integer
 * cents, and ONE row emitted per group on that treatment's correct SKR03
 * Gegenkonto + BU-Schlüssel. This ends the wrong collapse where a §25a portion
 * of a mixed receipt got booked to 8400 (19% bucket).
 *
 * The split rows reconcile to the receipt total by construction — they sum the
 * very same `line_total_eur` figures the receipt total is built from. The
 * Buchungstext names the treatment + leg so each portion is identifiable in
 * DATEV (e.g. `VERKAUF RCP-… (MARGIN_25A 1/2)`).
 *
 * Grouping is ORDER-STABLE: groups appear in the order their treatment is first
 * seen across the (display_order-sorted) items, so the export is deterministic.
 */
export function toDatevRows(tx: TxRow, items: DatevItemRow[]): DATEVRow[] {
  // ANKAUF never splits (no output VAT per treatment); fall back to the single
  // transaction-level row regardless of item treatments.
  if (tx.direction === 'ANKAUF') return [toDatevRow(tx)];

  // No item detail → nothing to split on; keep the single transaction-level row.
  if (items.length === 0) return [toDatevRow(tx)];

  // Group by applied treatment, order-stable, summing line totals in cents.
  const order: string[] = [];
  const sumByTreatment = new Map<string, bigint>();
  for (const it of items) {
    const code = it.applied_tax_treatment_code;
    if (!sumByTreatment.has(code)) {
      order.push(code);
      sumByTreatment.set(code, 0n);
    }
    sumByTreatment.set(code, (sumByTreatment.get(code) ?? 0n) + eurToCents(it.line_total_eur));
  }

  // A single distinct treatment → behaviourally identical to today's one row.
  // (Re-express through toDatevRow so it stays byte-for-byte with the non-MIXED
  // path; the transaction-level total already equals the single group sum.)
  if (order.length === 1) return [toDatevRow(tx)];

  // `base` already carries the storno-correct S/H polarity (toDatevRow flips it
  // to H on a negative total). Each split leg must likewise emit a POSITIVE
  // Umsatz magnitude — storno line totals are negative, so take the absolute
  // value of the group sum. The S/H flag carries the reversal direction.
  const base = toDatevRow(tx); // shared date / reference / Konto / debitCredit.
  const storno = isStornoRow(tx.total_eur);
  const groupCount = order.length;
  return order.map((code, idx) => {
    const m = ERLOES_BY_TREATMENT[code] ?? { konto: KONTO_ERLOESE_19, bu: '' };
    const sumCents = sumByTreatment.get(code) ?? 0n;
    const magnitudeCents = sumCents < 0n ? -sumCents : sumCents;
    return {
      amountEur: centsToEur(magnitudeCents),
      debitCredit: base.debitCredit,
      account: base.account,
      contraAccount: m.konto,
      ...(m.bu === '' ? {} : { taxKey: m.bu }),
      date: base.date,
      reference: base.reference,
      bookingText: `${storno ? 'STORNO ' : ''}${tx.direction} ${tx.receipt_locator} (${code} ${idx + 1}/${groupCount})`,
    };
  });
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
      const txRows = await app.db.execute<TxRow & { id: string }>(sql`
        SELECT id::text AS id,
               total_eur, direction::text AS direction, tax_treatment_code,
               receipt_locator, finalized_at
          FROM transactions
         WHERE berlin_business_day(finalized_at) = ${closing.business_day}::date
         ORDER BY finalized_at ASC`);

      // Per-line treatment + total, so a MIXED receipt books per treatment.
      // (Same columns + array-literal binding the DSFinV-K path uses.)
      const txIds = txRows.map((t) => t.id);
      const txIdArray = `{${txIds.join(',')}}`;
      const itemRows =
        txIds.length === 0
          ? []
          : ((await app.db.execute<DatevItemRow & { transaction_id: string }>(sql`
              SELECT transaction_id::text AS transaction_id,
                     applied_tax_treatment_code,
                     line_total_eur::text AS line_total_eur
                FROM transaction_items
               WHERE transaction_id = ANY(${txIdArray}::uuid[])
               ORDER BY transaction_id, display_order ASC`)) as unknown as (DatevItemRow & {
              transaction_id: string;
            })[]);

      const itemsByTx = new Map<string, DatevItemRow[]>();
      for (const it of itemRows) {
        const arr = itemsByTx.get(it.transaction_id) ?? [];
        arr.push({
          applied_tax_treatment_code: it.applied_tax_treatment_code,
          line_total_eur: it.line_total_eur,
        });
        itemsByTx.set(it.transaction_id, arr);
      }

      const datevRows = txRows.flatMap((tx) => toDatevRows(tx, itemsByTx.get(tx.id) ?? []));
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
      // Bind the ids as ONE Postgres array-literal text param ('{uuid,uuid}')
      // cast to uuid[]. Interpolating a JS array into drizzle's `sql` template
      // SPREADS it into comma-separated scalar params, so `ANY(${'${txIds}'}::uuid[])`
      // casts a row/record → uuid[] and throws 42846 on any non-empty day. The
      // ids are DB-sourced UUIDs, so the literal stays one safe bound param.
      // (Same fix already applied to transactions-finalize.ts.)
      const txIdArray = `{${txIds.join(',')}}`;

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
               WHERE ti.transaction_id = ANY(${txIdArray}::uuid[])
               ORDER BY ti.transaction_id, ti.display_order ASC`);

      const paymentRows =
        txIds.length === 0
          ? []
          : await app.db.execute<DsfinvkPaymentRow>(sql`
              SELECT transaction_id::text AS transaction_id,
                     payment_method::text AS payment_method,
                     amount_eur::text     AS amount_eur
                FROM transaction_payments
               WHERE transaction_id = ANY(${txIdArray}::uuid[])
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
               WHERE transaction_id = ANY(${txIdArray}::uuid[])`);

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
          // MENGE/ANZAHL is ALWAYS 1.000 by the data model — not a placeholder.
          // Each transaction_items row references ONE unique inventory product_id
          // (gold/coins/antiques: 4-state DRAFT→AVAILABLE→RESERVED→SOLD machine,
          // atomic single-item reservation; a product can be sold exactly once).
          // There is no stock-count column anywhere and no code path multiplies a
          // quantity into a line total (the storefront cart's `quantity` field is
          // never folded into line_total_eur and a unique item cannot be reserved
          // twice). So qty>1 per line is unreachable → '1.000' is the correct,
          // truthful value, NOT a deferred default. (No quantity column added.)
          quantity: '1.000',
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
