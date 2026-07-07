/**
 * AppShellHeader — the 56-px Karteikasten rail.
 *
 *   [Seal-14]   1·Werkstatt  2·Verkauf … 8·Bewertung   ⛑ ● ⚙ ↻ ☾
 *                               ━━━ active gold hairline
 *
 * Right cluster (the only chrome controls, in this order): Support · Status-Dot ·
 * Einstellungen · Update · Darstellung. The old floating footer, the wordy sync
 * badge, the search icon and the sign-out lock were removed — search is Cmd+K,
 * sign-out lives in Einstellungen.
 */

import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { SessionActor } from '@warehouse14/api-client';
import { Seal } from '@warehouse14/ui-kit';

import { useSessionStore } from '../../state/session-store.js';
import { HealthDot } from './HealthDot.js';
import { IconSettings } from './Icons.js';
import { SupportButton } from './SupportButton.js';
import { SurfaceChip } from './SurfaceChip.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UpdateButton } from './UpdateButton.js';
import { HOME_PATH, PRIMARY_SURFACES } from './surface-registry.js';

/** Who is signed in — SessionActor carries no name, so we show the German role. */
function operatorLabel(actor: SessionActor): string {
  if (actor.isOwner) return 'Inhaber';
  switch (actor.role) {
    case 'ADMIN':
      return 'Verwaltung';
    case 'CASHIER':
      return 'Kasse';
    case 'READONLY':
      return 'Nur Lesen';
    default:
      return 'Angemeldet';
  }
}

export interface AppShellHeaderProps {
  /** Opens the Spotlight palette (Cmd/Ctrl+K). */
  onOpenSpotlight: () => void;
  /** Performs the sign-out — wired in AppShell (now invoked from Einstellungen). */
  onSignOut: () => void;
}

// Search has no icon anymore — it's reachable via Cmd/Ctrl+K, bound globally in
// AppShell. The sign-out lock moved to Einstellungen. Props kept for the
// AppShell call-site compatibility.
export function AppShellHeader(_props: AppShellHeaderProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const actor = useSessionStore((s) => s.actor);

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    gap: 'var(--space-6)',
    height: 56,
    padding: '0 var(--space-5)',
    backgroundColor: 'var(--w14-parchment-2)',
    borderBottom: '1px solid var(--w14-rule)',
  };

  const sealBtn: CSSProperties = {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 0,
  };

  return (
    <header style={rowStyle}>
      <button
        type="button"
        title="Werkstatt"
        aria-label="Zur Werkstatt"
        style={sealBtn}
        onClick={() => navigate(HOME_PATH)}
      >
        <Seal size="sm" tone={location.pathname === HOME_PATH ? 'gold' : 'ink'} />
      </button>

      <nav
        aria-label="Karteikasten"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {PRIMARY_SURFACES.map((s) => (
          <SurfaceChip
            key={s.path}
            digit={s.digit ?? 0}
            label={s.label}
            description={s.description}
            active={location.pathname.startsWith(s.path)}
            onActivate={() => navigate(s.path)}
          />
        ))}
      </nav>

      {/* Angemeldet · Darstellung · Status-Dot · Einstellungen · Update · Support */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {actor && (
          <button
            type="button"
            title="Angemeldet — zu den Einstellungen (dort Abmelden)"
            aria-label={`Angemeldet als ${operatorLabel(actor)}`}
            onClick={() => navigate('/einstellungen')}
            className="w14-smallcaps"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              height: 28,
              padding: '0 var(--space-3)',
              flex: '0 0 auto',
              letterSpacing: '0.08em',
              fontSize: '0.72rem',
              color: 'var(--w14-ink-faded)',
              background: 'transparent',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-button)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: 'var(--w14-ink-faded)' }}>Angemeldet:</span>
            <span style={{ color: actor.isOwner ? 'var(--w14-gold)' : 'var(--w14-ink)' }}>
              {operatorLabel(actor)}
            </span>
          </button>
        )}
        <ThemeToggle />
        <HealthDot />
        <button
          type="button"
          title="Einstellungen"
          aria-label="Einstellungen"
          onClick={() => navigate('/einstellungen')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            flex: '0 0 auto',
            color:
              location.pathname === '/einstellungen' ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
            background: 'transparent',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-button)',
            cursor: 'pointer',
          }}
        >
          <IconSettings size={18} />
        </button>
        <UpdateButton />
        <SupportButton />
      </div>
    </header>
  );
}
