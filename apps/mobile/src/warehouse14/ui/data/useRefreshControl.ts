/**
 * useRefreshControl — a one-liner that turns a query's `isRefreshing` +
 * `refresh` into the exact `<RefreshControl>` props the Owner OS uses, themed
 * with the W14 brass `primary` so every pull-to-refresh on every surface looks
 * and feels identical (the consistency that makes the app read as one app).
 *
 *   const products = useQuery(() => listProducts(query), { key })
 *   const rc = useRefreshControl(products)
 *   <ScrollView refreshControl={<RefreshControl {...rc} />} … />
 *
 * Kept as a props object (not a rendered element) so callers stay in charge of
 * importing RefreshControl and can add their own props (e.g. progressViewOffset
 * under a translucent header).
 */
import { useW14Theme } from "../../theme"

/** The minimal slice of a query a RefreshControl needs. */
export interface RefreshableQuery {
  isRefreshing: boolean
  refresh: () => Promise<void>
}

/** Themed RefreshControl props (iOS `tintColor` + Android spinner colors). */
export interface RefreshControlProps {
  refreshing: boolean
  onRefresh: () => void
  tintColor: string
  colors: string[]
  progressBackgroundColor: string
}

export function useRefreshControl(query: RefreshableQuery): RefreshControlProps {
  const t = useW14Theme()
  return {
    refreshing: query.isRefreshing,
    // void the promise — RefreshControl's onRefresh expects `() => void`.
    onRefresh: () => {
      void query.refresh()
    },
    tintColor: t.colors.primary,
    colors: [t.colors.primary],
    progressBackgroundColor: t.colors.background,
  }
}
