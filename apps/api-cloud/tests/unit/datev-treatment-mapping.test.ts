import { describe, expect, it } from 'vitest';
import { type DatevItemRow, toDatevRow, toDatevRows } from '../../src/routes/closing-export.js';

/**
 * The Steuerberater-confirmed SKR03 mapping (2026): each VERKAUF must post to
 * the revenue account matching its tax treatment — NOT collapse onto 8400 —
 * with the correct DATEV BU-Schlüssel. This is the fix for the "steuerlich
 * blinde" export an inspector would reject.
 */
const baseTx = {
  total_eur: '780.00',
  direction: 'VERKAUF',
  receipt_locator: 'RCP-2026-000004',
  finalized_at: new Date('2026-06-08T10:00:00Z'),
};

describe('DATEV per-tax-treatment Gegenkonto + BU-Schlüssel routing', () => {
  it('STANDARD_19 → Gegenkonto 8400, BU-Schlüssel 3', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'STANDARD_19' });
    expect(r.contraAccount).toBe('8400');
    expect(r.taxKey).toBe('3');
  });

  it('REDUCED_7 → Gegenkonto 8300, BU-Schlüssel 2', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'REDUCED_7' });
    expect(r.contraAccount).toBe('8300');
    expect(r.taxKey).toBe('2');
  });

  it('MARGIN_25A (§25a Differenzbesteuerung) → Gegenkonto 8200, no BU key', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'MARGIN_25A' });
    expect(r.contraAccount).toBe('8200');
    expect(r.taxKey).toBeUndefined();
  });

  it('INVESTMENT_GOLD_25C (§25c steuerfrei) → Gegenkonto 8150, no BU key', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'INVESTMENT_GOLD_25C' });
    expect(r.contraAccount).toBe('8150');
    expect(r.taxKey).toBeUndefined();
  });

  it('the four treatments do NOT all collapse onto 8400', () => {
    const accounts = new Set(
      ['STANDARD_19', 'REDUCED_7', 'MARGIN_25A', 'INVESTMENT_GOLD_25C'].map(
        (t) => toDatevRow({ ...baseTx, tax_treatment_code: t }).contraAccount,
      ),
    );
    expect(accounts).toEqual(new Set(['8400', '8300', '8200', '8150']));
  });

  it('unknown treatment falls back to 8400 with no BU key (conservative)', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'SOMETHING_NEW' });
    expect(r.contraAccount).toBe('8400');
    expect(r.taxKey).toBeUndefined();
  });

  it('ANKAUF posts Wareneingang (3200) an Kasse (1000), no output-VAT key', () => {
    const r = toDatevRow({
      ...baseTx,
      direction: 'ANKAUF',
      tax_treatment_code: 'MARGIN_25A',
    });
    expect(r.account).toBe('3200');
    expect(r.contraAccount).toBe('1000');
    expect(r.taxKey).toBeUndefined();
  });
});

/**
 * MIXED receipts: a single sale whose items span >1 tax treatment carries a
 * transaction-level tax_treatment_code = 'MIXED' (or otherwise has items of
 * different treatments). It MUST NOT collapse onto a single 8400 row — each
 * treatment portion has to land on its own SKR03 Gegenkonto + BU. `toDatevRows`
 * emits one booking line per tax-treatment group; the line sums must reconcile
 * to the receipt total exactly (integer cents).
 */
describe('DATEV MIXED-treatment per-line split', () => {
  const mixedTx = {
    total_eur: '300.00',
    direction: 'VERKAUF',
    tax_treatment_code: 'MIXED',
    receipt_locator: 'RCP-2026-000005',
    finalized_at: new Date('2026-06-08T10:00:00Z'),
  };

  // §25a margin item €200,00 + 19% standard item €100,00 → €300,00 receipt.
  const mixedItems: DatevItemRow[] = [
    { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '200.00' },
    { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '100.00' },
  ];

  it('emits ONE row per tax-treatment group (2 groups → 2 rows)', () => {
    const rows = toDatevRows(mixedTx, mixedItems);
    expect(rows).toHaveLength(2);
  });

  it('books each portion to the correct Gegenkonto with BU only on the 19% leg', () => {
    const rows = toDatevRows(mixedTx, mixedItems);
    const byAccount = new Map(rows.map((r) => [r.contraAccount, r]));

    const margin = byAccount.get('8200');
    expect(margin).toBeDefined();
    expect(margin?.amountEur).toBe('200.00');
    expect(margin?.taxKey).toBeUndefined();

    const standard = byAccount.get('8400');
    expect(standard).toBeDefined();
    expect(standard?.amountEur).toBe('100.00');
    expect(standard?.taxKey).toBe('3');
  });

  it('the split rows reconcile to the receipt total exactly (cents)', () => {
    const rows = toDatevRows(mixedTx, mixedItems);
    const sumCents = rows.reduce((acc, r) => {
      const [w = '0', f = ''] = r.amountEur.split('.');
      return acc + BigInt(w) * 100n + BigInt(f.padEnd(2, '0'));
    }, 0n);
    expect(sumCents).toBe(30000n); // €300,00 = 30000 cents
  });

  it('groups multiple items of the SAME treatment into one summed row', () => {
    const rows = toDatevRows({ ...mixedTx, total_eur: '450.00' }, [
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '200.00' },
      { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '100.00' },
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '150.00' },
    ]);
    expect(rows).toHaveLength(2);
    const margin = rows.find((r) => r.contraAccount === '8200');
    expect(margin?.amountEur).toBe('350.00'); // 200 + 150
    const standard = rows.find((r) => r.contraAccount === '8400');
    expect(standard?.amountEur).toBe('100.00');
  });

  it('the Buchungstext names the treatment so each split leg is identifiable', () => {
    const rows = toDatevRows(mixedTx, mixedItems);
    const margin = rows.find((r) => r.contraAccount === '8200');
    const standard = rows.find((r) => r.contraAccount === '8400');
    expect(margin?.bookingText).toContain('MARGIN_25A');
    expect(margin?.bookingText).toContain(mixedTx.receipt_locator);
    expect(standard?.bookingText).toContain('STANDARD_19');
  });

  it('SINGLE-treatment VERKAUF stays exactly one row, byte-identical to toDatevRow', () => {
    const tx = {
      total_eur: '780.00',
      direction: 'VERKAUF',
      tax_treatment_code: 'MARGIN_25A',
      receipt_locator: 'RCP-2026-000004',
      finalized_at: new Date('2026-06-08T10:00:00Z'),
    };
    const items: DatevItemRow[] = [
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '780.00' },
    ];
    const rows = toDatevRows(tx, items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(toDatevRow(tx));
  });

  it('VERKAUF with NO items falls back to the single transaction-level row', () => {
    const tx = {
      total_eur: '50.00',
      direction: 'VERKAUF',
      tax_treatment_code: 'STANDARD_19',
      receipt_locator: 'RCP-2026-000006',
      finalized_at: new Date('2026-06-08T10:00:00Z'),
    };
    const rows = toDatevRows(tx, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(toDatevRow(tx));
  });

  it('ANKAUF is never split even with multi-treatment items', () => {
    const tx = {
      total_eur: '500.00',
      direction: 'ANKAUF',
      tax_treatment_code: 'MIXED',
      receipt_locator: 'RCP-2026-000007',
      finalized_at: new Date('2026-06-08T10:00:00Z'),
    };
    const items: DatevItemRow[] = [
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '300.00' },
      { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '200.00' },
    ];
    const rows = toDatevRows(tx, items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(toDatevRow(tx));
    expect(rows[0]?.account).toBe('3200');
  });
});

/**
 * STORNO polarity. A storno is a NEW transaction row whose `storno_of_…` FK is
 * set and whose money columns are NEGATIVE (DB CHECK `transactions_sign_
 * discipline`: total_eur <= 0 on a storno row). DATEV's `Umsatz` field MUST be
 * a POSITIVE magnitude — the direction is expressed ENTIRELY by the Soll/Haben
 * (S/H) flag, NOT by a minus sign. So a storno reverses the original posting:
 * the original VERKAUF books Kasse(S) an Erlöse; its storno must flip to Haben
 * (H) on Konto Kasse with the SAME positive magnitude — a clean reversing line.
 * Emitting a negative `Umsatz` with `S` (the pre-fix behaviour) is non-
 * conforming and a Prüfer would reject it.
 *
 * The storno_of_transaction_id is not on the lean TxRow the exporter reads, so
 * the storno signal is the negative total_eur itself (set on storno rows only).
 */
describe('DATEV storno polarity (negative total → positive Umsatz, flipped S/H)', () => {
  const stornoOfSale = {
    total_eur: '-595.00', // storno row: negative per the DB sign-discipline CHECK
    direction: 'VERKAUF',
    tax_treatment_code: 'STANDARD_19',
    receipt_locator: 'RCP-2026-000200',
    finalized_at: new Date('2026-06-08T12:00:00Z'),
  };

  it('a VERKAUF storno emits a POSITIVE Umsatz (no minus sign carried into DATEV)', () => {
    const r = toDatevRow(stornoOfSale);
    expect(r.amountEur).toBe('595.00');
    expect(r.amountEur.startsWith('-')).toBe(false);
  });

  it('a VERKAUF storno flips Soll/Haben to H (reverses the original S posting)', () => {
    const r = toDatevRow(stornoOfSale);
    expect(r.debitCredit).toBe('H');
  });

  it('a normal (positive) VERKAUF still posts S — non-storno behaviour unchanged', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'STANDARD_19' });
    expect(r.debitCredit).toBe('S');
    expect(r.amountEur).toBe('780.00');
  });

  it('the storno still routes the correct per-treatment Gegenkonto + BU key', () => {
    const r = toDatevRow(stornoOfSale);
    // Same SKR03 routing as the original sale — only the polarity reverses.
    expect(r.contraAccount).toBe('8400');
    expect(r.taxKey).toBe('3');
    expect(r.account).toBe('1000');
  });

  it('an ANKAUF storno also flips to positive Umsatz on the H side', () => {
    const r = toDatevRow({
      total_eur: '-300.00',
      direction: 'ANKAUF',
      tax_treatment_code: 'MARGIN_25A',
      receipt_locator: 'RCP-2026-000201',
      finalized_at: new Date('2026-06-08T12:05:00Z'),
    });
    expect(r.amountEur).toBe('300.00');
    expect(r.debitCredit).toBe('H'); // reverses the Wareneingang(S) original
    expect(r.account).toBe('3200');
    expect(r.contraAccount).toBe('1000');
  });

  it('a MIXED storno splits per treatment, each leg positive on the H side', () => {
    const tx = {
      total_eur: '-300.00',
      direction: 'VERKAUF',
      tax_treatment_code: 'MIXED',
      receipt_locator: 'RCP-2026-000202',
      finalized_at: new Date('2026-06-08T12:10:00Z'),
    };
    // Storno line totals are negative too (mirror of the original lines).
    const items: DatevItemRow[] = [
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '-200.00' },
      { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '-100.00' },
    ];
    const rows = toDatevRows(tx, items);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.debitCredit).toBe('H');
      expect(r.amountEur.startsWith('-')).toBe(false);
    }
    const margin = rows.find((r) => r.contraAccount === '8200');
    const standard = rows.find((r) => r.contraAccount === '8400');
    expect(margin?.amountEur).toBe('200.00');
    expect(standard?.amountEur).toBe('100.00');
  });
});
