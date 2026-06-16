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
 * Tauri window close we fire ONE `navigator.sendBeacon` to the batch-release
 * route via `beaconReleaseCart` — a beacon survives page teardown (a normal
 * fetch is cancelled).
 *
 * IMPORTANT: POS reservations have no explicit server-side TTL. If the OS kills
 * the process abruptly (no beforeunload fires), the persisted cart survives on
 * next launch (operator can release/finalize against the same sessionIds), and
 * the worker job `pos_reservation_sweeper` reclaims a hold abandoned past a
 * conservative window (12h) as the durable backstop (P1.4).
 */

import { useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  type ProductDetail,
  type ProductListRow,
  productsApi,
} from '@warehouse14/api-client';
import { DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { classifyCartProductTax } from '../../lib/cart-math.js';
import { beaconReleaseCart, releaseCart } from '../../lib/release-cart.js';
import { classifyScanMatch, normalizeScan } from '../../lib/scan-resolve.js';
import { getSessionToken } from '../../lib/session-token.js';
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
  // Cashier 3/3: pause the global barcode scanner while the Bezahlen dialog
  // owns Enter + the AmountPad (CartPanel notifies us via onBezahlenOpenChange).
  const [bezahlenOpen, setBezahlenOpen] = useState<boolean>(false);
  // Bumped after every handled scan → CatalogGrid clears the leaked SKU text.
  const [searchResetToken, setSearchResetToken] = useState<number>(0);
  // Guard the scan→reserve window: a SKU mid-lookup (before onSelectProduct has
  // marked it reserving) must not be resolved twice by a rapid double-scan.
  const scanResolvingRef = useRef<Set<string>>(new Set());

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
  // Barcode scan → cart (cashier 3/3)
  // ────────────────────────────────────────────────────────────────────
  // The printed label carries a Code128 of the SKU; the USB scanner emits that
  // SKU. We look it up (ILIKE on `q`, then pick the exact SKU/barcode row),
  // classify the status, and either run the SAME reserve→add path as a tile
  // click or give precise feedback. A per-SKU in-flight guard stops a rapid
  // double-scan from firing two reserves before onSelectProduct can mark it.

  const onScan = useCallback(
    async (raw: string): Promise<void> => {
      const code = normalizeScan(raw);
      if (code.length < 3) return; // ignore stray/short bursts

      // The scanner's keystrokes leaked into the catalog search — clear them so
      // the grid doesn't strand on the (soon-reserved) SKU.
      setSearchResetToken((t) => t + 1);

      let rows: ProductListRow[];
      try {
        const res = await productsApi.list(api, { q: code, limit: 10 });
        rows = res.items;
      } catch {
        addToast({
          tone: 'alert',
          title: 'Scan-Suche fehlgeschlagen',
          body: `Artikel ${code} konnte nicht geladen werden.`,
        });
        return;
      }

      const match = classifyScanMatch(code, rows);
      switch (match.kind) {
        case 'not-found':
          addToast({
            tone: 'alert',
            title: 'Kein Treffer',
            body: `Kein Artikel mit Code ${code} gefunden.`,
          });
          return;
        case 'sold':
          addToast({
            tone: 'alert',
            title: 'Bereits verkauft',
            body: `${match.product.sku} ist bereits verkauft — nicht mehr im Bestand.`,
          });
          return;
        case 'reserved':
          addToast({
            tone: 'alert',
            title: 'Bereits reserviert',
            body: `${match.product.sku} ist anderswo reserviert (Storefront/eBay).`,
          });
          return;
        case 'draft':
          addToast({
            tone: 'info',
            title: 'Noch nicht verkaufsbereit',
            body: `${match.product.sku} ist ein Entwurf — erst in Lager veröffentlichen.`,
          });
          return;
        case 'found':
          break;
      }

      const product = match.product;
      // Double-add / race guard: already in the cart, or a reserve for this SKU
      // is already in flight from a prior scan.
      if (findLine(product.id) || scanResolvingRef.current.has(product.id)) {
        addToast({
          tone: 'info',
          title: 'Schon in der Karte',
          body: `${product.sku} — Einzelstück, bereits im Korb.`,
        });
        return;
      }
      scanResolvingRef.current.add(product.id);
      try {
        await onSelectProduct(product);
      } finally {
        scanResolvingRef.current.delete(product.id);
      }
    },
    [addToast, api, findLine, onSelectProduct],
  );

  // Listen globally while a shift is open; pause during payment so the dialog
  // keeps Enter + the AmountPad for itself.
  useBarcodeScanner({ enabled: !bezahlenOpen, onScan: (c) => void onScan(c) });

  // Phase B — a scan from a paired phone (companion Warehouse/Cashier socket)
  // arrives as a Tauri event and rings up through the SAME resolution as a local
  // scan. Fail-safe: in a plain browser (no Tauri) `listen` rejects → no-op.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    listen<{ deviceId: string; code: string }>('companion://scan-result', (e) => {
      const code = e.payload?.code;
      if (code && !bezahlenOpen) void onScan(code);
    })
      .then((u) => {
        if (active) unlisten = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [onScan, bezahlenOpen]);

  // ────────────────────────────────────────────────────────────────────
  // Release handlers
  // ────────────────────────────────────────────────────────────────────

  // Undo affordance (design-brief §1 "undo over confirm"): re-acquire a line the
  // operator just removed. The remove already released the server reservation,
  // so undo re-runs the SAME reserve→add path as a tile click — a fresh
  // sessionId, no special-cased re-attach logic. Reuses `onSelectProduct` by
  // reconstructing the minimal ProductListRow it needs from the cart snapshot.
  const onUndoRemove = useCallback(
    (line: CartLine): void => {
      if (findLine(line.productId)) return; // already back (double-tap guard)
      void onSelectProduct({
        id: line.productId,
        sku: line.sku,
        name: line.name,
        listPriceEur: line.listPriceEur,
      } as ProductListRow);
    },
    [findLine, onSelectProduct],
  );

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
          // Operator cancelled the PIN — the reservation is untouched on the
          // server, so the line must come BACK or it leaks (POS holds have no
          // TTL). Roll the optimistic removal back silently.
          addLine(target);
        } else {
          // Release failed AND the line is gone from the cart, but the server
          // reservation lingers (no TTL ⇒ a zombie hold that blocks re-sale).
          // Roll the optimistic removal back so the operator can retry the
          // release; surface the reason.
          addLine(target);
          addToast({
            tone: 'alert',
            title: 'Freigabe fehlgeschlagen',
            body: `Server-Freigabe für ${target.sku} fehlgeschlagen — Position wiederhergestellt. Bitte erneut entfernen.`,
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
    [addToast, addLine, api, findLine, qc, removeLine],
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
  // Graceful window-close release (P1.4)
  // ────────────────────────────────────────────────────────────────────
  // POS reservations are TTL-less server-side, so a closed Tauri window would
  // leak the holds. We fire ONE `navigator.sendBeacon` to the batch-release
  // route — the browser flushes a beacon even as the page unloads (a normal
  // fetch is CANCELLED on teardown, which is what the old per-line loop did
  // despite its keepalive claim). The beacon can't set an Authorization header,
  // so the session token rides in the body; the auth plugin honours it for that
  // route only. `fetch(..., { keepalive: true })` is the fallback.
  //
  // If the OS kills the process (SIGKILL / power loss) the beacon never fires —
  // the server-side `pos_reservation_sweeper` reclaims the abandoned hold, and
  // the persisted cart lets the operator resume + finalize OR release on relaunch.

  useEffect(() => {
    const onBeforeUnload = (): void => {
      const snapshot = useCartStore.getState().lines;
      if (snapshot.length === 0) return;
      beaconReleaseCart({
        baseUrl: api.baseUrl,
        lines: snapshot,
        reason: 'pos_cart_cleared',
        sessionToken: getSessionToken(),
      });
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
        searchResetToken={searchResetToken}
      />
      <CartPanel
        lines={lines}
        onRemoveLine={(id) => void onRemoveLine(id)}
        onUndoRemove={onUndoRemove}
        releasingProductIds={releasingProductIds}
        onClearCart={() => void onClearCart()}
        clearingCart={clearingCart}
        onBezahlenOpenChange={setBezahlenOpen}
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
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-7)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <Seal size="md" tone="faded" label="2" />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: '1.4rem',
          }}
        >
          Verkauf wird vorbereitet…
        </h2>
        <DiamondRule />
        <p
          style={{
            margin: 'var(--space-3) 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.92rem',
          }}
        >
          Schicht und Katalog werden geladen.
        </p>
      </ParchmentCard>
    </div>
  );
}
