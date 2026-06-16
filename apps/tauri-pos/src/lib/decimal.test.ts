import { describe, expect, it } from 'vitest';

import { formatEur, formatGrams, isWeightInput } from './decimal.js';

describe('formatGrams', () => {
  it('strips trailing zeros (the bug: 300 g showed as 300,0000)', () => {
    expect(formatGrams('300.0000')).toBe('300');
  });
  it('keeps real 3-dp gold weight with a German comma', () => {
    expect(formatGrams('7.965')).toBe('7,965');
  });
  it('trims to the significant fraction', () => {
    expect(formatGrams('12.50')).toBe('12,5');
  });
  it('empty/garbage → empty', () => {
    expect(formatGrams('')).toBe('');
    expect(formatGrams(null)).toBe('');
    expect(formatGrams('abc')).toBe('');
  });
});

describe('formatEur', () => {
  it('always 2 decimals, German comma', () => {
    expect(formatEur('300.00')).toBe('300,00');
    expect(formatEur('300')).toBe('300,00');
  });
  it('adds the thousands dot', () => {
    expect(formatEur('1234.5')).toBe('1.234,50');
  });
  it('empty/garbage → empty', () => {
    expect(formatEur('')).toBe('');
    expect(formatEur(null)).toBe('');
  });
});

describe('isWeightInput (3-dp, not 2)', () => {
  it('accepts a real gold weight the 2-dp money validator rejected', () => {
    expect(isWeightInput('7,965')).toBe(true);
    expect(isWeightInput('300')).toBe(true);
  });
  it('truncates a 4th fraction digit (consistent with money), rejects garbage', () => {
    expect(isWeightInput('7,9651')).toBe(true); // normalized to 7,965 then accepted
    expect(isWeightInput('abc')).toBe(false);
    expect(isWeightInput('')).toBe(false);
  });
});
