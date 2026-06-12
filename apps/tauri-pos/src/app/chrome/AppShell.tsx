/**
 * AppShell — the authenticated layout wrapper.
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ AppShellHeader (Karteikasten + magnifier + ⏻)       │
 *   ├────────────────────────────────────────────────────┤
 *   │ SubBreadcrumb (only on Tier-2 surfaces)             │
 *   ├────────────────────────────────────────────────────┤
 *   │                                                    │
 *   │   <ErrorBoundary><Outlet/></ErrorBoundary>          │
 *   │                                                    │
 *   └────────────────────────────────────────────────────┘
 *   + Spotlight modal       (Cmd+K)
 *   + StepUpModal           (interceptor-driven, memory.md #76 ⑦)
 *   + ToastContainer        (alerts + success + info, top-right portal)
 *
 * Owns:
 *   • the global Cmd+K binding (opens Spotlight)
 *   • the recents-store push on every route change
 *   • the Cmd+Shift+D dark-mode toggle (mirrors html[data-theme])
 *   • the sign-out cascade (session + ledger + recents + cart + toasts)
 *   • the alert-toast subscription (SSE → toast queue)
 *
 * Does NOT own SSE — that lives inside <Werkstatt /> so it tears down
 * on sign-out via React's natural unmount.
 */

import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { authPin } from '@warehouse14/api-client';
import { ErrorBoundary, ToastContainer } from '@warehouse14/ui-kit';

import { UpdateBanner } from '../../components/UpdateBanner.js';
import { useAlertSubscription } from '../../hooks/useAlertSubscription.js';
import { useApiClient } from '../../lib/api-context.js';
import { releaseCart } from '../../lib/release-cart.js';
import { clearSessionToken } from '../../lib/session-token.js';
import { useAnkaufCartStore } from '../../state/ankauf-cart-store.js';
import { useBewertungStore } from '../../state/bewertung-store.js';
import { useCartStore } from '../../state/cart-store.js';
import { useLedgerFeed } from '../../state/ledger-feed-store.js';
import { useRecents } from '../../state/recents-store.js';
import { useSessionStore } from '../../state/session-store.js';
import { registerSignOut } from '../../lib/session-actions.js';
import { useTheme } from '../../state/theme-store.js';
import { useToastStore } from '../../state/toast-store.js';

/**
 * Per-operator localStorage keys (§19.2 C-2 fix).
 *
 * These keys are all hydrated from `localStorage` at first render and
 * persist OUTSIDE the React lifecycle. If a sign-out doesn't wipe them,
 * the next cashier inherits cart lines, customer ids, intake items, and
 * the TSE offline queue — which then combines with §19.2 C-1 to enable
 * cross-cashier finalize.
 *
 * `handleSignOut` calls each store's `reset` for in-memory state AND
 * removes the localStorage key explicitly so a crash-without-signout
 * recovery (next boot) starts clean.
 */
const PER_OPERATOR_STORAGE_KEYS = [
  'w14.cart.v1', // Verkauf cart (with reservationSessionIds)
  'w14.ankauf.v1', // Ankauf intake cart (customer context + items)
  'w14.bewertung.v1', // Appraisal selection (customer id + appraisal id)
  'warehouse14.tse-queue.v1', // pending TSE signatures queued offline
] as const;

import { AppShellHeader } from './AppShellHeader.js';
import { MetalTicker } from './MetalTicker.js';
import { Spotlight } from './Spotlight.js';
import { StepUpModal } from './StepUpModal.js';
import { SubBreadcrumb } from './SubBreadcrumb.js';
import { isAnyDialogOpen, isTextEntryElement, resolveDigitNavPath } from './digit-nav.js';
import { PRIMARY_SURFACES, SECONDARY_SURFACES, findSurfaceByPath } from './surface-registry.js';

export function AppShell(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const api = useApiClient();

  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);
  const clearLedger = useLedgerFeed((s) => s.clear);
  const clearRecents = useRecents((s) => s.clear);
  const snapshotAndClearCart = useCartStore((s) => s.snapshotAndClear);
  const ankaufSnapshotAndReset = useAnkaufCartStore((s) => s.snapshotAndReset);
  const bewertungReset = useBewertungStore((s) => s.reset);
  const pushRecent = useRecents((s) => s.push);

  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);

  const toasts = useToastStore((s) => s.toasts);
  const toastPaths = useToastStore((s) => s.paths);
  const dismissToast = useToastStore((s) => s.dismiss);
  const clearToasts = useToastStore((s) => s.clear);

  const [spotlightOpen, setSpotlightOpen] = useState(false);

  // Subscribe SSE alerts → toast queue (memory.md #76 ⑦).
  useAlertSubscription();

  // Reflect the theme onto <html data-theme>.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Track surface visits for the Spotlight "Zuletzt" group.
  useEffect(() => {
    const s = findSurfaceByPath(location.pathname);
    if (s) pushRecent(s.path);
  }, [location.pathname, pushRecent]);

  // Global key bindings — Cmd+K opens Spotlight; Cmd+Shift+D toggles theme;
  // bare 1–8 jump to the primary surfaces the rail labels (UX P0).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      const isMod = ev.metaKey || ev.ctrlKey;
      if (isMod && !ev.shiftKey && (ev.key === 'k' || ev.key === 'K')) {
        ev.preventDefault();
        setSpotlightOpen((open) => !open);
        return;
      }
      if (isMod && ev.shiftKey && (ev.key === 'd' || ev.key === 'D')) {
        ev.preventDefault();
        toggleTheme();
        return;
      }
      // Number-key surface navigation. The guards (modifier held, a text field
      // focused, or any modal/Spotlight open) live in the pure resolver so
      // typing "3" into a price field or inside a dialog never navigates.
      const digitPath = resolveDigitNavPath(
        {
          key: ev.key,
          hasModifier: ev.metaKey || ev.ctrlKey || ev.altKey,
          isTextEntry: isTextEntryElement(document.activeElement),
          isDialogOpen: isAnyDialogOpen(),
        },
        PRIMARY_SURFACES,
      );
      if (digitPath) {
        ev.preventDefault();
        navigate(digitPath);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTheme, navigate]);

  const handleSignOut = useCallback(async () => {
    // §19.2 C-2 + C-3 fix — the full sign-out cascade.
    //
    // Order is deliberate:
    //   1. Snapshot Verkauf cart, release server-side reservations.
    //   2. Snapshot Ankauf cart (intake items; no server reservation —
    //      Ankauf doesn't reserve inventory, only collects rows to insert).
    //   3. Reset Bewertung context (customer id + appraisal id — pure PII).
    //   4. Sign out on the server (best-effort).
    //   5. Wipe Zustand stores (in-memory).
    //   6. NUKE every per-operator localStorage key so a crash-relaunch
    //      doesn't rehydrate stale state under the next cashier.
    //
    // Reservation hygiene FIRST because POS reservations have no
    // server-side TTL (migration 0006 CHECK). If we don't release them
    // here, the inventory stays locked until the §19.2 C-1 ownership
    // guard refuses the next operator's finalize attempt.

    const cartSnapshot = snapshotAndClearCart();
    await releaseCart({ api, lines: cartSnapshot, reason: 'pos_cart_cleared' });

    // Ankauf snapshot is read but unused — there is no inventory to
    // release (intake items are not yet products). The snapshot exists
    // so a future Phase 1.5 task can salvage half-typed intake into a
    // draft, but for now we just discard it.
    void ankaufSnapshotAndReset();

    // Bewertung holds the operator's last selected appraisal + customer.
    // Resetting clears the in-memory store; the localStorage purge
    // below removes the persisted shadow.
    bewertungReset();

    try {
      await authPin.signOut(api);
    } catch {
      /* network failure should NOT block local sign-out */
    }
    clearSessionToken();
    setUnauthenticated();
    clearLedger();
    clearRecents();
    clearToasts();

    // Belt-and-braces: even if a store's `reset()` left its persisted
    // payload behind (race against Zustand's debounced write), we
    // remove the keys ourselves. Safe to call without a Tauri webview —
    // tests/jsdom have window.localStorage as a no-op shim.
    if (typeof window !== 'undefined' && window.localStorage) {
      for (const key of PER_OPERATOR_STORAGE_KEYS) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* QuotaExceeded or storage disabled — nothing else we can do */
        }
      }
    }
  }, [
    ankaufSnapshotAndReset,
    api,
    bewertungReset,
    clearLedger,
    clearRecents,
    clearToasts,
    setUnauthenticated,
    snapshotAndClearCart,
  ]);

  // Expose sign-out to routed surfaces (Einstellungen → "Abmelden"); the lock
  // icon was removed from the header.
  useEffect(() => registerSignOut(() => void handleSignOut()), [handleSignOut]);

  // Tier-2 surfaces render the SubBreadcrumb (memory.md §11.5).
  const secondarySurface = SECONDARY_SURFACES.find((s) => location.pathname.startsWith(s.path));

  // Toast click → navigate to the stored path.
  const onToastActivate = useCallback(
    (id: string) => {
      const path = toastPaths.get(id);
      if (path) navigate(path);
      dismissToast(id);
    },
    [toastPaths, navigate, dismissToast],
  );

  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--w14-parchment)',
      }}
    >
      <AppShellHeader
        onOpenSpotlight={() => setSpotlightOpen(true)}
        onSignOut={() => {
          void handleSignOut();
        }}
      />

      {secondarySurface && <SubBreadcrumb label={secondarySurface.label} />}

      {/* Always-visible metal-price ticker (UX P2) — below header, above the
          routed surface, on every screen. Replaces the Kurse primary tab. */}
      <MetalTicker />

      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Per-route error boundary: a crash in one surface must not take
            down the Karteikasten + Spotlight. The boundary remounts via
            its `Erneut versuchen` button or by switching surfaces. */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Overlays — order matters: Spotlight under StepUpModal under Toasts */}
      <Spotlight open={spotlightOpen} onClose={() => setSpotlightOpen(false)} />
      <StepUpModal />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} onActivate={onToastActivate} />
      {/* Auto-update banner (Day-15 release automation). Polls the
          configured GitHub Releases endpoint hourly; renders only when
          an update is available. Safe inside Tauri only. */}
      <UpdateBanner />
    </div>
  );
}
