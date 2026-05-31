/**
 * App — the Owner Control Desktop shell. Renders the Karteikasten-Index
 * navigation paradigm (memory.md §11 / Decision #75): a thin top rail with the
 * Seal[14], digit·label index chips, and the Spotlight magnifier, over a
 * parchment surface. This is the scaffold — each surface is a placeholder until
 * its back-office workflow is wired.
 */

import type { CSSProperties } from 'react';
import { useCallback, useState } from 'react';

import { DiamondRule, MagnifierIcon, ParchmentCard, RomanIndex, Seal } from '@warehouse14/ui-kit';

import { useApiClient } from './api-context.js';
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

export function App(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [active, setActive] = useState(1);
  const [connection, setConnection] = useState<ConnectionState>('unbekannt');

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
        <MagnifierIcon size={22} tone="ink" aria-label="Spotlight" />
      </header>

      {/* ── Active surface ──────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: 32, maxWidth: 960, width: '100%', margin: '0 auto' }}>
        <DiamondRule tone="gold" label="Kommandozentrale" />
        {active === 1 ? (
          <BridgeDashboard />
        ) : (
          <ParchmentCard tone="parchment" padding="lg" style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <RomanIndex value={activeSurface.digit} tone="gold" />
              <h1 style={{ margin: 0, fontFamily: 'var(--w14-font-display, serif)' }}>
                {activeSurface.label}
              </h1>
            </div>
            <p style={{ color: 'var(--w14-ink-faded)', marginTop: 12 }}>
              Owner-Kommandozentrale (Gerüst). Diese Oberfläche wird mit dem jeweiligen
              Back-Office-Workflow gefüllt.
            </p>

            <DiamondRule tone="faded" style={{ margin: '24px 0' }} />

            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '6px 16px',
                margin: 0,
              }}
            >
              <dt style={{ color: 'var(--w14-ink-faded)' }}>API</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--w14-font-mono, monospace)' }}>
                {baseUrl}
              </dd>
              <dt style={{ color: 'var(--w14-ink-faded)' }}>Verbindung</dt>
              <dd style={{ margin: 0 }}>{connection}</dd>
            </dl>

            <button
              type="button"
              onClick={checkConnection}
              style={{
                marginTop: 20,
                padding: '8px 16px',
                cursor: 'pointer',
                background: 'var(--w14-ink)',
                color: 'var(--w14-parchment)',
                border: 'none',
                borderRadius: 4,
                fontFamily: 'var(--w14-font-display, serif)',
              }}
            >
              Verbindung prüfen
            </button>
          </ParchmentCard>
        )}
      </main>
    </div>
  );
}
