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

import { useSyncStore } from '../../state/sync-store.js';
import { SignOutButton } from './SignOutButton.js';
import { SurfaceChip } from './SurfaceChip.js';
import { ThemeToggle } from './ThemeToggle.js';
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
          gap: 4,
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

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        <SyncStatusBadge />
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.198.61.69 1.075 1.31 1.21H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        </button>
        <ThemeToggle />
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

const SYNC_KEYFRAMES = `
@keyframes w14SyncPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.78); } }
@keyframes w14SyncGlow { 0%, 100% { box-shadow: 0 0 4px 0 var(--w14-gold); } 50% { box-shadow: 0 0 9px 1px var(--w14-gold); } }
`;

interface SyncVisual {
  color: string;
  label: string;
  animation: string | undefined;
  clickable: boolean;
}

/**
 * Offline-sync status indicator (ADR-0044 §6). Four states, premium palette:
 *   • green (verdigris) "Bereit"            — online, queue empty
 *   • gold pulsing "Synchronisiert [N]"     — replaying / queued
 *   • amber "Offline [N]"                   — disconnected, N pending
 *   • wax-red pulsing "Sync blockiert"      — conflict → Compliance Inbox
 */
function SyncStatusBadge(): JSX.Element {
  const navigate = useNavigate();
  const online = useSyncStore((s) => s.online);
  const syncing = useSyncStore((s) => s.syncing);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const conflictCount = useSyncStore((s) => s.conflictCount);

  let visual: SyncVisual;
  if (conflictCount > 0) {
    visual = {
      color: 'var(--w14-wax-red)',
      label: 'Sync blockiert',
      animation: 'w14SyncPulse 1.3s ease-in-out infinite',
      clickable: true,
    };
  } else if (!online) {
    visual = {
      color: '#b07a2e',
      label: `Offline ${pendingCount}`,
      animation: undefined,
      clickable: false,
    };
  } else if (syncing || pendingCount > 0) {
    visual = {
      color: 'var(--w14-gold)',
      label: `Synchronisiert ${pendingCount}`,
      animation: 'w14SyncGlow 1.1s ease-in-out infinite',
      clickable: false,
    };
  } else {
    visual = {
      color: 'var(--w14-verdigris)',
      label: 'Bereit',
      animation: undefined,
      clickable: false,
    };
  }

  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 10px',
    borderRadius: 'var(--w14-radius-card)',
    border: '1px solid var(--w14-rule)',
    background: 'var(--w14-parchment)',
  };

  const inner = (
    <>
      <style>{SYNC_KEYFRAMES}</style>
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: visual.color,
          display: 'inline-block',
          boxShadow: `0 0 6px -1px ${visual.color}`,
          ...(visual.animation ? { animation: visual.animation } : {}),
        }}
      />
      <span
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontSize: '0.78rem',
          letterSpacing: '0.01em',
          color: 'var(--w14-ink-aged)',
          whiteSpace: 'nowrap',
        }}
      >
        {visual.label}
      </span>
    </>
  );

  if (visual.clickable) {
    return (
      <button
        type="button"
        title="Zur Compliance-Inbox"
        aria-label={`${visual.label} — zur Compliance-Inbox`}
        onClick={() => navigate('/compliance-inbox')}
        style={{ ...baseStyle, cursor: 'pointer' }}
      >
        {inner}
      </button>
    );
  }
  return (
    <output aria-label={visual.label} title={visual.label} style={baseStyle}>
      {inner}
    </output>
  );
}
