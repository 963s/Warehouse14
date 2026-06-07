/**
 * useCompanionBridge — wire the mother app into the companion LAN hub.
 *
 * Mounted once (from `App.tsx`) while the operator is authenticated. It:
 *   • pushes the current session Bearer into the hub on mount (covers the
 *     "already authenticated on cold start" path — login pushes its own), and
 *   • starts the debounced live-cart feed so a Customer-Display companion
 *     mirrors what the cashier is ringing up.
 *
 * Everything it calls is best-effort (see `companion-bridge.ts`): outside Tauri
 * or with the hub down it silently no-ops. The mother never breaks here.
 */

import { useEffect } from 'react';

import { pushCompanionAuth, startCompanionCartBridge } from '../lib/companion-bridge.js';

export function useCompanionBridge(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void pushCompanionAuth();
    const stop = startCompanionCartBridge();
    return stop;
  }, [active]);
}
