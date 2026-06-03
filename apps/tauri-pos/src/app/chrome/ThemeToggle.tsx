/**
 * ThemeToggle — a small fixed-position light/dark switch, always reachable
 * (login screen + every authenticated surface). Self-positioning so it can be
 * mounted once at the App root.
 */

import { useState } from 'react';

import { type Theme, getTheme, toggleTheme } from '../../lib/theme.js';

export function ThemeToggle(): JSX.Element {
  const [theme, setThemeState] = useState<Theme>(getTheme());

  return (
    <button
      type="button"
      onClick={() => setThemeState(toggleTheme())}
      title={theme === 'dark' ? 'Heller Modus' : 'Dunkler Modus'}
      aria-label="Darstellung umschalten"
      className="w14-smallcaps"
      style={{
        position: 'fixed',
        top: 14,
        right: 14,
        zIndex: 1000,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontSize: '0.72rem',
        color: 'var(--w14-ink-faded)',
        background: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
        boxShadow: 'var(--w14-shadow-card)',
      }}
    >
      {theme === 'dark' ? '☀ Hell' : '☾ Dunkel'}
    </button>
  );
}
