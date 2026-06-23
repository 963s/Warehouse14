/**
 * Verfügbarkeit — the one shared model of „was ist verkäuflich".
 *
 * „Available to sell" is first-class across the Owner OS: an article is only
 * sellable when its lifecycle status is exactly AVAILABLE. RESERVED stock is held
 * by a live POS/Storefront/eBay session (it may free up again), SOLD stock has
 * left the inventory, and a DRAFT is not yet released for sale. Both the Lager
 * catalog and the Verkauf item picker read THIS module so the verdict — and its
 * honest German reason — never drifts between the two screens.
 *
 * Pure + presentational only: status → label/variant/reason and a live-count
 * shape. No fetching, no fabricated number; the caller passes real wire values.
 */
import type { ProductStatus } from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"

/** The ONE status from which an article can be reserved → sold. */
export const SELLABLE_STATUS: ProductStatus = "AVAILABLE"

/** TRUE only for AVAILABLE stock — the single gate the sell flow trusts. */
export function isSellable(status: ProductStatus | string | null | undefined): boolean {
  return status === SELLABLE_STATUS
}

// ── The three first-class availability buckets (Verfügbar/Reserviert/Verkauft) ─
//
// DRAFT is deliberately NOT a bucket here: it is a not-yet-released editing state,
// surfaced as its own „Entwurf" filter in the Lager, but it is never „inventory
// you can act on" in the availability sense. The buckets below are what the
// operator reasons about when asking „what can I sell right now".

export type AvailabilityBucket = "AVAILABLE" | "RESERVED" | "SOLD"

export interface AvailabilityBucketMeta {
  bucket: AvailabilityBucket
  /** German one-word label, e.g. „Verfügbar". */
  label: string
  /** Badge tone — verdigris success for available, neutral for held, muted for gone. */
  variant: NonNullable<BadgeProps["variant"]>
}

/** The buckets in scan-verdict order: what you can sell, what's held, what's gone. */
export const AVAILABILITY_BUCKETS: readonly AvailabilityBucketMeta[] = [
  { bucket: "AVAILABLE", label: "Verfügbar", variant: "success" },
  { bucket: "RESERVED", label: "Reserviert", variant: "default" },
  { bucket: "SOLD", label: "Verkauft", variant: "secondary" },
]

/**
 * Why a non-AVAILABLE row cannot be added to the cart — an honest German line,
 * never a raw token. AVAILABLE returns null (it IS sellable, no reason to show).
 * Any unknown/future status degrades to a calm, truthful catch-all.
 */
export function notSellableReason(status: ProductStatus | string | null | undefined): string | null {
  switch (status) {
    case "AVAILABLE":
      return null
    case "RESERVED":
      return "Reserviert in einer laufenden Sitzung gehalten, nicht verkäuflich."
    case "SOLD":
      return "Bereits verkauft nicht mehr im Bestand."
    case "DRAFT":
      return "Entwurf noch nicht für den Verkauf freigegeben."
    default:
      return "Zurzeit nicht verkäuflich."
  }
}

// ── Live counts (Verfügbar/Reserviert/Verkauft + Bestand gesamt) ──────────────
//
// The shape both screens render. Every field is a real `total` from a
// status-filtered product list — there is no estimate or fabricated value. The
// caller's hook fills it from the wire; presentation reads it as-is.

export interface InventoryCounts {
  available: number
  reserved: number
  sold: number
  /** Sum of the three sellable-relevant buckets (excludes DRAFT). */
  inStock: number
}

export const EMPTY_INVENTORY_COUNTS: InventoryCounts = {
  available: 0,
  reserved: 0,
  sold: 0,
  inStock: 0,
}

/** Assemble counts from the three bucket totals (inStock is derived, never guessed). */
export function makeInventoryCounts(parts: {
  available: number
  reserved: number
  sold: number
}): InventoryCounts {
  return {
    available: parts.available,
    reserved: parts.reserved,
    sold: parts.sold,
    inStock: parts.available + parts.reserved + parts.sold,
  }
}

/** The live count for a single bucket — used to label the Lager status chips. */
export function bucketCount(counts: InventoryCounts | null, bucket: AvailabilityBucket): number {
  if (counts == null) return 0
  return bucket === "AVAILABLE"
    ? counts.available
    : bucket === "RESERVED"
      ? counts.reserved
      : counts.sold
}

// ── Available-first ordering for a mixed picker list ──────────────────────────
//
// The product list endpoint returns mixed statuses in no availability order. The
// Verkauf picker shows every match (so the operator sees that the article they
// scanned is RESERVED, not „missing") but must float the sellable rows to the
// top. This rank + comparator does exactly that, stably, without inventing data.

const STATUS_RANK: Record<string, number> = {
  AVAILABLE: 0,
  RESERVED: 1,
  DRAFT: 2,
  SOLD: 3,
}

/** Sort rank for a status — sellable first, gone last; unknowns sort after known. */
export function availabilityRank(status: ProductStatus | string | null | undefined): number {
  if (status != null && status in STATUS_RANK) return STATUS_RANK[status]
  return 9
}

/**
 * A stable comparator that floats AVAILABLE rows to the top (then RESERVED,
 * DRAFT, SOLD), preserving the server's original order WITHIN each bucket.
 * Stable because we only compare ranks; equal ranks keep input order under a
 * stable sort (Array.prototype.sort is stable in modern engines + Hermes).
 */
export function compareByAvailability(
  a: { status: ProductStatus | string },
  b: { status: ProductStatus | string },
): number {
  return availabilityRank(a.status) - availabilityRank(b.status)
}

/**
 * A compact de-DE count summary for the picker strip:
 * „11 verfügbar · 6 reserviert · 5 verkauft". Returns null when counts are not
 * yet loaded so the caller can show a skeleton instead of „0 verfügbar".
 */
export function availabilitySummaryLine(counts: InventoryCounts | null): string | null {
  if (counts == null) return null
  const n = (v: number) => v.toLocaleString("de-DE")
  return `${n(counts.available)} verfügbar · ${n(counts.reserved)} reserviert · ${n(counts.sold)} verkauft`
}
