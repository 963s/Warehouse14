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

import { Seal } from '@warehouse14/ui-kit';

import { HealthDot } from './HealthDot.js';
import { IconSettings } from './Icons.js';
import { SupportButton } from './SupportButton.js';
import { SurfaceChip } from './SurfaceChip.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UpdateButton } from './UpdateButton.js';
import { HOME_PATH, PRIMARY_SURFACES } from './surface-registry.js';

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

      {/* Support · Status-Dot · Einstellungen · Update · Darstellung */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <SupportButton />
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
        <ThemeToggle />
      </div>
    </header>
  );
}
