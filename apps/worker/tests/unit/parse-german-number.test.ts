import { describe, expect, it } from 'vitest';

import { parseGermanNumber } from '../../src/lib/anthropic-vision-client.js';

describe('parseGermanNumber', () => {
  it('parses a full German decimal with thousands dots and a comma', () => {
    expect(parseGermanNumber('1.234,56')).toBe(1234.56);
  });

  it('parses a German fineness decimal ("0,585")', () => {
    expect(parseGermanNumber('0,585')).toBe(0.585);
  });

  it('leaves a plain dot-decimal untouched (no comma → API rate "62.4500")', () => {
    expect(parseGermanNumber('62.4500')).toBe(62.45);
  });

  it('returns null for a non-numeric string', () => {
    expect(parseGermanNumber('abc')).toBe(null);
  });

  it('returns a finite number as-is', () => {
    expect(parseGermanNumber(1234.56)).toBe(1234.56);
  });

  it('returns null for null', () => {
    expect(parseGermanNumber(null)).toBe(null);
  });
});
