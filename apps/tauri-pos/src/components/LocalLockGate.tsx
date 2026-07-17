/**
 * LocalLockGate — the MANDATORY local device gate (Track A2) around the
 * authenticated shell. The Google session proves identity; this proves that the
 * person at THIS machine right now is allowed to see it. It can never be skipped.
 *
 * Policy (Basel, 2026-07-17): the local code is required on EVERY cold start and
 * after idle. Google is re-required only when the server session expires (the
 * cold-start probe then returns unauthenticated and App.tsx shows Google login).
 *
 *   • cold start, code set     → locked, must enter the code
 *   • cold start, no code set  → must CREATE one now (not skippable), then in
 *   • idle beyond IDLE_MS      → re-lock, so a walked-away desk closes itself
 *
 * There is no "skip" and no free entry: a valid saved session never opens the
 * shell on its own. The "Mit Google neu anmelden" action does a real sign-out
 * (server revoke + clear token + clear local code) so a forgotten code is never
 * a dead end.
 *
 * Renders inside <ApiClientProvider> (App already guarantees this once
 * authenticated).
 */

import { type ReactNode, useEffect, useState } from 'react';

import { authPin } from '@warehouse14/api-client';

import { useApiClient } from '../lib/api-context.js';
import { clearLocalPin } from '../lib/local-lock.js';
import { clearSessionToken } from '../lib/session-token.js';
import { LocalLock } from '../screens/LocalLock.js';
import { useSessionStore } from '../state/session-store.js';

/** Re-lock after this much inactivity. Fast re-entry, but an unattended desk closes. */
const IDLE_MS = 5 * 60 * 1000;

export function LocalLockGate({ children }: { children: ReactNode }): JSX.Element {
  const client = useApiClient();
  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);

  // Always start locked on a cold start: a saved session never opens on its own.
  const [unlocked, setUnlocked] = useState(false);

  // Idle re-lock — only meaningful once past the gate.
  useEffect(() => {
    if (!unlocked) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => setUnlocked(false), IDLE_MS);
    };
    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'pointermove', 'wheel'];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [unlocked]);

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

  if (!unlocked) {
    return <LocalLock onUnlocked={() => setUnlocked(true)} onSignOut={() => void handleSignOut()} />;
  }
  return <>{children}</>;
}
