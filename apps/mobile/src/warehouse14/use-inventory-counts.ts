/**
 * useInventoryCounts — the live „was ist verfügbar / reserviert / verkauft"
 * read, on the shared data spine (`useQuery`: first-load loading, stale-while-
 * revalidate, refetch-on-focus, pull-to-refresh, in-flight de-dupe, themed
 * German errors). The fetcher fans out to three status-filtered product lists
 * and returns their real `total`s, assembled into an `InventoryCounts`.
 *
 * Honesty rule: `data` stays null until a real response lands. A surface reads
 * `counts.data` and shows a skeleton/placeholder otherwise — there is no path
 * here that yields a fabricated number, and `inStock` is derived from the three
 * real totals, never guessed.
 */
import { countProductsByStatus } from "@/warehouse14/api"
import { makeInventoryCounts, type InventoryCounts } from "@/warehouse14/availability-ui"
import { useQuery, type QueryResult } from "@/warehouse14/ui"

export interface UseInventoryCountsOptions {
  /** Optional search term so the counts match a filtered picker. */
  q?: string
  /** Gate the read (e.g. don't count while a sheet is closed). Default true. */
  enabled?: boolean
}

/**
 * Live per-status inventory counts. Keyed by the (trimmed) search term so each
 * search keeps its own count, and so two mounts of the same search share one
 * fan-out (the de-dupe is keyed too).
 */
export function useInventoryCounts(
  options: UseInventoryCountsOptions = {},
): QueryResult<InventoryCounts> {
  const { q, enabled = true } = options
  const term = (q ?? "").trim()
  return useQuery<InventoryCounts>(
    async () => makeInventoryCounts(await countProductsByStatus(term || undefined)),
    { key: `inventory:counts:${term}`, enabled },
  )
}
