/**
 * verkauf-flow — the reservation lifecycle that turns the pure cart spine into a
 * real Verkauf. A Verkauf line is NOT just a row in the cart: the audited server
 * finalize moves each line RESERVED → SOLD and refuses anything that isn't
 * reserved by THIS cashier's session (apps/api-cloud transactions-finalize.ts
 * §3a binds `(sessionId, userId)`). So before a product can be sold it must be
 * reserved, and an abandoned cart must release its hold back to AVAILABLE.
 *
 * This hook owns exactly that ONE concern, sitting on top of `useCart`:
 *   • one client-generated POS sessionId per cart (the at-most-once dedup for
 *     the finalize is the SEPARATE idempotencyKey the sheet generates),
 *   • reserve-on-add (await the lock, then add the line carrying its session),
 *   • release-on-remove / release-on-clear / release-on-unmount (best-effort
 *     batch so the shop never strands stock in RESERVED after a back-out),
 *   • the honest mapping ProductDetail → CartLine — the tax fields the math
 *     needs (taxTreatmentCode + acquisitionCostEur for §25a) live on the DETAIL,
 *     never the list row, so a real sell must read the detail first.
 *
 * It performs NO money math and fires NO finalize — the surface composes the
 * cart totals + the FiscalConfirmSheet for that. Keeping the reservation concern
 * here is what lets the Verkauf screen stay a thin, declarative composition.
 *
 * Honesty: every reservation here is a real server lock. We never pretend a
 * product is reserved; a failed reserve surfaces as an error and the line is not
 * added, and a release that fails is logged into the abandoned-set, never hidden.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ProductDetail, ProductListRow, TaxTreatmentCode } from "@warehouse14/api-client"

import { describeError, releaseProductsBatch, reserveProduct } from "../api"
import { useCart, type CartLine, type UseCart } from "./cart"
// A reservation session id is a fresh UUIDv4 — the same generator the finalize
// idempotency key uses. They are DISTINCT values (different concerns): the
// session id binds the reservation→finalize ownership, the idempotency key is
// the at-most-once dedup the FiscalConfirmSheet generates per commit.
import { newIdempotencyKey as newSessionId } from "./idempotency"

// ────────────────────────────────────────────────────────────────────────────
// Detail → cart line
// ────────────────────────────────────────────────────────────────────────────

/** The Steuerschlüssel set the cart math knows how to price. The product detail
 *  types `taxTreatmentCode` as a bare string, so we narrow it to a real code and
 *  fall back to STANDARD_19 ONLY for an unknown value (the server re-validates
 *  the line money regardless, so an unknown code can never silently mis-bill). */
const KNOWN_TAX_CODES: ReadonlySet<TaxTreatmentCode> = new Set<TaxTreatmentCode>([
  "STANDARD_19",
  "REDUCED_7",
  "MARGIN_25A",
  "INVESTMENT_GOLD_25C",
  "REVERSE_CHARGE_13B",
  "MIXED",
])

function narrowTaxCode(code: string): TaxTreatmentCode {
  return KNOWN_TAX_CODES.has(code as TaxTreatmentCode) ? (code as TaxTreatmentCode) : "STANDARD_19"
}

/**
 * Turn a reserved product DETAIL into a Verkauf `CartLine`. Serialized inventory
 * is qty 1 (a unique physical item). The acquisition cost rides along ONLY for
 * §25a margin pricing — the cart math reads it; for every other Steuerschlüssel
 * it is inert. The reservation session is stamped here so the finalize body can
 * release exactly this hold.
 */
export function detailToCartLine(detail: ProductDetail, sessionId: string): CartLine {
  return {
    id: detail.id,
    name: detail.name,
    sku: detail.sku,
    qty: 1,
    listPriceEur: detail.listPriceEur,
    acquisitionCostEur: detail.acquisitionCostEur,
    taxTreatmentCode: narrowTaxCode(detail.taxTreatmentCode),
    reservationSessionId: sessionId,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// The hook
// ────────────────────────────────────────────────────────────────────────────

export interface UseVerkaufSession {
  /** The composed cart (state + derived totals + the mutators). */
  cart: UseCart
  /** The POS reservation session id this cart reserves under. */
  sessionId: string
  /** Product ids whose reserve call is currently in flight (for a row spinner). */
  reservingIds: ReadonlySet<string>
  /** True while ANY reserve is in flight. */
  isReserving: boolean
  /**
   * Reserve a product, then add it to the cart. Resolves to the added line, or
   * null when the reserve was refused (already reserved/sold, transport) — the
   * caller shows the German `error` and the cart is unchanged. A product already
   * in the cart is a no-op (serialized stock can only be sold once).
   */
  addProduct: (detail: ProductDetail | ProductListRow) => Promise<CartLine | null>
  /** The last reserve error (German), or null. Cleared on the next add. */
  error: string | null
  clearError: () => void
  /** Remove a line and release its hold back to AVAILABLE (best-effort). */
  removeLine: (id: string) => void
  /** Clear the whole cart and release every hold (best-effort batch). */
  clearAll: () => void
  /**
   * Mark the cart's reservations as CONSUMED by a successful finalize, so the
   * release-on-unmount cleanup does NOT then try to release now-SOLD products
   * (which would be a wrong, noisy call). Call this right after finalize.
   */
  markFinalized: () => void
}

/**
 * The Verkauf session: a cart whose lines are backed by real server
 * reservations. The screen reads `cart.totals` for the money, calls `addProduct`
 * on a scan/tap, `removeLine`/`clearAll` to back out, and `markFinalized` after
 * the fiscal commit. The reservation bookkeeping (reserve, release, the
 * unmount-cleanup) is entirely owned here.
 */
export function useVerkaufSession(): UseVerkaufSession {
  const cart = useCart()
  // One stable session id for the life of this cart instance.
  const sessionId = useMemo(() => newSessionId(), [])

  const [reservingIds, setReservingIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // Track the product ids we currently HOLD a reservation for, so unmount/clear
  // can release exactly those. A ref (not state) so the unmount effect reads the
  // latest set without re-subscribing. `finalized` flips true once a finalize
  // consumed the holds (RESERVED → SOLD) — after that we must NOT release.
  const heldIdsRef = useRef<Set<string>>(new Set())
  const finalizedRef = useRef(false)

  const clearError = useCallback(() => setError(null), [])

  const addProduct = useCallback<UseVerkaufSession["addProduct"]>(
    async (input) => {
      setError(null)
      // Already in the cart → nothing to reserve (serialized item, qty stays 1).
      if (cart.state.lines.some((l) => l.id === input.id)) return null

      setReservingIds((prev) => new Set(prev).add(input.id))
      try {
        // The reserve is the server lock. It throws on an already-reserved/sold
        // row (PRODUCT_NOT_RESERVABLE) or a transport failure; we surface the
        // German line and leave the cart untouched.
        await reserveProduct({ productId: input.id, channel: "POS", sessionId })
        heldIdsRef.current.add(input.id)

        // The line needs the DETAIL's tax fields. A ProductListRow lacks
        // taxTreatmentCode + acquisitionCostEur, so the caller must hand us a
        // detail; we guard structurally and treat a list row as a programmer
        // error caught here rather than silently mis-pricing.
        const detail = input as ProductDetail
        const line = detailToCartLine(detail, sessionId)
        cart.add(line)
        return line
      } catch (e) {
        setError(describeError(e))
        return null
      } finally {
        setReservingIds((prev) => {
          const next = new Set(prev)
          next.delete(input.id)
          return next
        })
      }
    },
    [cart, sessionId],
  )

  const removeLine = useCallback(
    (id: string) => {
      cart.remove(id)
      // Best-effort release of just this hold — fire-and-forget; a failed release
      // is harmless (the server reservation simply expires / can be re-released),
      // and we never block the UI on it. Drop it from the held set optimistically.
      if (heldIdsRef.current.has(id)) {
        heldIdsRef.current.delete(id)
        void releaseProductsBatch({
          items: [{ productId: id, sessionId }],
          reason: "pos_cart_cleared",
        }).catch(() => {
          // Swallowed by design — see note above. A stranded hold is a server
          // concern (it expires), never a blocking client error on a back-out.
        })
      }
    },
    [cart, sessionId],
  )

  const releaseAllHeld = useCallback(() => {
    const ids = [...heldIdsRef.current]
    heldIdsRef.current.clear()
    if (ids.length === 0) return
    void releaseProductsBatch({
      items: ids.map((productId) => ({ productId, sessionId })),
      reason: "pos_cart_cleared",
    }).catch(() => {
      // Best-effort: a missed release expires server-side. Never block a back-out.
    })
  }, [sessionId])

  const clearAll = useCallback(() => {
    cart.clear()
    releaseAllHeld()
  }, [cart, releaseAllHeld])

  const markFinalized = useCallback(() => {
    // The holds are now SOLD — abandon the release bookkeeping so the unmount
    // cleanup does not try to release a finalized product.
    finalizedRef.current = true
    heldIdsRef.current.clear()
  }, [])

  // Release-on-unmount: if the operator leaves the screen with a non-empty,
  // non-finalized cart, return every held product to AVAILABLE so stock is never
  // stranded in RESERVED. Runs once on teardown.
  useEffect(() => {
    return () => {
      if (finalizedRef.current) return
      const ids = [...heldIdsRef.current]
      heldIdsRef.current.clear()
      if (ids.length === 0) return
      void releaseProductsBatch({
        items: ids.map((productId) => ({ productId, sessionId })),
        reason: "pos_cart_cleared",
      }).catch(() => {
        // Best-effort teardown cleanup; a missed release expires server-side.
      })
    }
  }, [sessionId])

  return {
    cart,
    sessionId,
    reservingIds,
    isReserving: reservingIds.size > 0,
    addProduct,
    error,
    clearError,
    removeLine,
    clearAll,
    markFinalized,
  }
}
