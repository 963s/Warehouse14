import { describe, expect, it } from 'vitest';
import { toDatevRow } from '../../src/routes/closing-export.js';

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
