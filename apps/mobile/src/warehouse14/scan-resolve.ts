/**
 * scan-resolve — PORTED VERBATIM from apps/tauri-pos/src/lib/scan-resolve.ts.
 *
 * Pure logic (no React, no network), so it is copied across the app boundary
 * rather than imported (the only cross-app reuse is the @warehouse14/api-client
 * workspace package, which supplies the ProductListRow type). The staff
 * productsApi exposes `status` + `barcode`, so unlike the POC's storefront stub
 * this returns the FULL verdict (found/sold/reserved/draft/not-found).
 */
import type { ProductListRow } from "@warehouse14/api-client"

export type ScanMatch =
  | { kind: "found"; product: ProductListRow }
  | { kind: "sold"; product: ProductListRow }
  | { kind: "reserved"; product: ProductListRow }
  | { kind: "draft"; product: ProductListRow }
  | { kind: "not-found" }

/**
 * Normalise a raw scanner buffer: strip surrounding whitespace / stray CR and
 * uppercase so case-variant scans still match. SKUs are uppercase, hyphenated,
 * space-free — we only trim the ends, never touch the interior.
 */
export function normalizeScan(raw: string): string {
  return raw.trim().toUpperCase()
}

/**
 * Classify a scanned code against the rows a catalog lookup returned. Matches
 * the SKU first (the barcode IS the SKU), then falls back to the legacy
 * `barcode` column for pre-printed EAN/UPC tags. The matched row's status
 * decides the verdict; an empty/absent match is `not-found`.
 */
export function classifyScanMatch(code: string, rows: readonly ProductListRow[]): ScanMatch {
  const norm = normalizeScan(code)
  if (norm === "") return { kind: "not-found" }

  const product = rows.find(
    (r) =>
      normalizeScan(r.sku) === norm || (r.barcode != null && normalizeScan(r.barcode) === norm),
  )
  if (!product) return { kind: "not-found" }

  switch (product.status) {
    case "AVAILABLE":
      return { kind: "found", product }
    case "SOLD":
      return { kind: "sold", product }
    case "RESERVED":
      return { kind: "reserved", product }
    case "DRAFT":
      return { kind: "draft", product }
  }
}
