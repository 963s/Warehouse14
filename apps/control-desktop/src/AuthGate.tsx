/**
 * AuthGate — the session boundary for the governance desktop.
 *
 * control-desktop was dead on launch: it mounted the management shell with no
 * way to establish a session, so every Bridge call 401'd. This gate runs the
 * cold-start probe once, then renders by session status:
 *   • unknown         → a brand splash while the probe is in flight
 *   • unauthenticated → <PinLogin/>
 *   • authenticated   → the <App/> shell (every governance surface)
 *   • unreachable     → an honest "Keine Verbindung" retry (never the PIN pad,
 *                       which would read as a silent logout)
 *
 * Ported from apps/tauri-pos/src/app/App.tsx. MUST render inside
 * <ApiClientProvider> — the probe needs the client.
 */

import { Button, DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { App } from './App.js';
import { LocalLockGate } from './components/LocalLockGate.js';
import { useSessionProbe } from './hooks/useSessionProbe.js';
import { GoogleLogin } from './screens/GoogleLogin.js';
import { useSessionStore } from './state/session-store.js';

export function AuthGate(): JSX.Element {
  useSessionProbe();
  const status = useSessionStore((s) => s.status);
  const retryProbe = useSessionStore((s) => s.retryProbe);

  if (status === 'authenticated') {
    return (
      <LocalLockGate>
        <App />
      </LocalLockGate>
    );
  }
  if (status === 'unauthenticated') return <GoogleLogin />;
  if (status === 'unreachable') return <ServerUnreachable onRetry={retryProbe} />;
  return <Splash />;
}

function Splash(): JSX.Element {
  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--w14-parchment)',
      }}
    >
      <Seal size="lg" tone="faded" />
    </div>
  );
}

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
