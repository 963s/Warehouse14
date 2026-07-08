/**
 * metal-margin — pure preview of the server's Ankauf derivation.
 *
 * The SERVER is the source of truth: `ankauf = ROUND(avg10d × (1 − margin), 4)`
 * (routes/metal-prices.ts, NUMERIC, half-away-from-zero). This mirrors it so the
 * margin editor can show the effect live AS YOU TYPE — the authoritative value
 * still comes from the server refetch after save. Money stays a string.
 */
import { describe, expect, it } from 'vitest';

import { deriveAnkaufPerGram, formatPerGram } from './metal-margin.js';

describe('deriveAnkaufPerGram', () => {
  it('applies (1 − margin) and rounds to 4dp like the server', () => {
    expect(deriveAnkaufPerGram('100.0000', 0.1)).toBe('90.0000');
    expect(deriveAnkaufPerGram('0.5000', 0.1)).toBe('0.4500');
  });

  it('matches the SQL ROUND(…,4) on a fractional margin', () => {
    // 65.4321 × 0.875 = 57.2530875 → 4dp → 57.2531
    expect(deriveAnkaufPerGram('65.4321', 0.125)).toBe('57.2531');
  });

  it('rounds halves away from zero (server NUMERIC ROUND)', () => {
    // 1.00005 × (1 − 0) = 1.00005 → 4dp → 1.0001
    expect(deriveAnkaufPerGram('1.00005', 0)).toBe('1.0001');
  });

  it('0% margin = the base; 100% margin = zero', () => {
    expect(deriveAnkaufPerGram('100', 0)).toBe('100.0000');
    expect(deriveAnkaufPerGram('100', 1)).toBe('0.0000');
  });

  it('null / non-numeric base → null (no fabricated number)', () => {
    expect(deriveAnkaufPerGram(null, 0.1)).toBeNull();
    expect(deriveAnkaufPerGram('', 0.1)).toBeNull();
    expect(deriveAnkaufPerGram('abc', 0.1)).toBeNull();
  });

  it('non-finite margin → null', () => {
    expect(deriveAnkaufPerGram('100', Number.NaN)).toBeNull();
  });
});

describe('formatPerGram', () => {
  it('formats a decimal string as German €/g', () => {
    expect(formatPerGram('90.0000')).toBe('90,00 €/g');
    expect(formatPerGram('57.2531')).toBe('57,2531 €/g');
  });

  it('null renders a hyphen placeholder (house style: no em dash)', () => {
    expect(formatPerGram(null)).toBe('-');
  });
});
