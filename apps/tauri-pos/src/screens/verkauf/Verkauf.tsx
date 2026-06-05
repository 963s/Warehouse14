/**
 * Verkauf — Tier-1 surface #2. The revenue-generating heart of the POS.
 *
 * Three states driven by `useCurrentShift`:
 *   • loading              → Splash
 *   • shift === null       → <ShiftGuard/>   (no sale allowed; "Zur Kasse" CTA)
 *   • shift.status==='OPEN'→ <VerkaufFloor/> (CatalogGrid + CartPanel)
 *
 * ────────────────────────────────────────────────────────────────────────
 * Atomic reservation flow (memory.md #43 + Day 15 contract)
 * ────────────────────────────────────────────────────────────────────────
 *   1. Operator clicks (or scans) a tile.
 *   2. Generate `crypto.randomUUID()` reservation sessionId.
 *   3. POST /api/inventory/reserve { productId, channel: 'POS', sessionId }
 *        → 200: row locked to us; `reservation_expires_at IS NULL` for POS
 *          (migration 0006 CHECK) so the lock is OURS until we release.
 *        → 409 PRODUCT_NOT_RESERVABLE: another channel grabbed it →
 *          wax-red toast + invalidate `['products', 'list']`.
 *   4. GET /api/products/:id — pulls `acquisitionCostEur` (needed for §25a
 *      margin math) which the list endpoint omits.
 *   5. cart-store.addLine({ …snapshot…, reservationSessionId }).
 *      • If addLine returns MIXED_TAX_TREATMENT or ALREADY_IN_CART:
 *        surface the appropriate toast AND release the reservation we
 *        just took. We never leave a zombie hold.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Rapid barcode scanning (Phase 2 Day 7 hardening)
 * ────────────────────────────────────────────────────────────────────────
 * A real cashier with a USB barcode scanner can fire 5–10 reservations
 * per second. The previous "one in-flight at a time" guard dropped every
 * scan after the first. We now track `reservingProductIds` as a Set —
 * concurrent reserves of DIFFERENT products run in parallel (the backend
 * serialises per-product internally via the single-row UPDATE). The
 * Catalog tile is disabled only when ITSELF is in flight, not when ANY
 * reserve is in flight.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Release lifecycle (per-row + clear-all + sign-out + beforeunload)
 * ────────────────────────────────────────────────────────────────────────
 * Per-row × button → POST /api/inventory/release with the cart-line's
 * sessionId. "Karte leeren" parallel-releases every line via the shared
 * `releaseCart` helper. The AppShell sign-out cascade also calls
 * `releaseCart` BEFORE clearing the store (see AppShell.tsx). On graceful
 * Tauri window close we fire one last best-effort release via the
 * `beforeunload` handler — `sendBeacon` keeps it non-blocking.
 *
 * IMPORTANT: POS reservations have no server-side TTL. If the OS kills
 * the process abruptly (no beforeunload fires), the persisted cart will
 * survive on next launch and the operator can release manually OR
 * finalize against the same sessionIds.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type ProductDetail,
  type ProductListRow,
  productsApi,
} from '@warehouse14/api-client';
import { DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { classifyCartProductTax } from '../../lib/cart-math.js';
import { releaseCart } from '../../lib/release-cart.js';
import { type CartLine, selectCartLines, useCartStore } from '../../state/cart-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { ShiftGuard } from '../_shared/ShiftGuard.js';

import { CartPanel } from './CartPanel.js';
import { CatalogGrid } from './CatalogGrid.js';

export function Verkauf(): JSX.Element {
  const { data: shift, isLoading } = useCurrentShift();

  if (isLoading && shift === undefined) return <VerkaufSplash />;
  if (shift === null || shift === undefined) {
    return (
      <ShiftGuard
        digitLabel="2"
        surfaceTitle="Keine offene Schicht"
        lede="Bevor ein Beleg entstehen darf, muss eine Schicht eröffnet sein — die Schublade braucht ein Zuhause für den Kassensturz."
      />
    );
  }
  return <VerkaufFloor />;
}

// ────────────────────────────────────────────────────────────────────────
// Active floor — only mounted when a shift is open
// ────────────────────────────────────────────────────────────────────────

function VerkaufFloor(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();

  // Cart store — stable selectors so unrelated state changes don't re-render us.
  const lines = useCartStore(selectCartLines);
  const addLine = useCartStore((s) => s.addLine);
  const removeLine = useCartStore((s) => s.removeLine);
  const snapshotAndClear = useCartStore((s) => s.snapshotAndClear);
  const findLine = useCartStore((s) => s.findLine);
  const addToast = useToastStore((s) => s.addToast);

  // In-flight reservation tracking. Set (not single ID) so the rapid
  // barcode-scan path can fire concurrent reserves of different products.
  const [reservingProductIds, setReservingProductIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [releasingProductIds, setReleasingProductIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [clearingCart, setClearingCart] = useState<boolean>(false);
  // P2: bumped after a successful finalize closes the Bezahlen dialog →
  // CatalogGrid refocuses its search input so the next scan lands there.
  const [searchFocusToken, setSearchFocusToken] = useState<number>(0);

  // Derived: which productIds are currently in the cart. Memoized so
  // CatalogGrid's `inCart` prop is referentially stable as long as
  // `lines` hasn't changed → no unnecessary re-renders of the grid.
  const inCart = useMemo(() => new Set(lines.map((l) => l.productId)), [lines]);

  // ────────────────────────────────────────────────────────────────────
  // Reserve handler — fires on tile click / barcode scan
  // ────────────────────────────────────────────────────────────────────

  const onSelectProduct = useCallback(
    async (product: ProductListRow): Promise<void> => {
      // Belt-and-braces — CatalogGrid also disables tiles that are in cart
      // or already reserving themselves.
      if (findLine(product.id)) return;

      // Mark THIS productId as in-flight. Other products stay clickable.
      setReservingProductIds((prev) => {
        if (prev.has(product.id)) return prev;
        const next = new Set(prev);
        next.add(product.id);
        return next;
      });

      const sessionId = crypto.randomUUID();
      try {
        await productsApi.reserve(api, {
          productId: product.id,
          channel: 'POS',
          sessionId,
        });

        let detail: ProductDetail;
        try {
          detail = await productsApi.get(api, product.id);
        } catch (err) {
          // Reservation succeeded but detail fetch failed — release the
          // hold so the row isn't stuck reserved on a network glitch.
          await safeRelease(api, product.id, sessionId);
          throw err;
        }

        const treatment = classifyCartProductTax({
          itemType: detail.itemType,
          finenessDecimal: detail.finenessDecimal,
          acquiredFromCustomerId: detail.acquiredFromCustomerId,
          isCommission: detail.isCommission,
          yearMintedFrom: detail.yearMintedFrom,
        });

        const newLine: CartLine = {
          productId: detail.id,
          reservationSessionId: sessionId,
          sku: detail.sku,
          name: detail.name,
          listPriceEur: detail.listPriceEur,
          acquisitionCostEur: detail.acquisitionCostEur,
          taxTreatmentCode: treatment,
          addedAt: new Date().toISOString(),
        };

        const addResult = addLine(newLine);
        if (addResult === null) {
          // Success — invalidate the catalog list so the just-reserved
          // tile drops out (it's now RESERVED, not AVAILABLE).
          await qc.invalidateQueries({ queryKey: ['products', 'list'] });
          return;
        }

        // Cart-store rejected — release the hold + toast.
        await safeRelease(api, product.id, sessionId);
        addToast({
          tone: 'info',
          title: 'Bereits in der Karte',
          // Unique inventory — one product = one physical piece (no quantity to
          // raise). Tell the operator it is already reserved + where to find it.
          body: `${detail.sku} — Einzelstück, bereits reserviert (rechts in der Karte).`,
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PRODUCT_NOT_RESERVABLE') {
          addToast({
            tone: 'alert',
            title: 'Bereits anderswo reserviert',
            body: `${product.sku} — der Storefront oder eBay-Kanal hat zuerst zugegriffen.`,
          });
          await qc.invalidateQueries({ queryKey: ['products', 'list'] });
        } else if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
          // Operator cancelled the step-up modal — silent.
        } else if (err instanceof ApiError) {
          addToast({
            tone: 'alert',
            title: 'Reservierung fehlgeschlagen',
            body: err.message,
          });
        } else {
          addToast({
            tone: 'alert',
            title: 'Verbindung gestört',
            body: 'Reservierung konnte nicht gesetzt werden.',
          });
        }
      } finally {
        setReservingProductIds((prev) => {
          if (!prev.has(product.id)) return prev;
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
      }
    },
    [addLine, addToast, api, findLine, qc],
  );

  // ────────────────────────────────────────────────────────────────────
  // Release handlers
  // ────────────────────────────────────────────────────────────────────

  const onRemoveLine = useCallback(
    async (productId: string): Promise<void> => {
      const target = findLine(productId);
      if (!target) return;

      setReleasingProductIds((prev) => {
        if (prev.has(productId)) return prev;
        const next = new Set(prev);
        next.add(productId);
        return next;
      });

      // Optimistic store removal — the row vanishes from the UI immediately.
      removeLine(productId);

      try {
        await productsApi.release(api, {
          productId,
          sessionId: target.reservationSessionId,
          reason: 'pos_cart_cleared',
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
          // Silent cancel.
        } else {
          // Optimistic removal stays. POS reservations have no TTL so the
          // sweeper won't help — surface the issue to the operator.
          addToast({
            tone: 'alert',
            title: 'Freigabe blockiert',
            body: `Server-Freigabe für ${target.sku} fehlgeschlagen. Bitte erneut leeren.`,
          });
        }
      } finally {
        setReleasingProductIds((prev) => {
          if (!prev.has(productId)) return prev;
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
        await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      }
    },
    [addToast, api, findLine, qc, removeLine],
  );

  const onClearCart = useCallback(async (): Promise<void> => {
    if (lines.length === 0 || clearingCart) return;
    setClearingCart(true);
    // snapshotAndClear is ONE atomic Zustand mutation — the operator can't
    // race a new addLine into the gap between snapshot and release fire.
    const snapshot = snapshotAndClear();
    try {
      await releaseCart({ api, lines: snapshot, reason: 'pos_cart_cleared' });
    } finally {
      setClearingCart(false);
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    }
  }, [api, clearingCart, lines.length, qc, snapshotAndClear]);

  // ────────────────────────────────────────────────────────────────────
  // Graceful window-close release (best-effort)
  // ────────────────────────────────────────────────────────────────────
  // POS reservations don't expire server-side, so a closed Tauri window
  // would leak. We attempt a sync release on `beforeunload`. The browser
  // gives us ~1 s of synchronous work before tearing the page down; that
  // is enough for a fetch with `keepalive: true` to flush each release.
  // If the OS kills the process (SIGKILL, power loss) this WON'T fire —
  // the persisted cart survives, and the next launch lets the operator
  // resume + finalize OR explicitly release.

  useEffect(() => {
    const onBeforeUnload = (): void => {
      const snapshot = useCartStore.getState().lines;
      if (snapshot.length === 0) return;
      for (const line of snapshot) {
        try {
          // Tauri webview + Chromium honour `keepalive: true` on synchronous
          // fetch from beforeunload. We send via the same api client so the
          // session cookie + interceptor wrapper apply normally.
          void productsApi
            .release(api, {
              productId: line.productId,
              sessionId: line.reservationSessionId,
              reason: 'pos_cart_cleared',
            })
            .catch(() => undefined);
        } catch {
          /* Swallow — best-effort. */
        }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [api]);

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.6fr) minmax(360px, 1fr)',
        height: '100%',
        minHeight: 0,
        flex: 1,
      }}
    >
      <CatalogGrid
        reservingProductIds={reservingProductIds}
        inCart={inCart}
        onSelect={(p) => void onSelectProduct(p)}
        focusToken={searchFocusToken}
      />
      <CartPanel
        lines={lines}
        onRemoveLine={(id) => void onRemoveLine(id)}
        releasingProductIds={releasingProductIds}
        onClearCart={() => void onClearCart()}
        clearingCart={clearingCart}
        onAfterFinalize={() => {
          // Fires only on a genuine finalize-success → dialog close. Refocus the
          // catalog search so the next scan starts the next sale immediately.
          setSearchFocusToken((t) => t + 1);
          addToast({ tone: 'info', title: 'Neue Karte bereit', body: 'weiter mit Scan' });
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function safeRelease(
  api: ReturnType<typeof useApiClient>,
  productId: string,
  sessionId: string,
): Promise<void> {
  try {
    await productsApi.release(api, {
      productId,
      sessionId,
      reason: 'pos_cart_cleared',
    });
  } catch {
    // Swallow — the caller already toasted the operator about the
    // higher-level failure; this release is just defensive cleanup.
  }
}

function VerkaufSplash(): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32 }}>
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <Seal size="md" tone="faded" label="2" />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: '14px 0 4px',
            fontSize: '1.4rem',
          }}
        >
          Verkauf wird vorbereitet…
        </h2>
        <DiamondRule />
      </ParchmentCard>
    </div>
  );
}
