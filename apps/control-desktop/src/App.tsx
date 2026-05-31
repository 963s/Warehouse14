/**
 * App — the Owner Control Desktop shell (ADR-0009 host, ADR-0019 UX). A thin
 * Karteikasten-Index rail (Seal[14], digit·label chips, Spotlight magnifier)
 * over a parchment surface. The `Übersicht` surface renders the full three-pane
 * "Bridge" (ADR-0019 §1); the remaining seven surfaces are placeholders until
 * each back-office workflow is wired.
 */

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { DiamondRule, MagnifierIcon, ParchmentCard, RomanIndex, Seal } from '@warehouse14/ui-kit';

import { useApiClient } from './api-context.js';
import { StatusDot, type StatusTone } from './components/StatusDot.js';
import { ApprovalsPanel } from './panels/ApprovalsPanel.js';
import { BridgeDashboard } from './screens/übersicht/BridgeDashboard.js';

/** The Owner's back-office surfaces, ordered by frequency. */
const SURFACES = [
  { digit: 1, label: 'Übersicht' },
  { digit: 2, label: 'Genehmigungen' },
  { digit: 3, label: 'Kassenabschluss' },
  { digit: 4, label: 'Kunden' },
  { digit: 5, label: 'Lager' },
  { digit: 6, label: 'Termine' },
  { digit: 7, label: 'Konformität' },
  { digit: 8, label: 'Einstellungen' },
] as const;

type ConnectionState = 'unbekannt' | 'verbunden' | 'nicht erreichbar';

const CONNECTION_TONE: Record<ConnectionState, StatusTone> = {
  unbekannt: 'info',
  verbunden: 'ok',
  'nicht erreichbar': 'alert',
};

// Visible focus rings on every interactive element (ADR-0019 §12 / WCAG AA).
// Inline styles cannot express :focus-visible, so we inject one scoped rule.
const FOCUS_CSS = `
.w14cd-focusable:focus-visible {
  outline: 2px solid var(--w14-focus-ring);
  outline-offset: 2px;
  border-radius: var(--w14-radius-button);
}`;

const railStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  height: 56,
  padding: '0 20px',
  background: 'var(--w14-parchment-2)',
  borderBottom: '1px solid var(--w14-ink-faded)',
};

const chipBase: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 2px',
  fontFamily: 'var(--w14-font-display, "Cormorant Garamond", serif)',
  fontSize: '0.86rem',
  letterSpacing: '0.02em',
  color: 'var(--w14-ink-faded)',
  borderBottom: '2px solid transparent',
};

/** Berlin wall-clock `HH:MM` — the header's "current time" (ADR-0019 §1). */
function berlinTime(): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

export function App(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [active, setActive] = useState(1);
  const [connection, setConnection] = useState<ConnectionState>('unbekannt');
  const [clock, setClock] = useState<string>(() => berlinTime());

  useEffect(() => {
    const id = setInterval(() => setClock(berlinTime()), 30_000);
    return () => clearInterval(id);
  }, []);

  const checkConnection = useCallback(() => {
    client
      .request<{ ok?: boolean }>('GET', '/api/health')
      .then(() => setConnection('verbunden'))
      .catch(() => setConnection('nicht erreichbar'));
  }, [client]);

  const activeSurface = SURFACES.find((s) => s.digit === active) ?? SURFACES[0];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--w14-parchment)',
        color: 'var(--w14-ink)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{FOCUS_CSS}</style>

      {/* ── Karteikasten-Index rail ─────────────────────────────────────── */}
      <header style={railStyle}>
        <Seal label="14" size="sm" tone="ink" title="Warehouse14 Control" />
        <nav style={{ display: 'flex', gap: 16, flex: 1 }} aria-label="Karteikasten-Index">
          {SURFACES.map((surface) => {
            const isActive = surface.digit === active;
            return (
              <button
                key={surface.digit}
                type="button"
                className="w14cd-focusable"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActive(surface.digit)}
                style={{
                  ...chipBase,
                  color: isActive ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                  borderBottomColor: isActive ? 'var(--w14-gold)' : 'transparent',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono, "JetBrains Mono", monospace)',
                    fontWeight: 500,
                  }}
                >
                  {surface.digit}
                </span>
                {' · '}
                {surface.label}
              </button>
            );
          })}
        </nav>

        {/* System-status pill — overall state + Berlin time (ADR-0019 §1). */}
        <button
          type="button"
          className="w14cd-focusable"
          onClick={checkConnection}
          title={`API: ${baseUrl}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: '1px solid var(--w14-ink-faded)',
            borderRadius: 'var(--w14-radius-button)',
            padding: '5px 12px',
            cursor: 'pointer',
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          <StatusDot
            tone={CONNECTION_TONE[connection]}
            size={10}
            label={`Verbindung: ${connection}`}
          />
          <span className="w14-smallcaps">{connection}</span>
          <span aria-hidden="true" style={{ color: 'var(--w14-ink-faded)' }}>
            ·
          </span>
          <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
            {clock}
          </span>
        </button>

        <MagnifierIcon size={22} tone="ink" aria-label="Spotlight" />
      </header>

      {/* ── Active surface ──────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        {active === 1 ? (
          <>
            <DiamondRule tone="gold" label="Kommandozentrale" />
            <BridgeDashboard />
          </>
        ) : active === 2 ? (
          <ApprovalsPanel />
        ) : (
          <PlaceholderSurface digit={activeSurface.digit} label={activeSurface.label} />
        )}
      </main>
    </div>
  );
}

function PlaceholderSurface({ digit, label }: { digit: number; label: string }): JSX.Element {
  return (
    <>
      <DiamondRule tone="gold" label="Kommandozentrale" />
      <ParchmentCard tone="parchment" padding="lg" style={{ marginTop: 24, maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <RomanIndex value={digit} tone="gold" />
          <h1 style={{ margin: 0, fontFamily: 'var(--w14-font-display, serif)' }}>{label}</h1>
        </div>
        <p style={{ color: 'var(--w14-ink-faded)', marginTop: 12 }}>
          Diese Oberfläche wird mit dem jeweiligen Back-Office-Workflow gefüllt. Die Übersicht
          (Bridge) ist bereits aktiv — wähle <strong>1 · Übersicht</strong>.
        </p>
      </ParchmentCard>
    </>
  );
}
