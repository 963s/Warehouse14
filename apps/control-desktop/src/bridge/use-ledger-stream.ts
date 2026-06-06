/**
 * useLedgerStream — a live SSE feed for the Owner Übersicht, LAYERED OVER the
 * existing 30s poll (graceful degradation; ADR-0014).
 *
 * Mirrors the tauri-pos `useLedgerStream` connection/backoff pattern: open an
 * EventSource to `/api/sse/ledger` (cookie auth via `withCredentials`), and on
 * each `event: ledger` nudge the caller's refetch — coalesced so a busy minute
 * costs one extra pull, not dozens.
 *
 * Deliberate divergences for the Control Desktop:
 *   • The Übersicht's data hook is a plain `refetch()` (not a TanStack query),
 *     so we invoke that real callback — NOT a no-op invalidate on a key nothing
 *     is registered under.
 *   • Bounded backoff with a HARD STOP: after MAX_CONSECUTIVE_FAILURES we give
 *     up reconnecting (no credentialed-reconnect storm) and fall back silently
 *     to the 30s poll. EventSource can't send Authorization headers, so if the
 *     cookie/CORS doesn't admit this origin in dev, SSE simply never connects —
 *     and the Bridge behaves exactly as before. SSE is purely additive.
 *
 * No visual surface — pure wiring. Cleans up on unmount / baseUrl change.
 */

import { useEffect, useRef } from 'react';

import { useApiClient } from '../api-context.js';

/** Exponential backoff, capped (ms). Mirrors the tauri-pos ladder. */
const RECONNECT_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/** After this many consecutive failures, stop reconnecting and lean on the poll. */
const MAX_CONSECUTIVE_FAILURES = 6;
/** Coalesce a burst of ledger events into a single refetch. */
const REFETCH_DEBOUNCE_MS = 400;

/**
 * Open the ledger SSE stream and call `onLedger` (debounced) on each event.
 * The caller keeps its own 30s poll as the floor — this only makes it livelier.
 */
export function useLedgerStream(onLedger: () => void): void {
  const { baseUrl } = useApiClient();

  // Keep the latest callback without re-subscribing the stream.
  const onLedgerRef = useRef(onLedger);
  useEffect(() => {
    onLedgerRef.current = onLedger;
  }, [onLedger]);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let debounceTimer: number | null = null;
    let failures = 0;

    const clearTimers = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };

    const fireDebounced = (): void => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        onLedgerRef.current();
      }, REFETCH_DEBOUNCE_MS);
    };

    const connect = (): void => {
      if (cancelled) return;
      const url = `${baseUrl.replace(/\/+$/, '')}/api/sse/ledger`;
      const source = new EventSource(url, { withCredentials: true });
      es = source;

      source.addEventListener('open', () => {
        failures = 0; // a successful connect resets the backoff
      });

      const onAny = (): void => {
        if (!cancelled) fireDebounced();
      };
      // Named `ledger` events, plus the default `message` (curl / servers that
      // omit the `event:` line) — refetch on either.
      source.addEventListener('ledger', onAny);
      source.addEventListener('message', onAny);

      source.addEventListener('error', () => {
        if (cancelled) return;
        try {
          source.close();
        } catch {
          /* ignore */
        }
        es = null;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          // Give up: no credentialed-reconnect storm. The 30s poll keeps the
          // Bridge live; SSE just isn't available here (CORS/auth/dev).
          return;
        }
        const delay =
          RECONNECT_BACKOFF_MS[Math.min(failures - 1, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
        reconnectTimer = window.setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      cancelled = true;
      clearTimers();
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
    };
  }, [baseUrl]);
}
