/** Shared product-status presentation (German labels + Badge variants). */
import type { ProductStatus } from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"

export const STATUS_LABEL: Record<ProductStatus, string> = {
  AVAILABLE: "Verfügbar",
  DRAFT: "Entwurf",
  RESERVED: "Reserviert",
  SOLD: "Verkauft",
}

export const STATUS_VARIANT: Record<ProductStatus, NonNullable<BadgeProps["variant"]>> = {
  AVAILABLE: "success",
  DRAFT: "secondary",
  RESERVED: "default",
  SOLD: "destructive",
}

/** Lager filter chips: Alle + the four statuses, in scan-verdict order. */
export const STATUS_FILTERS: ReadonlyArray<{ label: string; value: ProductStatus | "ALL" }> = [
  { label: "Alle", value: "ALL" },
  { label: "Verfügbar", value: "AVAILABLE" },
  { label: "Entwurf", value: "DRAFT" },
  { label: "Reserviert", value: "RESERVED" },
  { label: "Verkauft", value: "SOLD" },
]

/** A product's Lagerort triplet → "Tresor A · Schublade 1 · Pos 3" (omits gaps). */
export function formatLocation(
  unit: string | null,
  drawer: string | null,
  position: string | null,
): string {
  const parts = [unit, drawer, position].filter((p): p is string => !!p && p.trim() !== "")
  return parts.length ? parts.join(" · ") : "Kein Lagerort"
}
