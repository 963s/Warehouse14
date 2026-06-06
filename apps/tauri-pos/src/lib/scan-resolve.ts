/**
 * scan-resolve — pure logic for the cashier barcode scan→cart loop.
 *
 * One physical label serves storage AND sale: it carries a Code128 barcode of
 * the product's SKU (see src-tauri/commands/label.rs). A USB-HID scanner emits
 * that SKU as keystrokes (captured by useBarcodeScanner). This module turns the
 * raw scan into a precise verdict against the catalog rows the lookup returned,
 * so Verkauf can give the operator exact feedback instead of a silent miss.
 *
 * Kept pure (no network, no React) so the whole decision is unit-testable; the
 * physical print + real-scanner round-trip is the hardware-in-the-loop gate
 * (see docs/BACKLOG.md).
 */
import type { ProductListRow } from '@warehouse14/api-client';

export type ScanMatch =
  | { kind: 'found'; product: ProductListRow }
  | { kind: 'sold'; product: ProductListRow }
  | { kind: 'reserved'; product: ProductListRow }
  | { kind: 'draft'; product: ProductListRow }
  | { kind: 'not-found' };

/**
 * Normalise a raw scanner buffer: strip surrounding whitespace / stray CR and
 * uppercase so case-variant scans still match. SKUs are uppercase, hyphenated,
 * space-free — we only trim the ends, never touch the interior.
 */
export function normalizeScan(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Classify a scanned code against the rows a catalog lookup returned. Matches
 * the SKU first (the barcode IS the SKU), then falls back to the legacy
 * `barcode` column for pre-printed EAN/UPC tags. The matched row's status
 * decides the verdict; an empty/absent match is `not-found`.
 */
export function classifyScanMatch(code: string, rows: readonly ProductListRow[]): ScanMatch {
  const norm = normalizeScan(code);
  if (norm === '') return { kind: 'not-found' };

  const product = rows.find(
    (r) =>
      normalizeScan(r.sku) === norm || (r.barcode != null && normalizeScan(r.barcode) === norm),
  );
  if (!product) return { kind: 'not-found' };

  switch (product.status) {
    case 'AVAILABLE':
      return { kind: 'found', product };
    case 'SOLD':
      return { kind: 'sold', product };
    case 'RESERVED':
      return { kind: 'reserved', product };
    case 'DRAFT':
      return { kind: 'draft', product };
  }
}
