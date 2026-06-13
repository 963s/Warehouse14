/**
 * companion-bridge — feed the mother's embedded companion LAN hub.
 *
 * The mother POS runs a small embedded server (see
 * `apps/tauri-pos/src-tauri/src/commands/companion.rs` and
 * `docs/companion-architecture.md`). Companions ride on the mother's
 * authenticated cloud session and mirror its live cart. This module is the
 * React-side bridge that pushes two things into the hub:
 *
 *   1. the mother's **Bearer token** (so the hub can proxy cloud calls with the
 *      mother's session) — `companion_set_auth`;
 *   2. the **live cart** (so a Customer-Display companion reflects what the
 *      cashier is ringing up) — `companion_publish_cart`.
 *
 * Both are STRICTLY best-effort: outside Tauri (dev browser) the `invoke`
 * import throws / the command is missing, and the hub may simply not be
 * running. Every call here swallows failures — the mother must NEVER break
 * because a companion bridge feed failed.
 */

import { invoke } from '@tauri-apps/api/core';

import { type CartLine, selectCartLines, useCartStore } from '../state/cart-store.js';
import { computeLineMath, fromCents } from './cart-math.js';
import { getSessionToken } from './session-token.js';

// ────────────────────────────────────────────────────────────────────────
// 1. Auth token push
// ────────────────────────────────────────────────────────────────────────

/**
 * Push the current session Bearer into the companion hub. Safe to call after
 * login and on app mount when already authenticated. No-ops (silently) when
 * there is no token, outside Tauri, or when the hub isn't running.
 */
export async function pushCompanionAuth(): Promise<void> {
  const bearer = getSessionToken();
  if (!bearer) return;
  try {
    await invoke('companion_set_auth', { bearer });
  } catch {
    /* not in Tauri, command missing, or hub down — best-effort only */
  }
}

/**
 * Clear the Bearer the hub holds. MUST run on sign-out: otherwise the hub keeps
 * proxying a now-invalid mother token to the cloud, every companion call 401s,
 * and the phones loop on "Sitzung abgelaufen" / forced re-pair even though the
 * fix is a fresh MOTHER login. Best-effort, same swallow-everything contract.
 */
export async function clearCompanionAuth(): Promise<void> {
  try {
    await invoke('companion_set_auth', { bearer: '' });
  } catch {
    /* not in Tauri, command missing, or hub down — best-effort only */
  }
}

// ────────────────────────────────────────────────────────────────────────
// 2. Live cart publish
// ────────────────────────────────────────────────────────────────────────

interface PublishedCartItem {
  name: string;
  /** Quantity or weight for the row. Cart lines are one product each → "1". */
  qtyOrWeight: string;
  /** Line total as a Decimal string ("12.50"). */
  lineTotalEur: string;
}

interface PublishedCart {
  items: PublishedCartItem[];
  /** Grand total as a Decimal string. */
  totalEur: string;
}

/** Map the real cart-store lines to the minimal published shape (money stays Decimal strings). */
function toPublishedCart(lines: readonly CartLine[]): PublishedCart {
  let totalCents = 0n;
  const items: PublishedCartItem[] = lines.map((line) => {
    const math = computeLineMath({
      taxTreatmentCode: line.taxTreatmentCode,
      listPriceEur: line.listPriceEur,
      acquisitionCostEur: line.acquisitionCostEur,
      discountEur: line.discountEur,
    });
    totalCents += math.lineTotalCents;
    return {
      name: line.name,
      qtyOrWeight: '1',
      lineTotalEur: fromCents(math.lineTotalCents),
    };
  });
  return { items, totalEur: fromCents(totalCents) };
}

/** Best-effort publish of one cart snapshot to the hub. */
function publishCart(lines: readonly CartLine[]): void {
  let cartJson: string;
  try {
    cartJson = JSON.stringify(toPublishedCart(lines));
  } catch {
    // A malformed money string would throw in toCents — never let that bubble.
    return;
  }
  void invoke('companion_publish_cart', { cartJson }).catch(() => {
    /* not in Tauri, command missing, or hub down — best-effort only */
  });
}

/**
 * Subscribe ONCE to the cart store and publish every change to the companion
 * hub, debounced ~150ms so a burst of edits collapses into a single feed.
 * Returns an unsubscribe so a caller (e.g. a hook) can tear it down.
 *
 * Idempotent at the module level: repeated mounts share one subscription.
 */
let cartBridgeStarted = false;

export function startCompanionCartBridge(): () => void {
  if (cartBridgeStarted) return () => undefined;
  cartBridgeStarted = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (lines: readonly CartLine[]): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      publishCart(lines);
    }, 150);
  };

  // Publish the initial snapshot, then on every cart-lines change.
  const unsub = useCartStore.subscribe((state) => schedule(selectCartLines(state)));
  schedule(selectCartLines(useCartStore.getState()));

  return () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    unsub();
    cartBridgeStarted = false;
  };
}
