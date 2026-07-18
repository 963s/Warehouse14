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

import { HealthDot } from './HealthDot.js';
import { IconSettings } from './Icons.js';
import { ProfileMenu } from './ProfileMenu.js';
import { SupportButton } from './SupportButton.js';
import { SurfaceChip } from './SurfaceChip.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UpdateButton } from './UpdateButton.js';
import { PRIMARY_SURFACES, visibleSurfaces } from './surface-registry.js';
import { useSessionStore } from '../../state/session-store.js';

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
  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);
  const railSurfaces = visibleSurfaces(PRIMARY_SURFACES, isOwner);

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

  return (
    <header style={rowStyle}>
      <ProfileMenu />

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
        {railSurfaces.map((s) => (
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

      {/* Darstellung · Status-Dot · Einstellungen · Update · Support
          (identity + Abmelden now live in the ProfileMenu on the left). */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
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
