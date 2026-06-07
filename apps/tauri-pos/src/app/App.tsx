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

import { Button, DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';
import { ErrorBoundary } from '@warehouse14/ui-kit';

import { useCompanionBridge } from '../hooks/useCompanionBridge.js';
import { useSessionProbe } from '../hooks/useSessionProbe.js';
import { applyChatwoot } from '../lib/chatwoot.js';
import { useOfflineReplay } from '../lib/offline-replay.js';
import { PinLogin } from '../screens/PinLogin.js';
import { useIntegrationSettings } from '../state/integration-settings-store.js';
import { useLedgerFeed } from '../state/ledger-feed-store.js';
import { useSessionStore } from '../state/session-store.js';
import { useToastStore } from '../state/toast-store.js';
import { AppFooter } from './chrome/AppFooter.js';
import { Splash } from './chrome/Splash.js';
import { AppRouter } from './router.js';

export function App(): JSX.Element {
  // Fire the cold-start probe; mutates the session-store status.
  useSessionProbe();

  const status = useSessionStore((s) => s.status);
  const clearLedger = useLedgerFeed((s) => s.clear);
  const clearToasts = useToastStore((s) => s.clear);

  // Companion LAN hub: once authenticated, push the mother's Bearer into the
  // embedded hub and start the debounced live-cart feed (best-effort — no-ops
  // outside Tauri or when the hub isn't running).
  useCompanionBridge(status === 'authenticated');

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

  // Customer-service widget (Chatwoot) — load/teardown to match the operator's
  // settings; only mount it once authenticated so the login screen stays clean.
  const chatwoot = useIntegrationSettings((s) => s.settings.chatwoot);
  useEffect(() => {
    applyChatwoot(status === 'authenticated' ? chatwoot : { ...chatwoot, enabled: false });
  }, [status, chatwoot]);

  const retryProbe = useSessionStore((s) => s.retryProbe);

  let body: JSX.Element;
  if (status === 'unknown') {
    body = <Splash />;
  } else if (status === 'authenticated') {
    body = <AppRouter />;
  } else if (status === 'unreachable') {
    body = <ServerUnreachable onRetry={retryProbe} />;
  } else {
    body = <PinLogin />;
  }

  return (
    <ErrorBoundary>
      {body}
      <AppFooter />
    </ErrorBoundary>
  );
}

/**
 * ServerUnreachable — shown when the cold-start probe could not reach the
 * server (network / circuit-open). Distinct from the PIN pad: it tells the
 * operator the truth ("Keine Verbindung zum Server") instead of implying the
 * session ended, and offers a single retry that re-runs the probe.
 */
function ServerUnreachable({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--w14-parchment)',
        padding: 24,
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <Seal size="lg" tone="faded" />
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            margin: '16px 0 4px',
          }}
        >
          Keine Verbindung zum Server
        </h1>
        <p
          style={{
            margin: '0 0 18px',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            lineHeight: 1.5,
          }}
        >
          Der Server ist derzeit nicht erreichbar. Bitte prüfen Sie die Internetverbindung und
          versuchen Sie es erneut.
        </p>
        <Button variant="primary" size="md" onClick={onRetry}>
          Erneut versuchen
        </Button>
        <DiamondRule />
      </ParchmentCard>
    </div>
  );
}
