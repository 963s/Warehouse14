/**
 * Kassenbericht CSV builder — the daily cash report (KassenSichV) downloadable
 * for the Finanzamt / Steuerberater. Pure: it only RE-EXPRESSES the real
 * `daily_closings` row as a labelled German CSV; it never recomputes or
 * fabricates a figure. (No facade: every number here came from the closing.)
 */
import { describe, expect, it } from 'vitest';

import {
  type KassenberichtInput,
  buildKassenberichtCsv,
} from '../../src/lib/kassenbericht-export.js';

function sample(overrides: Partial<KassenberichtInput> = {}): KassenberichtInput {
  return {
    businessDay: '2026-06-06',
    state: 'FINALIZED',
    verkaufCount: 7,
    ankaufCount: 2,
    stornoCount: 1,
    grossVerkaufEur: '1500.00',
    grossAnkaufEur: '300.00',
    netVerkaufEur: '1234.50',
    netAnkaufEur: '280.00',
    vatByTreatment: { STANDARD_19: '190.00', MARGIN_25A: '12.34' },
    paymentsByMethod: { CASH: '500.00', CARD: '734.50' },
    cashExpectedEur: '700.00',
    cashCountedEur: '698.00',
    cashVarianceEur: '-2.00',
    tseFinishedCount: 7,
    tsePendingCount: 0,
    tseFailedCount: 0,
    finalizedAt: '2026-06-06T20:05:00.000Z',
    ...overrides,
  };
}

describe('buildKassenberichtCsv', () => {
  it('starts with a titled header line carrying the business day', () => {
    const csv = buildKassenberichtCsv(sample());
    expect(csv.split('\r\n')[0]).toBe('Kassenbericht;2026-06-06');
  });

  it('labels the state in plain German', () => {
    expect(buildKassenberichtCsv(sample({ state: 'FINALIZED' }))).toContain('Status;abgeschlossen');
    expect(buildKassenberichtCsv(sample({ state: 'COUNTING' }))).toContain('Status;in Zählung');
  });

  it('emits the real net figures with German comma decimals', () => {
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('Umsatz;Verkauf netto;1234,50 EUR');
    expect(csv).toContain('Umsatz;Ankauf netto;280,00 EUR');
  });

  it('emits one row per VAT treatment and per payment method', () => {
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('USt;STANDARD_19;190,00 EUR');
    expect(csv).toContain('USt;MARGIN_25A;12,34 EUR');
    expect(csv).toContain('Zahlung;CASH;500,00 EUR');
    expect(csv).toContain('Zahlung;CARD;734,50 EUR');
  });

  it('reports the cash count + variance', () => {
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('Kasse;Erwartet (bar);700,00 EUR');
    expect(csv).toContain('Kasse;Gezählt (bar);698,00 EUR');
    expect(csv).toContain('Kasse;Differenz;-2,00 EUR');
  });

  it('shows an em dash for missing cash figures — never a fabricated 0', () => {
    const csv = buildKassenberichtCsv(
      sample({ cashExpectedEur: null, cashCountedEur: null, cashVarianceEur: null }),
    );
    expect(csv).toContain('Kasse;Gezählt (bar);—');
    expect(csv).not.toContain('Kasse;Gezählt (bar);0,00');
  });

  it('reports TSE health counts', () => {
    const csv = buildKassenberichtCsv(sample({ tseFinishedCount: 7, tseFailedCount: 0 }));
    expect(csv).toContain('TSE;Signiert;7');
    expect(csv).toContain('TSE;Fehlgeschlagen;0');
  });

  it('counts row: Verkäufe / Ankäufe / Stornos', () => {
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('Belege;Verkäufe;7');
    expect(csv).toContain('Belege;Ankäufe;2');
    expect(csv).toContain('Belege;Stornos;1');
  });
});
