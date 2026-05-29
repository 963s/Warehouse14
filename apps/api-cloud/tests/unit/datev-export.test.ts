import { describe, expect, it } from 'vitest';

import { type DATEVRow, generateDatevCsv } from '../../src/lib/datev-export.js';

const ROWS: DATEVRow[] = [
  {
    amountEur: '1234.56',
    debitCredit: 'S',
    account: '1000',
    contraAccount: '8400',
    taxKey: '',
    date: '2026-05-29',
    reference: 'RCP-2026-000123',
    bookingText: 'VERKAUF RCP-2026-000123 (regular_19)',
  },
  {
    amountEur: '500.00',
    debitCredit: 'S',
    account: '3200',
    contraAccount: '1000',
    date: '2026-05-29',
    reference: 'RCP-2026-000124',
    bookingText: 'ANKAUF RCP-2026-000124 (differential_25a)',
  },
];

describe('generateDatevCsv', () => {
  it('starts with the fixed EXTF Buchungsstapel header', async () => {
    const csv = await generateDatevCsv(ROWS);
    expect(csv.startsWith('EXTF')).toBe(true);
    expect(csv.startsWith('EXTF;700;21;Buchungsstapel;')).toBe(true);
  });

  it('emits the column header as line 2', async () => {
    const csv = await generateDatevCsv(ROWS);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('Umsatz');
    expect(lines[1]).toContain('Soll/Haben');
    expect(lines[1]).toContain('Buchungstext');
  });

  it('formats amounts as German decimals and dates as DDMM', async () => {
    const csv = await generateDatevCsv(ROWS);
    // semicolon-delimited + quote-wrapped
    expect(csv).toContain('"1234,56";"S";"EUR"');
    // 2026-05-29 → DDMM 2905
    expect(csv).toContain('"2905"');
  });

  it('handles an empty row list (header + column line only)', async () => {
    const csv = await generateDatevCsv([]);
    const lines = csv.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // EXTF header + column header
    expect(lines[0]?.startsWith('EXTF')).toBe(true);
  });
});
