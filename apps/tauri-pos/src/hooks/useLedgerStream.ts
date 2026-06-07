/**
 * useLedgerStream — wraps a long-lived EventSource for /api/sse/ledger.
 *
 * Responsibilities:
 *   1. Open the SSE connection (with credentials → session cookie auth).
 *   2. Parse each `event: ledger` payload into a typed `LedgerEvent`.
 *   3. Push it onto the Zustand `ledger-feed-store` (atomic, per-row UI).
 *   4. Debounce-invalidate the `dashboard.summary` TanStack Query when
 *      the event affects any dashboard tile (`shouldInvalidateDashboard`).
 *   5. Reconnect on close / error with exponential backoff (1s → 30s),
 *      letting the browser's EventSource auto-resume via `Last-Event-ID`.
 *   6. Surface `status` + `lastError` so the UI can show a small
 *      "Verbindung wird wiederhergestellt..." banner if needed.
 *
 * The hook owns the EventSource for its lifetime. Mount it ONCE at the
 * top of the authenticated tree (App.tsx after the session gate).
 *
 * Why NOT TanStack Query mutation: SSE is not idempotent — re-running it
 * would open a second stream. TanStack lifecycle (refetch, focus) is wrong
 * here. We use a hand-written hook + Zustand.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  type LedgerEvent,
  parseLedgerEvent,
  shouldInvalidateDashboard,
} from '@warehouse14/api-client';

import { useApiClient } from '../lib/api-context.js';
import { getSessionToken } from '../lib/session-token.js';
import { useLedgerFeed } from '../state/ledger-feed-store.js';
import { dashboardQueryKey } from './useDashboardSummary.js';

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

interface UseLedgerStreamResult {
  status: SseStatus;
  /** Last error from the EventSource — useful for a thin debug strip. */
  lastError: string | null;
}

const RECONNECT_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/** Coalesce multiple dashboard invalidations within this window into one. */
const DASHBOARD_INVALIDATE_DEBOUNCE_MS = 400;

export function useLedgerStream(enabled: boolean): UseLedgerStreamResult {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const push = useLedgerFeed((s) => s.push);

  const [status, setStatus] = useState<SseStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const invalidateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Caller turned the stream off (sign-out). Tear down cleanly.
      closeEverything();
      setStatus('closed');
      return;
    }

    let cancelled = false;

    function scheduleReconnect() {
      const attempt = reconnectAttemptRef.current;
      const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
      reconnectAttemptRef.current = attempt + 1;
      setStatus('reconnecting');
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!cancelled) connect();
      }, delay);
    }

    function dispatchEvent(event: LedgerEvent) {
      push(event);
      if (shouldInvalidateDashboard(event)) {
        // Coalesce many close-together dashboard-affecting events into one
        // invalidation, so we don't hammer the API during a busy minute.
        if (invalidateTimerRef.current !== null) {
          window.clearTimeout(invalidateTimerRef.current);
        }
        invalidateTimerRef.current = window.setTimeout(() => {
          invalidateTimerRef.current = null;
          // Fire-and-forget — TanStack handles the actual refetch.
          void queryClient.invalidateQueries({ queryKey: dashboardQueryKey });
        }, DASHBOARD_INVALIDATE_DEBOUNCE_MS);
      }
    }

    function connect() {
      setStatus('connecting');
      setLastError(null);

      // EventSource can't set an Authorization header, so the session token
      // rides as a query param — the auth preHandler accepts `access_token`
      // for /api/sse/* (Windows WebView2 drops the cross-site session cookie).
      const token = getSessionToken();
      const sseBase = `${apiClient.baseUrl.replace(/\/+$/, '')}/api/sse/ledger`;
      const url = token ? `${sseBase}?access_token=${encodeURIComponent(token)}` : sseBase;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.addEventListener('open', () => {
        if (cancelled) return;
        reconnectAttemptRef.current = 0;
        setStatus('open');
      });

      es.addEventListener('ledger', (msg) => {
        if (cancelled) return;
        const data = (msg as MessageEvent<string>).data;
        const parsed = parseLedgerEvent(data);
        if (parsed) dispatchEvent(parsed);
      });

      // Some SSE servers (and curl tests) emit messages without the `event:`
      // line — they default to `event: message`. Cover both paths.
      es.addEventListener('message', (msg) => {
        if (cancelled) return;
        const data = (msg as MessageEvent<string>).data;
        const parsed = parseLedgerEvent(data);
        if (parsed) dispatchEvent(parsed);
      });

      es.addEventListener('error', () => {
        if (cancelled) return;
        // EventSource auto-reconnects on transient errors, but it will not
        // resurrect after a hard close (401/403). We schedule manual retry
        // — if a retry succeeds, the backoff resets in the open handler.
        setLastError('connection_interrupted');
        try {
          es.close();
        } catch {
          /* ignore */
        }
        esRef.current = null;
        scheduleReconnect();
      });
    }

    function closeEverything() {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {
          /* ignore */
        }
        esRef.current = null;
      }
    }

    connect();
    return closeEverything;
    // The effect intentionally depends on `enabled` only; apiClient + queryClient
    // are stable singletons within the app lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status, lastError };
}
