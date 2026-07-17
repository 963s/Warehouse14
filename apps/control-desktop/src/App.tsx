/**
 * App — the Owner Control Desktop shell (ADR-0009 host, ADR-0019 UX).
 *
 * A proper desktop application chrome: a fixed LEFT SIDEBAR (the Karteikasten
 * index — brand mark, grouped navigation, and a live system footer) beside a
 * roomy scrolling content column. Navigation is a real hash route (Track B0):
 * the sidebar links to `#/…` paths, the surface registry (`surfaces.tsx`)
 * resolves the current path to a component, and back/forward + reload all work.
 */

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { Seal } from '@warehouse14/ui-kit';

import { useApiClient } from './api-context.js';
import { StatusDot, type StatusTone } from './components/StatusDot.js';
import { StepUpModal } from './components/StepUpModal.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { useHashRoute } from './router.js';
import { GROUP_ORDER, resolveSurface, SURFACES } from './surfaces.js';

type ConnectionState = 'unbekannt' | 'verbunden' | 'nicht erreichbar';

const CONNECTION_TONE: Record<ConnectionState, StatusTone> = {
  unbekannt: 'info',
  verbunden: 'ok',
  'nicht erreichbar': 'alert',
};
const CONNECTION_LABEL: Record<ConnectionState, string> = {
  unbekannt: 'Prüfe Verbindung',
  verbunden: 'Verbunden',
  'nicht erreichbar': 'Keine Verbindung',
};

const SIDEBAR_WIDTH = 256;

// Focus rings + sidebar hover states (inline styles can't express :focus-visible
// or :hover, so one scoped rule carries them — ADR-0019 §12 / WCAG AA).
const SHELL_CSS = `
.w14cd-focusable:focus-visible {
  outline: 2px solid var(--w14-focus-ring);
  outline-offset: 2px;
  border-radius: var(--w14-radius-button);
}
.w14cd-nav {
  transition: background-color 120ms ease, color 120ms ease;
}
.w14cd-nav:hover { background: var(--w14-parchment-3); color: var(--w14-ink); }
.w14cd-nav:focus-visible {
  outline: 2px solid var(--w14-focus-ring);
  outline-offset: -2px;
}`;

/** Berlin wall-clock `HH:MM` — the footer's "current time" (ADR-0019 §1). */
function berlinTime(): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'w14.control.theme';

/** OS-aware initial theme (mirrors the POS), persisted across launches. */
function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const groupHeaderStyle: CSSProperties = {
  padding: '16px 18px 6px',
  fontSize: '0.66rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  fontFamily: 'var(--w14-font-display)',
};

export function App(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const { path, navigate } = useHashRoute();
  const [connection, setConnection] = useState<ConnectionState>('unbekannt');
  const [clock, setClock] = useState<string>(() => berlinTime());
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    const id = setInterval(() => setClock(berlinTime()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const checkConnection = useCallback(() => {
    client
      .request<{ ok?: boolean }>('GET', '/health')
      .then(() => setConnection('verbunden'))
      .catch(() => setConnection('nicht erreichbar'));
  }, [client]);

  useEffect(() => {
    checkConnection();
    const id = setInterval(checkConnection, 30_000);
    return () => clearInterval(id);
  }, [checkConnection]);

  const active = resolveSurface(path);
  const ActiveComponent = active.Component;

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--w14-parchment)', color: 'var(--w14-ink)' }}>
      <style>{SHELL_CSS}</style>

      {/* ── Left sidebar — the Karteikasten index ──────────────────────── */}
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--w14-parchment-2)',
          borderRight: '1px solid var(--w14-ink-faded)',
        }}
      >
        {/* Brand mark. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '18px 18px 16px',
            borderBottom: '1px solid var(--w14-ink-faded)',
          }}
        >
          <Seal label="14" size="sm" tone="ink" title="Warehouse14 Control" />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontSize: '1.02rem',
                fontWeight: 500,
                letterSpacing: '0.02em',
              }}
            >
              Warehouse 14
            </span>
            <span
              className="w14-smallcaps"
              style={{ fontSize: '0.66rem', letterSpacing: '0.16em', color: 'var(--w14-ink-faded)' }}
            >
              Verwaltung
            </span>
          </div>
        </div>

        {/* Grouped navigation. */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 0 12px' }} aria-label="Bereiche">
          {GROUP_ORDER.map((group) => {
            const items = SURFACES.filter((s) => s.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <div style={groupHeaderStyle}>{group}</div>
                {items.map((surface) => {
                  const isActive = surface.path === active.path;
                  return (
                    <button
                      key={surface.path}
                      type="button"
                      className="w14cd-nav"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => navigate(surface.path)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 18px',
                        border: 'none',
                        borderLeft: `3px solid ${isActive ? 'var(--w14-gold)' : 'transparent'}`,
                        background: isActive ? 'var(--w14-parchment-3)' : 'transparent',
                        color: isActive ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                        cursor: 'pointer',
                        fontFamily: 'var(--w14-font-display)',
                        fontSize: '0.95rem',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          fontFamily: 'var(--w14-font-mono, monospace)',
                          fontSize: '0.72rem',
                          minWidth: 18,
                          textAlign: 'right',
                          color: isActive ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {surface.digit}
                      </span>
                      {surface.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* System footer — live connection, clock, theme. */}
        <div style={{ borderTop: '1px solid var(--w14-ink-faded)', padding: '12px 14px 14px' }}>
          <button
            type="button"
            className="w14cd-focusable"
            onClick={checkConnection}
            title={`API: ${baseUrl}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              background: 'none',
              border: 'none',
              padding: '4px 4px 8px',
              cursor: 'pointer',
              color: 'var(--w14-ink)',
              fontFamily: 'var(--w14-font-display)',
            }}
          >
            <StatusDot tone={CONNECTION_TONE[connection]} size={9} label={CONNECTION_LABEL[connection]} />
            <span style={{ fontSize: '0.82rem' }}>{CONNECTION_LABEL[connection]}</span>
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.82rem',
                color: 'var(--w14-ink-faded)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {clock}
            </span>
          </button>
          <button
            type="button"
            className="w14cd-focusable"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Zu heller Ansicht wechseln' : 'Zu dunkler Ansicht wechseln'}
            aria-label={theme === 'dark' ? 'Helle Ansicht' : 'Dunkle Ansicht'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              background: 'none',
              border: '1px solid var(--w14-ink-faded)',
              borderRadius: 'var(--w14-radius-button)',
              padding: '7px 12px',
              cursor: 'pointer',
              color: 'var(--w14-ink)',
              fontFamily: 'var(--w14-font-display)',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: '0.95rem', lineHeight: 1 }}>
              {theme === 'dark' ? '☾' : '☀'}
            </span>
            <span className="w14-smallcaps" style={{ fontSize: '0.78rem' }}>
              {theme === 'dark' ? 'Dunkle Ansicht' : 'Helle Ansicht'}
            </span>
          </button>
        </div>
      </aside>

      {/* ── Content column ─────────────────────────────────────────────── */}
      <main style={{ flex: 1, height: '100vh', overflowY: 'auto' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '38px 48px 64px' }}>
          <ActiveComponent key={active.path} />
        </div>
      </main>

      {/* Global PIN re-confirmation — opens on any STEP_UP_REQUIRED. */}
      <StepUpModal />

      {/* Auto-update notice — gold banner when a new version is available. */}
      <UpdateBanner />
    </div>
  );
}
