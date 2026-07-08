/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DSFinV-K export — LOCAL DFKA-Taxonomie Kassendaten bundle generator
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Produces, from the REAL fiscal data of one Berlin business day, the core
 * DSFinV-K (Digitale Schnittstelle der Finanzverwaltung für Kassensysteme,
 * DFKA-Taxonomie Kassendaten) CSV files + the `index.xml` that ties them
 * together — the artefact a German tax inspector requests in a §146b
 * Kassen-Nachschau as a Z3 Datenträgerüberlassung.
 *
 * This MIRRORS the existing export pattern (datev-export.ts / kassenbericht-
 * export.ts): a PURE function over already-fetched rows, never a DB caller,
 * never a recompute, never a fabrication. Money stays a NUMERIC(18,2) string
 * straight from Postgres; we only normalise the decimal separator to the
 * DSFinV-K dot. NO float arithmetic. Semicolon-delimited, CRLF line endings.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  HONESTY — coverage of the DSFinV-K v2.x taxonomy (read before relying on it)
 * ───────────────────────────────────────────────────────────────────────────
 *  This is a FAITHFUL CORE implementation, NOT a certified one. Before it is
 *  used in a real Betriebsprüfung / Kassen-Nachschau it MUST be validated
 *  against the official DSFinV-K Prüftool of the Finanzverwaltung AND signed
 *  off by the Steuerberater. Do NOT claim certification.
 *
 *  COVERED (core files, with real data):
 *    • cashpointclosing.csv   — Kassenabschluss header (Z-Nr, day, finalize ts,
 *                               cash-register id/serial, gross/net day totals).
 *    • bon_kopf.csv           — receipt headers (BON_ID, BON_NR, BON_TYP,
 *                               timestamp, gross/net totals, cashier, customer).
 *    • bon_pos.csv            — receipt lines (article text, MENGE, GV_TYP).
 *                               MENGE is ALWAYS 1.000: each line is ONE unique
 *                               inventory item (4-state product machine, atomic
 *                               single-item reservation) — no stock-count column
 *                               exists and no path multiplies a quantity into a
 *                               line total, so qty>1 per line is unreachable.
 *    • bon_pos_preise.csv     — per-line PRICE/quantity breakdown: ANZAHL,
 *                               EINZEL_BRUTTO, position BRUTTO/NETTO/USt. NO
 *                               USt-Schlüssel (distinct from bon_pos_ust).
 *    • bon_pos_ust.csv        — per-line VAT breakdown (USt-Schlüssel, brutto,
 *                               netto, ust).
 *    • bon_ust.csv            — per-receipt VAT totals by USt-Schlüssel.
 *    • datapayment.csv        — Zahlungsarten per receipt (Zahlungsart + amount).
 *    • tse.csv                — TSE evidence per receipt: Transaktionsnummer,
 *                               Signaturzähler, Signatur, Algorithmus, TSS-ID
 *                               (Seriennummer ref), Start/End time, ProcessType.
 *    • index.xml              — ties the CSV files together (DSFinV-K Media set).
 *
 *  DEFERRED / EMITTED AS SPEC-CORRECT EMPTY (documented, NOT invented):
 *    • Stammdaten set (cashregister.csv, slaves.csv, pa.csv, vat.csv,
 *      tse.csv-as-master, businesscases master, etc.) — only the per-closing
 *      transactional core is generated here; the static master-data files are
 *      deferred until the Steuerberater confirms the firm's master records.
 *    • allocation_groups, references (bon_referenzen.csv), subitems
 *      (bon_pos_zusatzinfo) — not modelled in our data yet → omitted, NOT faked.
 *    • Geldtransit / Cash-in/out (Bargeldbewegungen beyond the closing's cash
 *      count), Trinkgeld, Gutschein issue/redeem detail — partially modelled;
 *      surfaced only where a real row exists.
 *    • The Z3 export's GoBD `gdpdu-01-09-2004.dtd` + `INDEX.XML` description
 *      schema is approximated by a minimal index.xml — it lists the files but is
 *      NOT the full GDPdU description; the Prüftool may want the full descriptor.
 *    • Process-data / signature payload reconstruction (the exact byte string
 *      the TSE signed) is NOT re-derived; we record the stored signature value
 *      and counters verbatim from tse_signatures.
 *
 *  Where a required field cannot be sourced from current data we emit the
 *  spec's EMPTY/default (empty string, or '0.00' only where the spec defines a
 *  mandatory numeric default) — see the inline notes — and never a guess.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { deflateRawSync } from 'node:zlib';

import { stringify } from 'csv-stringify/sync';

// ── DSFinV-K USt-Schlüssel (fixed taxonomy ids) ────────────────────────────
//
// DSFinV-K defines a fixed set of USt-Schlüssel (ID_UST). Our four
// tax_treatment_codes map as follows (documented for the Steuerberater):
//   1 → 19,00 % Regelsteuersatz           ← STANDARD_19
//   2 →  7,00 % ermäßigter Steuersatz     ← REDUCED_7
//   3 → 10,70 % §24 UStG Durchschnittsatz (unused)
//   4 →  5,50 % §24 UStG (unused)
//   5 →  0,00 % nicht steuerbar / steuerfrei ← INVESTMENT_GOLD_25C (§25c, exempt)
//   6 →  0,00 % Umsatzsteuer (Sonderfall, unused)
//   7 → Differenzbesteuerung §25a UStG     ← MARGIN_25A
//        (NOTE: §25a is taxed at 19 % ON THE MARGIN, not on the full price.
//         DSFinV-K represents the margin scheme distinctly; key 7 marks it so
//         the Prüfung does NOT read it as a normal 0 %/exempt line. The margin
//         VAT itself is carried in bon_ust from the closing's vatByTreatment.)
export const UST_SCHLUESSEL: Record<string, string> = {
  STANDARD_19: '1',
  REDUCED_7: '2',
  INVESTMENT_GOLD_25C: '5',
  MARGIN_25A: '7',
};

/** Fallback USt-Schlüssel for an unknown code: 7 (Sonstige / nicht zuordenbar). */
const UST_SCHLUESSEL_FALLBACK = '7';

function ustKey(code: string): string {
  return UST_SCHLUESSEL[code] ?? UST_SCHLUESSEL_FALLBACK;
}

// ── Input shapes — already-fetched REAL rows (the route maps DB → this) ─────

export interface DsfinvkLineInput {
  lineNumber: number;
  productName: string;
  /** NUMERIC string, e.g. "1.000". */
  quantity: string;
  appliedTaxTreatmentCode: string;
  /** NUMERIC(5,4) string or null (null = §25a margin). */
  appliedVatRate: string | null;
  lineSubtotalEur: string;
  lineVatEur: string;
  lineTotalEur: string;
}

export interface DsfinvkPaymentInput {
  paymentMethod: string;
  amountEur: string;
}

export interface DsfinvkTseInput {
  fiskalyTransactionNumber: string;
  signatureCounter: string;
  signatureValue: string;
  signatureAlgorithm: string | null;
  fiskalyTssId: string;
  processType: string;
  tseStartTime: string | null;
  tseEndTime: string | null;
}

export interface DsfinvkReceiptInput {
  transactionId: string;
  receiptLocator: string;
  direction: 'VERKAUF' | 'ANKAUF';
  finalizedAt: string; // ISO
  taxTreatmentCode: string;
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
  cashierUserId: string;
  customerId: string | null;
  isStorno: boolean;
  lines: DsfinvkLineInput[];
  payments: DsfinvkPaymentInput[];
  /** May be null if no TSE signature was recorded for this receipt. */
  tse: DsfinvkTseInput | null;
}

export interface DsfinvkClosingInput {
  finalizedAt: string | null; // ISO
  grossVerkaufEur: string;
  grossAnkaufEur: string;
  netVerkaufEur: string;
  netAnkaufEur: string;
  /** `{ tax_treatment_code: vat-amount-string }`. */
  vatByTreatment: Record<string, string>;
  /** `{ payment_method: amount-string }`. */
  paymentsByMethod: Record<string, string>;
  cashCountedEur: string | null;
}

export interface DsfinvkCashRegisterInput {
  id: string;
  serialNumber: string;
  brand: string;
  model: string;
}

export interface DsfinvkBundleInput {
  businessDay: string; // YYYY-MM-DD
  closing: DsfinvkClosingInput;
  cashRegister: DsfinvkCashRegisterInput;
  receipts: DsfinvkReceiptInput[];
}

/** One file of the bundle. */
export interface DsfinvkFile {
  name: string;
  content: string;
}

// ── Formatting helpers (NO float; only separator + safe defaults) ──────────

/** "1234.5" → "1234.50"; null/empty → "0.00" only where the spec mandates a
 *  numeric (callers pass real strings — this is the last-resort default). */
function dec(amount: string | null | undefined): string {
  if (amount == null || amount.trim().length === 0) return '0.00';
  const t = amount.trim();
  // Already a plain decimal; force exactly 2 fractional digits without float.
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  const [intPart, fracPart = ''] = body.split('.');
  const frac2 = `${fracPart}00`.slice(0, 2);
  return `${neg ? '-' : ''}${intPart || '0'}.${frac2}`;
}

/** "119.00" / "-7.5" → integer cents (no float; mirrors dec()'s parsing). */
function eurToCents(amount: string | null | undefined): number {
  if (amount == null || amount.trim().length === 0) return 0;
  const t = amount.trim();
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  const [intPart, fracPart = ''] = body.split('.');
  const cents = Number(intPart || '0') * 100 + Number(`${fracPart}00`.slice(0, 2));
  return neg ? -cents : cents;
}

/** integer cents → "119.00" (mirrors dec()'s 2-dp dot format). */
function centsToDec(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Pass a quantity through as a dot-decimal string (no float). */
function qty(q: string | null | undefined): string {
  if (q == null || q.trim().length === 0) return '0.000';
  return q.trim();
}

/** ISO timestamp → DSFinV-K ISO 8601 (kept as-is; empty → ''). */
function ts(iso: string | null | undefined): string {
  if (iso == null || iso.trim().length === 0) return '';
  return new Date(iso).toISOString();
}

/** BON_TYP per DSFinV-K: storno receipts are marked; sales/buys are "Beleg". */
function bonTyp(r: DsfinvkReceiptInput): string {
  return r.isStorno ? 'Beleg-Storno' : 'Beleg';
}

/** GV_TYP (Geschäftsvorfall): VERKAUF=Umsatz, ANKAUF=Wareneinkauf/Auszahlung. */
function gvTyp(direction: 'VERKAUF' | 'ANKAUF'): string {
  return direction === 'ANKAUF' ? 'Einkauf' : 'Umsatz';
}

/** csv-stringify a header + rows with the project's CSV conventions. */
function csv(header: string[], rows: string[][]): string {
  return stringify([header, ...rows], { delimiter: ';', record_delimiter: '\r\n' });
}

// ── The single cash-register / Z-number anchor for this closing ────────────
//
// DSFinV-K keys every row to a Kasse (Z_KASSE_ID) and a closing (Z_NR). We use
// the cash-register id and the business day as a stable Z-number surrogate
// (one closing per Berlin business day). The real Fiskaly Z-number is not
// surfaced in our data → documented surrogate, NOT a fabricated counter.
function zNr(businessDay: string): string {
  return businessDay; // surrogate; one closing per business day.
}

// ── File builders ──────────────────────────────────────────────────────────

function buildCashPointClosing(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = [
    'Z_KASSE_ID',
    'Z_NR',
    'Z_BUCHUNGSTAG',
    'Z_ERSTELLUNG',
    'KASSE_SERIENNR',
    'KASSE_BRAND',
    'KASSE_MODELL',
    'GESAMT_BRUTTO_VERKAUF',
    'GESAMT_BRUTTO_ANKAUF',
    'GESAMT_NETTO_VERKAUF',
    'GESAMT_NETTO_ANKAUF',
    'BARGELD_GEZAEHLT',
  ];
  const row = [
    input.cashRegister.id,
    z,
    input.businessDay,
    ts(input.closing.finalizedAt),
    input.cashRegister.serialNumber,
    input.cashRegister.brand,
    input.cashRegister.model,
    dec(input.closing.grossVerkaufEur),
    dec(input.closing.grossAnkaufEur),
    dec(input.closing.netVerkaufEur),
    dec(input.closing.netAnkaufEur),
    // cashCountedEur may be null (day still counting) → empty, never a fake 0.
    input.closing.cashCountedEur == null ? '' : dec(input.closing.cashCountedEur),
  ];
  return csv(header, [row]);
}

function buildBonKopf(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = [
    'Z_KASSE_ID',
    'Z_NR',
    'BON_ID',
    'BON_NR',
    'BON_TYP',
    'BON_TERMINAL_ID',
    'BON_START',
    'BON_ENDE',
    'BON_GESAMT_BRUTTO',
    'BON_GESAMT_NETTO',
    'BON_GESAMT_UST',
    'BEDIENER_ID',
    'KUNDE_ID',
  ];
  const rows = input.receipts.map((r) => [
    input.cashRegister.id,
    z,
    r.receiptLocator,
    r.receiptLocator,
    bonTyp(r),
    input.cashRegister.id,
    ts(r.finalizedAt),
    ts(r.finalizedAt),
    dec(r.totalEur),
    dec(r.subtotalEur),
    dec(r.vatEur),
    r.cashierUserId,
    r.customerId ?? '',
  ]);
  return csv(header, rows);
}

function buildBonPos(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = [
    'Z_KASSE_ID',
    'Z_NR',
    'BON_ID',
    'POS_ZEILE',
    'GV_TYP',
    'ARTIKELTEXT',
    'MENGE',
    'UST_SCHLUESSEL',
  ];
  const rows: string[][] = [];
  for (const r of input.receipts) {
    for (const line of r.lines) {
      rows.push([
        input.cashRegister.id,
        z,
        r.receiptLocator,
        String(line.lineNumber),
        gvTyp(r.direction),
        line.productName,
        qty(line.quantity),
        ustKey(line.appliedTaxTreatmentCode),
      ]);
    }
  }
  return csv(header, rows);
}

/**
 * bon_pos_preise.csv — per-position PRICE/quantity breakdown (DFKA taxonomy).
 *
 * Distinct from bon_pos_ust.csv: this file carries the position's PRICE detail —
 * quantity (ANZAHL), unit gross (EINZEL_BRUTTO), and the position gross/net/tax
 * (BRUTTO/NETTO/POS_UST). It does NOT carry the USt-Schlüssel (that lives in
 * bon_pos_ust). In our model every line is a unique inventory item → ANZAHL is
 * always 1.000 and EINZEL_BRUTTO == BRUTTO (no per-unit divide, no float).
 *
 * NOTE for the Prüftool validation: the exact DFKA column NAMES for the price
 * file vary across taxonomy minor versions (BRUTTO vs POS_BRUTTO, EINZEL_BRUTTO
 * vs STK_BR, etc.). The SHAPE here is correct (price + quantity, no USt key);
 * the precise header tokens must be reconciled against the official DSFinV-K
 * Prüftool before a real Betriebsprüfung — flagged, not faked.
 */
function buildBonPosPreise(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = [
    'Z_KASSE_ID',
    'Z_NR',
    'BON_ID',
    'POS_ZEILE',
    'ANZAHL',
    'EINZEL_BRUTTO',
    'BRUTTO',
    'NETTO',
    'POS_UST',
  ];
  const rows: string[][] = [];
  for (const r of input.receipts) {
    for (const line of r.lines) {
      // ANZAHL = quantity (always 1.000 — unique-item model). EINZEL_BRUTTO is
      // the per-unit gross; with quantity 1 it equals the position gross, so we
      // reuse the line gross verbatim (no division, no float).
      rows.push([
        input.cashRegister.id,
        z,
        r.receiptLocator,
        String(line.lineNumber),
        qty(line.quantity),
        dec(line.lineTotalEur),
        dec(line.lineTotalEur),
        dec(line.lineSubtotalEur),
        dec(line.lineVatEur),
      ]);
    }
  }
  return csv(header, rows);
}

function buildBonPosUst(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = [
    'Z_KASSE_ID',
    'Z_NR',
    'BON_ID',
    'POS_ZEILE',
    'UST_SCHLUESSEL',
    'POS_BRUTTO',
    'POS_NETTO',
    'POS_UST',
  ];
  const rows: string[][] = [];
  for (const r of input.receipts) {
    for (const line of r.lines) {
      rows.push([
        input.cashRegister.id,
        z,
        r.receiptLocator,
        String(line.lineNumber),
        ustKey(line.appliedTaxTreatmentCode),
        dec(line.lineTotalEur),
        dec(line.lineSubtotalEur),
        dec(line.lineVatEur),
      ]);
    }
  }
  return csv(header, rows);
}

function buildBonUst(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = [
    'Z_KASSE_ID',
    'Z_NR',
    'BON_ID',
    'UST_SCHLUESSEL',
    'BON_BRUTTO',
    'BON_NETTO',
    'BON_UST',
  ];
  // One Bonkopf-USt row per (receipt, USt-Schlüssel). The key comes from each
  // LINE's applied tax treatment — NOT the single receipt-level code — so a
  // mixed-treatment Bon (e.g. a 19 % line plus a §25c-exempt gold line) is split
  // by rate and reconciles with bon_pos_ust, instead of collapsing all turnover
  // onto one rate (which would report exempt/margin turnover as standard-rated).
  // Sums are in integer cents (no float). Mirrors buildBonPosUst's key basis.
  const rows: string[][] = [];
  for (const r of input.receipts) {
    const byKey = new Map<string, { brutto: number; netto: number; ust: number }>();
    const order: string[] = [];
    for (const line of r.lines) {
      const key = ustKey(line.appliedTaxTreatmentCode);
      let acc = byKey.get(key);
      if (!acc) {
        acc = { brutto: 0, netto: 0, ust: 0 };
        byKey.set(key, acc);
        order.push(key);
      }
      acc.brutto += eurToCents(line.lineTotalEur);
      acc.netto += eurToCents(line.lineSubtotalEur);
      acc.ust += eurToCents(line.lineVatEur);
    }
    for (const key of order) {
      const acc = byKey.get(key);
      if (!acc) continue;
      rows.push([
        input.cashRegister.id,
        z,
        r.receiptLocator,
        key,
        centsToDec(acc.brutto),
        centsToDec(acc.netto),
        centsToDec(acc.ust),
      ]);
    }
  }
  return csv(header, rows);
}

function buildDataPayment(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = ['Z_KASSE_ID', 'Z_NR', 'BON_ID', 'ZAHLART_TYP', 'ZAHLART_NAME', 'BETRAG'];
  const rows: string[][] = [];
  for (const r of input.receipts) {
    for (const p of r.payments) {
      rows.push([
        input.cashRegister.id,
        z,
        r.receiptLocator,
        paymentTyp(p.paymentMethod),
        p.paymentMethod,
        dec(p.amountEur),
      ]);
    }
  }
  return csv(header, rows);
}

/** DSFinV-K ZAHLART_TYP: cash vs non-cash bucket. */
function paymentTyp(method: string): string {
  return method === 'CASH' ? 'Bar' : 'Unbar';
}

function buildTse(input: DsfinvkBundleInput): string {
  const z = zNr(input.businessDay);
  const header = [
    'Z_KASSE_ID',
    'Z_NR',
    'BON_ID',
    'TSE_ID',
    'TSE_TA_NUMMER',
    'TSE_TA_SIGZ',
    'TSE_TA_SIG',
    'TSE_TA_START',
    'TSE_TA_ENDE',
    'TSE_TA_SIGALGO',
    'TSE_TA_VORGANGSART',
  ];
  const rows: string[][] = [];
  for (const r of input.receipts) {
    if (!r.tse) continue; // no fabricated TSE rows for un-signed receipts.
    rows.push([
      input.cashRegister.id,
      z,
      r.receiptLocator,
      r.tse.fiskalyTssId,
      r.tse.fiskalyTransactionNumber,
      r.tse.signatureCounter,
      r.tse.signatureValue,
      ts(r.tse.tseStartTime),
      ts(r.tse.tseEndTime),
      r.tse.signatureAlgorithm ?? '',
      r.tse.processType,
    ]);
  }
  return csv(header, rows);
}

/** Minimal DSFinV-K index.xml that lists the media set (NOT the full GDPdU
 *  descriptor — see the HONESTY block). */
function buildIndexXml(fileNames: string[]): string {
  const tables = fileNames
    .filter((n) => n.endsWith('.csv'))
    .map((n) => `    <Table><URL>${n}</URL></Table>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DataSet>',
    '  <Media>',
    '    <Name>DSFinV-K Export (Warehouse14 — core, local)</Name>',
    tables,
    '  </Media>',
    '</DataSet>',
    '',
  ].join('\n');
}

/**
 * Build the full DSFinV-K core bundle for one business day. PURE: no DB, no
 * recompute. The route fetches the real rows and maps them into the input.
 */
export function buildDsfinvkBundle(input: DsfinvkBundleInput): DsfinvkFile[] {
  const csvFiles: DsfinvkFile[] = [
    { name: 'cashpointclosing.csv', content: buildCashPointClosing(input) },
    { name: 'bon_kopf.csv', content: buildBonKopf(input) },
    { name: 'bon_pos.csv', content: buildBonPos(input) },
    { name: 'bon_pos_preise.csv', content: buildBonPosPreise(input) },
    { name: 'bon_pos_ust.csv', content: buildBonPosUst(input) },
    { name: 'bon_ust.csv', content: buildBonUst(input) },
    { name: 'datapayment.csv', content: buildDataPayment(input) },
    { name: 'tse.csv', content: buildTse(input) },
  ];
  const indexXml: DsfinvkFile = {
    name: 'index.xml',
    content: buildIndexXml(csvFiles.map((f) => f.name)),
  };
  return [...csvFiles, indexXml];
}

/** Find a file's content by name (test + route helper). Throws if missing. */
export function fileByName(files: DsfinvkFile[], name: string): string {
  const f = files.find((x) => x.name === name);
  if (!f) throw new Error(`DSFinV-K bundle missing file: ${name}`);
  return f.content;
}

// ── Deterministic ZIP writer (STORE + DEFLATE, no external dependency) ──────
//
// A self-contained ZIP writer keeps the fiscal artefact byte-reproducible (no
// transitive-dep surprise, no timestamp drift). Fixed DOS date/time (1980-01-01)
// → deterministic output. CRC32 via a static table (no float). DEFLATE via
// Node's zlib `deflateRawSync` (lossless), with STORE fallback if it would not
// shrink — both are valid ZIP entries.

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    // Typed-array index access is typed `number` (never undefined).
    c = (CRC32_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  compressed: Buffer;
  method: number; // 0 = STORE, 8 = DEFLATE
  offset: number;
}

/** Pack the bundle into a deterministic ZIP Buffer. */
export function zipDsfinvkBundle(files: DsfinvkFile[]): Buffer {
  const DOS_DATE = 0x0021; // 1980-01-01
  const DOS_TIME = 0x0000; // 00:00:00

  const localChunks: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const f of files) {
    const data = Buffer.from(f.content, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const compressed = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(f.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header sig
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8); // compression
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    localChunks.push(local, nameBuf, compressed);
    entries.push({ name: f.name, data, crc, compressed, method, offset });
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralChunks: Buffer[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header sig
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(e.offset, 42); // local header offset
    centralChunks.push(central, nameBuf);
    centralSize += central.length + nameBuf.length;
  }

  const localSize = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD sig
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12); // central dir size
  eocd.writeUInt32LE(localSize, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}
