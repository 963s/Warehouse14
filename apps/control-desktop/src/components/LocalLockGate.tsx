/**
 * LocalLockGate — engages the local device quick-unlock (Track A2) around the
 * authenticated shell. The Google session stays valid; this only decides whether
 * THIS machine may show it right now.
 *
 *   • cold start with a code set        → locked, ask for the code
 *   • cold start with no code set       → offer to set one (skippable, once/session)
 *   • idle beyond IDLE_MS with a code   → re-lock, so a walked-away desk is covered
 *
 * The "Mit Google neu anmelden" fallback does a real sign-out (server revoke +
 * clear token + clear local code) so a forgotten code is never a dead end.
 *
 * Renders inside <ApiClientProvider> (AuthGate already guarantees this).
 */

import { type ReactNode, useEffect, useState } from 'react';

import { authPin } from '@warehouse14/api-client';

import { useApiClient } from '../api-context.js';
import { clearLocalPin, hasLocalPin } from '../lib/local-lock.js';
import { clearSessionToken } from '../lib/session-token.js';
import { LocalLock } from '../screens/LocalLock.js';
import { useSessionStore } from '../state/session-store.js';

/** Re-lock after this much inactivity. Fast re-entry, but an unattended desk closes. */
const IDLE_MS = 5 * 60 * 1000;
const SKIP_KEY = 'w14.local-pin.skipped';

function skippedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function LocalLockGate({ children }: { children: ReactNode }): JSX.Element {
  const { client } = useApiClient();
  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);

  // Cold start: locked when a code exists; otherwise offer to set one (once/session).
  const [locked, setLocked] = useState<boolean>(() => hasLocalPin());
  const [offerSetup, setOfferSetup] = useState<boolean>(() => !hasLocalPin() && !skippedThisSession());

  // Idle re-lock — only meaningful while unlocked and a code is set.
  useEffect(() => {
    if (locked || !hasLocalPin()) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => setLocked(true), IDLE_MS);
    };
    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'pointermove', 'wheel'];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [locked]);

  function handleUnlocked(): void {
    // Skipped setup (no code stored) → don't nag again this session.
    if (!hasLocalPin()) {
      try {
        sessionStorage.setItem(SKIP_KEY, '1');
      } catch {
        // ignore
      }
    }
    setOfferSetup(false);
    setLocked(false);
  }

  async function handleSignOut(): Promise<void> {
    try {
      await authPin.signOut(client);
    } catch {
      // Best-effort: clear locally so the operator is never stranded.
    } finally {
      clearSessionToken();
      clearLocalPin();
      setUnauthenticated();
    }
  }

  if ((locked && hasLocalPin()) || offerSetup) {
    return <LocalLock onUnlocked={handleUnlocked} onSignOut={() => void handleSignOut()} />;
  }
  return <>{children}</>;
}
