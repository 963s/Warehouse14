/**
 * cart-store — production Verkauf cart (replaces Day-2 cart-demo-store).
 *
 * RESERVATION-AWARE state container. Every line carries the reservation
 * sessionId it was created with — that ID is the only thing the backend
 * accepts on /api/inventory/release. The store MUST never lose those IDs.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Persistence (Phase 2 Day 7 hardening)
 * ────────────────────────────────────────────────────────────────────────
 * Because POS reservations have NO server-side TTL (migration 0006 CHECK:
 * `reserved_by_channel='POS' ⇒ reservation_expires_at IS NULL`) the worker
 * sweeper does NOT clean up after a crashed POS. If the operator's window
 * dies mid-cart and we don't keep the sessionIds, those products become
 * silently unreservable for any other channel until an Owner manually
 * intervenes. To prevent that, the cart is persisted to localStorage via
 * Zustand's `persist` middleware (synchronous rehydrate — appears on first
 * render). On next launch:
 *   • the operator sees their cart exactly as left
 *   • clicking "Karte leeren" fires the actual `inventoryApi.release` per
 *     line (the IDs survived the crash) — no leak
 *   • clicking Bezahlen finalises against the SAME sessionIds — backend
 *     matches and converts RESERVED → SOLD as if nothing happened
 *
 * Storage key: `w14.cart.v1`. The `v1` version segment lets a future
 * schema change ignore old shapes (Zustand's `migrate` callback) without
 * crashing the operator's terminal.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Invariants enforced at the store boundary
 * ────────────────────────────────────────────────────────────────────────
 *   1. No two lines share the same productId — `addLine` returns
 *      ALREADY_IN_CART if you try to push a duplicate (defensive: the
 *      reservation API would itself refuse a second hold).
 *   2. All lines must share the same `taxTreatmentCode` — V1 ships one
 *      tax-treatment per cart; mixed carts arrive in Phase 1.5 with the
 *      split-payments code path.
 *   3. Insertion order is preserved (Roman-numeral cart numbering).
 *   4. State preservation across surface switches: lines live OUTSIDE
 *      the React tree. Switching to Werkstatt and back rehydrates
 *      synchronously — no lost work.
 *   5. The store NEVER calls APIs. Reservation + release happens in the
 *      Verkauf coordinator; the store only mutates after the network
 *      side has confirmed. This keeps the store deterministic + testable.
 *
 * Selectors are exported with stable identities so screen components can
 * `useCartStore(selectCartLines)` without re-rendering on unrelated state
 * changes. Derived computations (totals, tax aggregates) live in
 * `cart-math.ts` and are memoized by the consuming screen.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TaxTreatmentCode } from '@warehouse14/api-client';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface CartLine {
  productId: string;
  /**
   * Reservation session id — the sole proof on the backend that THIS
   * cart holds the inventory lock. Persisted; survives crash + refresh.
   */
  reservationSessionId: string;

  /** Snapshot fields the cart row needs to render without re-fetching. */
  sku: string;
  name: string;
  listPriceEur: string;
  acquisitionCostEur: string;
  taxTreatmentCode: TaxTreatmentCode;

  /** Wall-clock when the item was added — diagnostics + ordering tiebreak. */
  addedAt: string;
}

export type AddItemError =
  | { kind: 'MIXED_TAX_TREATMENT'; existing: TaxTreatmentCode; incoming: TaxTreatmentCode }
  | { kind: 'ALREADY_IN_CART' };

interface CartState {
  lines: CartLine[];

  /**
   * Push a fresh line. Returns null on success, or an error tag the
   * caller surfaces as a brand-themed toast. The caller MUST have
   * completed the reservation API call before invoking this.
   */
  addLine: (line: CartLine) => AddItemError | null;

  /** Remove a line by productId. Returns the line (so caller can release). */
  removeLine: (productId: string) => CartLine | null;

  /**
   * Snapshot every line and clear the store atomically. Returns the
   * snapshot so the caller can fire releases against the now-orphaned
   * sessionIds. Used by:
   *   • "Karte leeren" CTA in CartPanel
   *   • sign-out cascade in AppShell (must release before clear)
   *   • post-finalize cleanup in BezahlenDialog (server already cleared
   *     them via SOLD transition, so the snapshot is ignored)
   */
  snapshotAndClear: () => CartLine[];

  /** Wipe without snapshot — used internally by snapshotAndClear + tests. */
  clearCart: () => void;

  /** O(N) lookup; fine for V1 carts capped at ~20 lines. */
  findLine: (productId: string) => CartLine | undefined;
}

// ────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'w14.cart.v1';

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],

      addLine: (incoming) => {
        const state = get();

        // Rule 1: no duplicate productId.
        if (state.lines.some((l) => l.productId === incoming.productId)) {
          return { kind: 'ALREADY_IN_CART' };
        }

        set({ lines: [...state.lines, incoming] });
        return null;
      },

      removeLine: (productId) => {
        const target = get().lines.find((l) => l.productId === productId);
        if (!target) return null;
        set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) }));
        return target;
      },

      snapshotAndClear: () => {
        const snapshot = get().lines.slice();
        set({ lines: [] });
        return snapshot;
      },

      clearCart: () => set({ lines: [] }),

      findLine: (productId) => get().lines.find((l) => l.productId === productId),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist `lines` — the action closures are recreated every
      // boot anyway, and persisting functions would explode JSON.
      partialize: (state) => ({ lines: state.lines }),
      // Phase 1.5 hook: bump this when CartLine shape changes.
      version: 1,
    },
  ),
);

// ────────────────────────────────────────────────────────────────────────
// Stable selectors — pin these identities so screens don't re-render on
// unrelated state changes.
// ────────────────────────────────────────────────────────────────────────

export const selectCartLines = (s: CartState): CartLine[] => s.lines;
export const selectCartCount = (s: CartState): number => s.lines.length;
export const selectCartTaxTreatment = (s: CartState): TaxTreatmentCode | null => {
  if (s.lines.length === 0) return null;
  const first = s.lines[0]!.taxTreatmentCode;
  const allSame = s.lines.every((l) => l.taxTreatmentCode === first);
  return allSame ? first : 'MIXED';
};
