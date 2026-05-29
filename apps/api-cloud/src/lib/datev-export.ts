/**
 * DATEV CSV export (Epic K — Part 2).
 *
 * Produces a DATEV-"Buchungsstapel" (format 700, category 21) CSV that a tax
 * advisor can import straight into DATEV Rechnungswesen. Two structural rules
 * from the DATEV-Format spec are load-bearing:
 *
 *   1. Line 1 is the fixed EXTF metadata header (`EXTF;700;21;Buchungsstapel;…`).
 *   2. Line 2 is the column header; lines 3+ are the bookings.
 *
 * Semicolon-delimited, fields quote-wrapped, German number format (comma
 * decimal), and Belegdatum in DDMM. The data section is produced with
 * `csv-stringify/sync`; the EXTF header is emitted verbatim so its fixed shape
 * is never reformatted by the CSV quoting rules.
 */

import { stringify } from 'csv-stringify/sync';

/** One accounting booking line, in domain terms (pre-DATEV-formatting). */
export interface DATEVRow {
  /** Gross booking amount, positive, NUMERIC(18,2) string e.g. "123.45". */
  amountEur: string;
  /** Debit/credit indicator — DATEV "Soll/Haben-Kennzeichen". */
  debitCredit: 'S' | 'H';
  /** Posting account (DATEV "Konto"). */
  account: string;
  /** Contra account (DATEV "Gegenkonto (ohne BU-Schlüssel)"). */
  contraAccount: string;
  /** Tax key (DATEV "BU-Schlüssel"). Optional. */
  taxKey?: string;
  /** Document date, ISO `YYYY-MM-DD` — emitted as DATEV DDMM. */
  date: string;
  /** Belegfeld1 — our receipt locator / document number. */
  reference: string;
  /** Free-text Buchungstext (max 60 chars in DATEV; truncated). */
  bookingText: string;
}

/** The 12 DATEV booking columns, in fixed order (line 2 of the file). */
const DATEV_COLUMNS = [
  'Umsatz',
  'Soll/Haben',
  'WKZ',
  'Kurs',
  'Basis-Umsatz',
  'WKZ Basis-Umsatz',
  'Konto',
  'Gegenkonto',
  'BU-Schlüssel',
  'Belegdatum',
  'Belegfeld1',
  'Buchungstext',
] as const;

/**
 * Fixed EXTF header (line 1). 31 semicolon-separated fields per the DATEV
 * "Header für das EXTF-Format" spec, format version 700 / category 21
 * (Buchungsstapel). Fields we don't populate at export time (consultant
 * number, client number, fiscal-year markers, timestamps) are left empty —
 * DATEV fills/validates them on import. The prefix is fixed and MUST NOT
 * deviate: `EXTF;700;21;Buchungsstapel;`.
 */
const DATEV_EXTF_HEADER = 'EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;;;;;;;;;';

/** "123.45" → "123,45"; preserves sign, forces a comma decimal separator. */
function toGermanDecimal(amount: string): string {
  return amount.trim().replace('.', ',');
}

/** ISO `YYYY-MM-DD` → DATEV `DDMM` (4 digits). Empty/invalid → "". */
function toBelegdatum(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!m) return '';
  return `${m[3]}${m[2]}`; // DDMM
}

/** DATEV Buchungstext caps at 60 chars. */
function truncateText(text: string): string {
  return text.length <= 60 ? text : text.slice(0, 60);
}

/**
 * Generate a DATEV-importable CSV string from booking rows. Always begins with
 * the fixed EXTF header line, then the column header, then one line per row.
 */
export async function generateDatevCsv(transactions: DATEVRow[]): Promise<string> {
  const records: string[][] = [
    [...DATEV_COLUMNS],
    ...transactions.map((row) => [
      toGermanDecimal(row.amountEur), // Umsatz
      row.debitCredit, // Soll/Haben
      'EUR', // WKZ
      '', // Kurs
      '', // Basis-Umsatz
      '', // WKZ Basis-Umsatz
      row.account, // Konto
      row.contraAccount, // Gegenkonto
      row.taxKey ?? '', // BU-Schlüssel
      toBelegdatum(row.date), // Belegdatum (DDMM)
      row.reference, // Belegfeld1
      truncateText(row.bookingText), // Buchungstext
    ]),
  ];

  const dataSection = stringify(records, {
    delimiter: ';',
    quoted: true,
    record_delimiter: '\r\n', // DATEV expects CRLF line endings.
  });

  return `${DATEV_EXTF_HEADER}\r\n${dataSection}`;
}
