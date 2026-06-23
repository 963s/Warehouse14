/**
 * Catalog browsing hook: fetch, paginate, filter, sort.
 *
 * Reads the live `/api/storefront/products` endpoint. Filtering pushes the
 * category / metal / erhaltung / MiNr range / free-text facets to the server
 * (which uses the storefront catalog covering index). Sorting by price and year
 * is client-side over the loaded page, matching the web storefront's approach
 * (kept off the server hot path). Newest-first is the server default order.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { catalog } from "./api"
import type { StorefrontProduct, StorefrontProductsQuery } from "./types"

export type SortKey = "newest" | "priceAsc" | "priceDesc" | "year"

export interface CatalogFilters {
  category?: string
  metal?: string
  erhaltung?: StorefrontProductsQuery["erhaltung"]
  minrVon?: number
  minrBis?: number
  q?: string
}

const PAGE_SIZE = 24

function sortProducts(items: StorefrontProduct[], sort: SortKey): StorefrontProduct[] {
  const copy = [...items]
  switch (sort) {
    case "priceAsc":
      return copy.sort((a, b) => Number(a.listPriceEur) - Number(b.listPriceEur))
    case "priceDesc":
      return copy.sort((a, b) => Number(b.listPriceEur) - Number(a.listPriceEur))
    case "year":
      return copy.sort(
        (a, b) => (b.yearMintedTo ?? b.yearMintedFrom ?? 0) - (a.yearMintedTo ?? a.yearMintedFrom ?? 0),
      )
    case "newest":
    default:
      // Server already returns published_at DESC; keep stable.
      return copy
  }
}

export interface UseCatalogResult {
  items: StorefrontProduct[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
}

export function useCatalog(filters: CatalogFilters, sort: SortKey): UseCatalogResult {
  const [items, setItems] = useState<StorefrontProduct[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Serialise the active query so the effect re-fetches on any change.
  const filterKey = JSON.stringify(filters)
  const offsetRef = useRef(0)

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const query: StorefrontProductsQuery = {
        limit: PAGE_SIZE,
        offset,
        ...filters,
      }
      // Drop empty-string facets so they don't become server-side predicates.
      if (!query.category) delete query.category
      if (!query.metal) delete query.metal
      if (!query.erhaltung) delete query.erhaltung
      if (query.minrVon == null || Number.isNaN(query.minrVon)) delete query.minrVon
      if (query.minrBis == null || Number.isNaN(query.minrBis)) delete query.minrBis
      if (!query.q) delete query.q

      const res = await catalog.listProducts(query)
      const next = append ? [...items, ...res.items] : res.items
      setItems(next)
      setTotal(res.total)
      offsetRef.current = offset + res.items.length
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    offsetRef.current = 0
    try {
      await fetchPage(0, false)
    } catch (err) {
      setError(errorMessage(err))
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [fetchPage])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return
    if (offsetRef.current >= total) return
    setLoadingMore(true)
    try {
      await fetchPage(offsetRef.current, true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage, loadingMore, loading, total])

  const sorted = sortProducts(items, sort)
  const hasMore = offsetRef.current < total

  return { items: sorted, total, loading, loadingMore, error, hasMore, refresh, loadMore }
}

function errorMessage(err: unknown): string {
  // Imported lazily to avoid a circular import at module load.
  const { describeError } = require("./german") as typeof import("./german")
  return describeError(err)
}
