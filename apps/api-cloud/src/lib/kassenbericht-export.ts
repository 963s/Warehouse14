/**
 * Kassenbericht CSV export — the daily cash report (KassenSichV) the owner /
 * Steuerberater / Finanzamt can download per closing.
 *
 * PURE + NO FACADE: this only RE-EXPRESSES a real `daily_closings` row as a
 * labelled, semicolon-delimited German CSV. It never recomputes a fiscal figure
 * and never invents one — a missing cash count says so in words, it does not
 * render as "0,00". Money stays a NUMERIC(18,2) string from the DB; we only
 * swap the decimal point for a German comma. CRLF line endings, like the DATEV
 * export.
 *
 * WHO READS THIS. A Betriebsprüfer, in German, on paper. That is why the tax
 * treatments and payment methods are spelled out here rather than shipped as
 * the raw enum: a report that says `MARGIN_25A` and `ZVT_CARD` is a machine
 * dump, and the reader has to be told what it means. It said exactly that
 * until 2026-07-22.
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

/**
 * German names for the tax treatments.
 *
 * DELIBERATELY PINNED HERE, not imported from the app's UI vocabulary. This is
 * a fiscal document: if somebody rewords a label in the cashier interface for
 * readability, the wording on a tax report must not silently move with it. The
 * strings match `TAX_TREATMENT_LABEL` in `@warehouse14/i18n-de` today; that is
 * a deliberate copy of about a dozen frozen legal terms, not an oversight.
 */
const TREATMENT_LABEL: Record<string, string> = {
  STANDARD_19: 'Regelsteuersatz 19 %',
  REDUCED_7: 'Ermäßigter Steuersatz 7 %',
  MARGIN_25A: 'Differenzbesteuerung § 25a UStG',
  INVESTMENT_GOLD_25C: 'Anlagegold, steuerfrei § 25c UStG',
  EXEMPT: 'Steuerfrei',
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Bar',
  ZVT_CARD: 'Kartenzahlung Terminal',
  SUMUP: 'SumUp',
  MOLLIE: 'Mollie',
  STRIPE: 'Stripe',
  EBAY: 'eBay',
  BANK_TRANSFER: 'Überweisung',
  VOUCHER: 'Gutschein',
};

/**
 * Name an enum for a human, and NEVER hide one we do not know: an unmapped code
 * is printed as-is with a marker, because a silently dropped or prettified tax
 * bucket is how a report starts lying.
 */
function label(map: Record<string, string>, code: string): string {
  return map[code] ?? `${code} (unbekannter Schlüssel)`;
}

/** "1234.50" → "1234,50 EUR"; null/empty → a word, never a fabricated 0. */
function eur(amount: string | null | undefined): string {
  if (amount == null || amount.trim().length === 0) return 'nicht gezählt';
  return `${amount.trim().replace('.', ',')} EUR`;
}

/** Sum a NUMERIC(18,2) map in integer cents, so the reader can check the total. */
function sumEur(m: Record<string, string>): string {
  let cents = 0n;
  for (const raw of Object.values(m)) {
    const t = raw.trim();
    if (t.length === 0) continue;
    const neg = t.startsWith('-');
    const [w, f = ''] = (neg ? t.slice(1) : t).split('.');
    const v = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
    cents += neg ? -v : v;
  }
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * An ISO instant → German date and time in Europe/Berlin.
 *
 * The raw ISO string carried a `Z`, so a report finalised at 22:14 Berlin time
 * printed `20:14` UTC and looked like it belonged to the wrong day. A fiscal
 * document states local time.
 */
function berlinStamp(iso: string | null): string {
  if (iso == null || iso.trim().length === 0) return 'nicht abgeschlossen';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'nicht abgeschlossen';
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${f} Uhr (Ortszeit Berlin)`;
}

/** YYYY-MM-DD → DD.MM.YYYY, the way a German report writes a date. */
function germanDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
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
    ['Kassenbericht', germanDay(c.businessDay)],
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
    ...Object.entries(c.vatByTreatment).map(([code, amt]) => [
      'Umsatzsteuer',
      label(TREATMENT_LABEL, code),
      eur(amt),
    ]),
    // The check total: a reader adds the rows above and must land here.
    ['Umsatzsteuer', 'Summe', eur(sumEur(c.vatByTreatment))],
    [],
    ...Object.entries(c.paymentsByMethod).map(([method, amt]) => [
      'Zahlungsart',
      label(PAYMENT_LABEL, method),
      eur(amt),
    ]),
    ['Zahlungsart', 'Summe', eur(sumEur(c.paymentsByMethod))],
    [],
    ['Kasse', 'Erwartet bar', eur(c.cashExpectedEur)],
    ['Kasse', 'Gezählt bar', eur(c.cashCountedEur)],
    ['Kasse', 'Differenz', eur(c.cashVarianceEur)],
    [],
    ['TSE', 'Signiert', String(c.tseFinishedCount)],
    ['TSE', 'Ausstehend', String(c.tsePendingCount)],
    ['TSE', 'Fehlgeschlagen', String(c.tseFailedCount)],
    [],
    ['Abschluss', 'Finalisiert am', berlinStamp(c.finalizedAt)],
  ];

  return stringify(rows, { delimiter: ';', record_delimiter: '\r\n' });
}
