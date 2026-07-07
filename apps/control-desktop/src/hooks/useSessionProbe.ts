/**
 * useSessionProbe — cold-start session restore (governance desktop).
 *
 * Runs ONCE when status is 'unknown'. Calls GET /api/auth/session:
 *   • 200 → `setFromProbe(payload)`   (operator stays logged in)
 *   • 401 / other ApiError → `setUnauthenticated()`  (PIN re-login screen)
 *   • network / circuit-open → `setUnreachable()`    (the SERVER is down — we
 *                                                     must NOT imply the session
 *                                                     ended; the gate shows a
 *                                                     "Keine Verbindung" retry)
 *
 * Splitting the catch is the whole point: an unreachable tunnel must NOT fall
 * through to the PIN pad (which reads as a silent logout). A real auth failure
 * (`ApiError`, incl. 401) still means "no session" → unauthenticated.
 *
 * Adapted from apps/tauri-pos/src/hooks/useSessionProbe.ts — control-desktop's
 * useApiClient() returns `{ client, baseUrl }`, and it has no sync store.
 */

import { useEffect } from 'react';

import { ApiCircuitOpenError, ApiNetworkError, authPin } from '@warehouse14/api-client';

import { useApiClient } from '../api-context.js';
import { useSessionStore } from '../state/session-store.js';

export function useSessionProbe(): void {
  const { client } = useApiClient();
  const status = useSessionStore((s) => s.status);
  const setFromProbe = useSessionStore((s) => s.setFromProbe);
  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);
  const setUnreachable = useSessionStore((s) => s.setUnreachable);

  useEffect(() => {
    if (status !== 'unknown') return;
    let cancelled = false;

    (async () => {
      try {
        const res = await authPin.sessionSafe(client);
        if (cancelled) return;
        setFromProbe(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiNetworkError || err instanceof ApiCircuitOpenError) {
          // The server itself is unreachable — do NOT show the PIN pad (that
          // reads as a logout). Show the retry screen instead.
          setUnreachable();
          return;
        }
        // A real API response (401 / other) → genuinely no session.
        setUnauthenticated();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, status, setFromProbe, setUnauthenticated, setUnreachable]);
}
