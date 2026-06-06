/**
 * Kassenbericht CSV export — the daily cash report (KassenSichV) the owner /
 * Steuerberater / Finanzamt can download per closing.
 *
 * PURE + NO FACADE: this only RE-EXPRESSES a real `daily_closings` row as a
 * labelled, semicolon-delimited German CSV. It never recomputes a fiscal figure
 * and never invents one — a missing cash count renders as "—", not "0,00".
 * Money stays a NUMERIC(18,2) string from the DB; we only swap the decimal
 * point for a German comma. CRLF line endings, like the DATEV export.
 */

import { stringify } from 'csv-stringify/sync';

/** The real closing figures, straight from the `daily_closings` row. */
export interface KassenberichtInput {
  businessDay: string; // YYYY-MM-DD
  state: 'COUNTING' | 'FINALIZED';
  verkaufCount: number;
  ankaufCount: number;
  stornoCount: number;
  grossVerkaufEur: string;
  grossAnkaufEur: string;
  netVerkaufEur: string;
  netAnkaufEur: string;
  /** `{ tax_treatment_code: amount-string }`. */
  vatByTreatment: Record<string, string>;
  /** `{ payment_method: amount-string }`. */
  paymentsByMethod: Record<string, string>;
  cashExpectedEur: string | null;
  cashCountedEur: string | null;
  cashVarianceEur: string | null;
  tseFinishedCount: number;
  tsePendingCount: number;
  tseFailedCount: number;
  finalizedAt: string | null; // ISO
}

/** "1234.50" → "1234,50 EUR"; null/empty → "—" (never a fabricated 0). */
function eur(amount: string | null | undefined): string {
  if (amount == null || amount.trim().length === 0) return '—';
  return `${amount.trim().replace('.', ',')} EUR`;
}

const STATE_LABEL: Record<KassenberichtInput['state'], string> = {
  FINALIZED: 'abgeschlossen',
  COUNTING: 'in Zählung',
};

/**
 * Build the Kassenbericht CSV. Line 1 is the title + business day; the rest are
 * `Abschnitt;Feld;Wert` rows. Unquoted unless a value needs it (csv-stringify
 * quotes-as-needed), so the output stays human-readable.
 */
export function buildKassenberichtCsv(c: KassenberichtInput): string {
  const rows: string[][] = [
    ['Kassenbericht', c.businessDay],
    ['Status', STATE_LABEL[c.state]],
    [],
    ['Belege', 'Verkäufe', String(c.verkaufCount)],
    ['Belege', 'Ankäufe', String(c.ankaufCount)],
    ['Belege', 'Stornos', String(c.stornoCount)],
    [],
    ['Umsatz', 'Verkauf brutto', eur(c.grossVerkaufEur)],
    ['Umsatz', 'Verkauf netto', eur(c.netVerkaufEur)],
    ['Umsatz', 'Ankauf brutto', eur(c.grossAnkaufEur)],
    ['Umsatz', 'Ankauf netto', eur(c.netAnkaufEur)],
    [],
    ...Object.entries(c.vatByTreatment).map(([code, amt]) => ['USt', code, eur(amt)]),
    [],
    ...Object.entries(c.paymentsByMethod).map(([method, amt]) => ['Zahlung', method, eur(amt)]),
    [],
    ['Kasse', 'Erwartet (bar)', eur(c.cashExpectedEur)],
    ['Kasse', 'Gezählt (bar)', eur(c.cashCountedEur)],
    ['Kasse', 'Differenz', eur(c.cashVarianceEur)],
    [],
    ['TSE', 'Signiert', String(c.tseFinishedCount)],
    ['TSE', 'Ausstehend', String(c.tsePendingCount)],
    ['TSE', 'Fehlgeschlagen', String(c.tseFailedCount)],
    [],
    ['Abschluss', 'Finalisiert am', c.finalizedAt ?? '—'],
  ];

  return stringify(rows, { delimiter: ';', record_delimiter: '\r\n' });
}
