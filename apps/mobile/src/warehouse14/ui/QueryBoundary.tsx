/**
 * QueryBoundary — the single helper that turns a `useQuery` result into the
 * right state, so EVERY list and detail screen renders loading / error / empty /
 * content the same way. This is the whole point of the state system: a surface
 * stops hand-rolling „Lade…" text and bespoke error cards and instead wraps its
 * content in one boundary that knows the four states cold.
 *
 *   const products = useQuery(() => listProducts(query), { key })
 *   <QueryBoundary
 *     query={products}
 *     loading={<SkeletonCard rows={5} />}
 *     isEmpty={(d) => d.items.length === 0}
 *     empty={{ icon: PackageOpen, title: "Keine Artikel", description: "…" }}
 *   >
 *     {(data) => data.items.map((p) => <ProductRow key={p.id} product={p} />)}
 *   </QueryBoundary>
 *
 * The state machine (mirrors data/types.ts and the honesty rule):
 *
 *   status "loading"          → the `loading` skeleton (never a spinner). First
 *                               load only; a background refetch keeps data up.
 *   status "error" + no data  → <ErrorState> with the real message + Retry,
 *                               wired to `query.refetch`. A connection failure
 *                               reads as offline; a server refusal shows its
 *                               themed message.
 *   data present but `isEmpty`→ the <EmptyState> from `empty` (a real empty
 *                               result, never a fabricated row).
 *   data present              → `children(data)`. Stays on screen even if a
 *                               background revalidation later fails — the bar
 *                               and the inline retry handle that, the content
 *                               never flickers back to a skeleton.
 *
 * Honesty rule: `children` only ever runs with a non-null `data` from a real
 * response. There is no code path that renders content without real data.
 */
import { type ReactNode } from "react"
import { Inbox, type LucideIcon } from "lucide-react-native"

import { EmptyState } from "./EmptyState"
import { ErrorState } from "./ErrorState"
import { SkeletonCard } from "./Skeleton"
import type { QueryResult } from "./data/types"

/** The empty-state config a boundary renders when a real result has no rows. */
export interface QueryBoundaryEmpty {
  title: string
  description?: string
  icon?: LucideIcon
  actionLabel?: string
  onAction?: () => void
}

export interface QueryBoundaryProps<T> {
  /** The query result (`useQuery(...)`). */
  query: Pick<
    QueryResult<T>,
    "data" | "status" | "error" | "errorCause" | "isFetching" | "refetch"
  >
  /**
   * Render the loaded content. Receives the non-null `data`. Runs ONLY when
   * real data is present — the honesty guarantee.
   */
  children: (data: T) => ReactNode
  /**
   * The loading placeholder (a Skeleton in the surface's shape). Defaults to a
   * `SkeletonCard` — always pass the shape that matches your loaded content for
   * a pixel-faithful loading state.
   */
  loading?: ReactNode
  /**
   * Decide whether a successful result is "empty" (e.g. `(d) => !d.items.length`).
   * When omitted, a non-null result is never treated as empty.
   */
  isEmpty?: (data: T) => boolean
  /** The empty-state to show when `isEmpty` is true. Omit to render nothing. */
  empty?: QueryBoundaryEmpty
  /**
   * Override the error block (e.g. to place it inside a card). When omitted, the
   * standard centred <ErrorState> with Retry is shown.
   */
  renderError?: (args: {
    message: string | null
    cause: unknown
    retry: () => void
    retrying: boolean
  }) => ReactNode
}

export function QueryBoundary<T>({
  query,
  children,
  loading,
  isEmpty,
  empty,
  renderError,
}: QueryBoundaryProps<T>): ReactNode {
  const { data, status, error, errorCause, isFetching, refetch } = query

  // First-load skeleton — only when we truly have nothing yet.
  if (status === "loading" && data == null) {
    return <>{loading ?? <SkeletonCard rows={4} />}</>
  }

  // Hard error with no cached data to fall back on.
  if (status === "error" && data == null) {
    const retry = () => {
      void refetch()
    }
    if (renderError != null) {
      return <>{renderError({ message: error, cause: errorCause, retry, retrying: isFetching })}</>
    }
    return (
      <ErrorState
        message={error}
        cause={errorCause}
        onRetry={retry}
        retrying={isFetching}
      />
    )
  }

  // Real data in hand. (status may still be "success" while revalidating.)
  if (data != null) {
    if (isEmpty?.(data)) {
      if (empty == null) return null
      return (
        <EmptyState
          icon={empty.icon ?? Inbox}
          title={empty.title}
          description={empty.description}
          actionLabel={empty.actionLabel}
          onAction={empty.onAction}
        />
      )
    }
    return <>{children(data)}</>
  }

  // status "idle" (query gated off) — render nothing.
  return null
}
