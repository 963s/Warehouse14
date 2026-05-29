/**
 * AppShellHeader — the 56-px Karteikasten rail.
 *
 *   [Seal-14]    1 · Werkstatt   2 · Verkauf   …   8 · Bewertung    ⌕  ⏻
 *                                ━━━━━━━ active gold hairline
 *
 * Reads the primary surfaces from `surface-registry.ts` and the active
 * one from react-router's location. Click → navigate. The Seal navigates
 * to /werkstatt as a "home" affordance.
 *
 * No business logic lives here; this is pure layout + interaction.
 */

import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { MagnifierIcon, Seal } from '@warehouse14/ui-kit';

import { SignOutButton } from './SignOutButton.js';
import { SurfaceChip } from './SurfaceChip.js';
import { HOME_PATH, PRIMARY_SURFACES } from './surface-registry.js';

export interface AppShellHeaderProps {
  /** Opens the Spotlight palette — wired up in AppShell. */
  onOpenSpotlight: () => void;
  /** Performs the sign-out — wired up in AppShell. */
  onSignOut: () => void;
}

export function AppShellHeader({ onOpenSpotlight, onSignOut }: AppShellHeaderProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    gap: 24,
    height: 56,
    padding: '0 20px',
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
    <header style={rowStyle} role="banner">
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
          gap: 4,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {PRIMARY_SURFACES.map((s) => (
          <SurfaceChip
            key={s.path}
            digit={s.digit!}
            label={s.label}
            description={s.description}
            active={location.pathname.startsWith(s.path)}
            onActivate={() => navigate(s.path)}
          />
        ))}
      </nav>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16 }}>
        <button
          type="button"
          title="Suchen — Cmd+K"
          aria-label="Suchen"
          onClick={onOpenSpotlight}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: 6,
            color: 'var(--w14-ink-aged)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <MagnifierIcon size={22} />
          <span
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.7rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            ⌘K
          </span>
        </button>
        <SignOutButton onConfirm={onSignOut} />
      </div>
    </header>
  );
}
