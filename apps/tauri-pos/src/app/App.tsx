/**
 * App shell — Day 5.
 *
 * Boots in three deliberate phases (memory.md #76):
 *
 *   1. unknown          → run `useSessionProbe` once
 *                         GET /api/auth/session decides: authenticated or not.
 *                         While the probe is in-flight, we render a minimal
 *                         brand-themed splash (Seal on parchment).
 *   2. unauthenticated  → <PinLogin />
 *   3. authenticated    → <AppRouter /> (Karteikasten + every surface)
 *
 * A top-level <ErrorBoundary/> wraps the whole tree as the last-resort
 * fallback. The per-route boundary inside AppShell is the first line.
 */

import { useEffect } from 'react';

import { ErrorBoundary } from '@warehouse14/ui-kit';

import { useSessionProbe } from '../hooks/useSessionProbe.js';
import { useOfflineReplay } from '../lib/offline-replay.js';
import { PinLogin } from '../screens/PinLogin.js';
import { useLedgerFeed } from '../state/ledger-feed-store.js';
import { useSessionStore } from '../state/session-store.js';
import { useToastStore } from '../state/toast-store.js';
import { Splash } from './chrome/Splash.js';
import { AppRouter } from './router.js';

export function App(): JSX.Element {
  // Fire the cold-start probe; mutates the session-store status.
  useSessionProbe();

  const status = useSessionStore((s) => s.status);
  const clearLedger = useLedgerFeed((s) => s.clear);
  const clearToasts = useToastStore((s) => s.clear);

  // Phase 3 (ADR-0044): drain the offline outbox once authenticated. The hook
  // attaches connectivity listeners + runs a startup sweep; the DB connection
  // lazy-loads on first drain, never blocking React mount.
  useOfflineReplay(status === 'authenticated');

  // Defence-in-depth: any departure from 'authenticated' tears down the
  // in-memory caches that should never outlive a session.
  useEffect(() => {
    if (status !== 'authenticated') {
      clearLedger();
      clearToasts();
    }
  }, [status, clearLedger, clearToasts]);

  let body: JSX.Element;
  if (status === 'unknown') {
    body = <Splash />;
  } else if (status === 'authenticated') {
    body = <AppRouter />;
  } else {
    body = <PinLogin />;
  }

  return <ErrorBoundary>{body}</ErrorBoundary>;
}
