/**
 * useSessionProbe — cold-start session restore.
 *
 * Runs ONCE when status is 'unknown'. Calls GET /api/auth/session:
 *   • 200 → `setFromProbe(payload)`  (operator stays logged in)
 *   • 401 → `setUnauthenticated()`   (PIN re-login screen)
 *   • network error → `setUnauthenticated()` (fail closed — safer than
 *                                              showing the app to an
 *                                              unverified actor)
 *
 * Uses the RAW ApiClient (not the step-up wrapper). A 401 here must NOT
 * try to open the step-up modal; it just means there's no session.
 */

import { useEffect } from 'react';

import { authPin } from '@warehouse14/api-client';

import { useApiClient } from '../lib/api-context.js';
import { useSessionStore } from '../state/session-store.js';

export function useSessionProbe(): void {
  const api = useApiClient();
  const status = useSessionStore((s) => s.status);
  const setFromProbe = useSessionStore((s) => s.setFromProbe);
  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);

  useEffect(() => {
    if (status !== 'unknown') return;
    let cancelled = false;

    (async () => {
      try {
        const res = await authPin.session(api);
        if (cancelled) return;
        setFromProbe(res);
      } catch {
        // ApiError or network — either way, fall back to unauthenticated.
        if (cancelled) return;
        setUnauthenticated();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, status, setFromProbe, setUnauthenticated]);
}
