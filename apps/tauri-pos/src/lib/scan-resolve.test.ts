/**
 * scan-resolve — pure logic for the cashier barcode scan→cart loop.
 *
 * The printed label carries a Code128 barcode of the SKU; a USB scanner emits
 * that SKU as keystrokes. This module is the PURE part: normalise the raw scan,
 * then classify it against the rows the catalog lookup returned so the caller
 * can give precise feedback (found+add / not-found / already-sold /
 * already-reserved / draft). No network, no React — trivially testable.
 */
import { describe, expect, it } from 'vitest';

import type { ProductListRow } from '@warehouse14/api-client';

import { classifyScanMatch, normalizeScan } from './scan-resolve.js';

/** Minimal row stub — only the fields the resolver reads. */
function row(partial: Partial<ProductListRow>): ProductListRow {
  return {
    id: 'id',
    sku: 'W14-AU-750-0012',
    barcode: null,
    status: 'AVAILABLE',
    name: 'Ring',
    listPriceEur: '100.00',
    ...partial,
  } as ProductListRow;
}

describe('normalizeScan', () => {
  it('trims surrounding whitespace and a trailing carriage return', () => {
    expect(normalizeScan('  W14-AU-750-0012 \r')).toBe('W14-AU-750-0012');
  });

  it('uppercases so case-variant scans still match', () => {
    expect(normalizeScan('w14-au-750-0012')).toBe('W14-AU-750-0012');
  });

  it('collapses to empty for blank input', () => {
    expect(normalizeScan('   ')).toBe('');
  });
});

describe('classifyScanMatch', () => {
  const target = row({ id: 'p1', sku: 'W14-AU-750-0012', status: 'AVAILABLE' });

  it('AVAILABLE exact SKU → found (ready to reserve)', () => {
    const m = classifyScanMatch('W14-AU-750-0012', [target]);
    expect(m).toEqual({ kind: 'found', product: target });
  });

  it('matches case-insensitively after normalization', () => {
    const m = classifyScanMatch(' w14-au-750-0012\r', [target]);
    expect(m.kind).toBe('found');
  });

  it('no row in the result set → not-found', () => {
    expect(classifyScanMatch('W14-XX-000-9999', [target])).toEqual({ kind: 'not-found' });
  });

  it('blank scan → not-found (never matches a row)', () => {
    expect(classifyScanMatch('   ', [target]).kind).toBe('not-found');
  });

  it('SOLD row → sold (do not add)', () => {
    const sold = row({ id: 'p2', sku: 'W14-AG-999-0003', status: 'SOLD' });
    expect(classifyScanMatch('W14-AG-999-0003', [sold])).toEqual({ kind: 'sold', product: sold });
  });

  it('RESERVED row → reserved (another channel holds it)', () => {
    const res = row({ id: 'p3', sku: 'W14-PT-950-0007', status: 'RESERVED' });
    expect(classifyScanMatch('W14-PT-950-0007', [res])).toEqual({ kind: 'reserved', product: res });
  });

  it('DRAFT row → draft (not yet verkaufsbereit)', () => {
    const d = row({ id: 'p4', sku: 'W14-AU-585-0021', status: 'DRAFT' });
    expect(classifyScanMatch('W14-AU-585-0021', [d])).toEqual({ kind: 'draft', product: d });
  });

  it('falls back to the barcode column when the scan is not the SKU', () => {
    const byBarcode = row({ id: 'p5', sku: 'W14-AU-750-0099', barcode: '4006381333931' });
    expect(classifyScanMatch('4006381333931', [byBarcode])).toEqual({
      kind: 'found',
      product: byBarcode,
    });
  });

  it('picks the exact SKU even when an ILIKE query returned near-matches', () => {
    const a = row({ id: 'a', sku: 'W14-AU-750-0012', status: 'AVAILABLE' });
    const b = row({ id: 'b', sku: 'W14-AU-750-00120', status: 'AVAILABLE' });
    const m = classifyScanMatch('W14-AU-750-0012', [b, a]);
    expect(m).toEqual({ kind: 'found', product: a });
  });
});
