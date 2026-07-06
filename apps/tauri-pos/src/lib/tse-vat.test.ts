/**
 * Phase 1.5 — the TSE `amounts_per_vat_id` breakdown.
 *
 * Locks the canonical DSFinV-K USt-Schlüssel mapping (mirrored from the server)
 * and the grouping/summing that the signed body carries, so the TSE FINISH and
 * the DSFinV-K export can never disagree for the same line.
 */
import { describe, expect, it } from 'vitest';

import { computeAmountsPerVatId, ustSchluessel } from './tse-vat.js';

describe('ustSchluessel — the canonical DSFinV-K keys', () => {
  it('maps each treatment to the server key', () => {
    expect(ustSchluessel('STANDARD_19')).toBe(1);
    expect(ustSchluessel('REDUCED_7')).toBe(2);
    expect(ustSchluessel('INVESTMENT_GOLD_25C')).toBe(5);
    expect(ustSchluessel('MARGIN_25A')).toBe(7);
    // Not in the server's explicit map → its '7' fallback, mirrored here.
    expect(ustSchluessel('REVERSE_CHARGE_13B')).toBe(7);
  });
});

describe('computeAmountsPerVatId — group + sum gross per vat_id', () => {
  it('groups a mixed 19 % / 7 % / §25a receipt and sums the gross per key', () => {
    const out = computeAmountsPerVatId([
      { appliedTaxTreatmentCode: 'STANDARD_19', lineTotalCents: 11900 },
      { appliedTaxTreatmentCode: 'REDUCED_7', lineTotalCents: 10700 },
      { appliedTaxTreatmentCode: 'MARGIN_25A', lineTotalCents: 50000 },
      { appliedTaxTreatmentCode: 'STANDARD_19', lineTotalCents: 100 },
    ]);
    expect(out).toEqual([
      { vatId: 1, amountCents: 12000 },
      { vatId: 2, amountCents: 10700 },
      { vatId: 7, amountCents: 50000 },
    ]);
  });

  it('emits a single entry for a single-treatment receipt', () => {
    expect(
      computeAmountsPerVatId([
        { appliedTaxTreatmentCode: 'MARGIN_25A', lineTotalCents: 25000 },
      ]),
    ).toEqual([{ vatId: 7, amountCents: 25000 }]);
  });

  it('the breakdown sum equals the receipt total', () => {
    const lines = [
      { appliedTaxTreatmentCode: 'STANDARD_19' as const, lineTotalCents: 11900 },
      { appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C' as const, lineTotalCents: 200000 },
      { appliedTaxTreatmentCode: 'MARGIN_25A' as const, lineTotalCents: 4999 },
    ];
    const total = lines.reduce((n, l) => n + l.lineTotalCents, 0);
    const sum = computeAmountsPerVatId(lines).reduce((n, e) => n + e.amountCents, 0);
    expect(sum).toBe(total);
  });

  it('returns an empty array for no lines', () => {
    expect(computeAmountsPerVatId([])).toEqual([]);
  });
});
