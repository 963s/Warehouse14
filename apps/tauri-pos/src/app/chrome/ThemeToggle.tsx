/**
 * ThemeToggle — an icon-only light/dark switch. Renders INLINE (no fixed
 * positioning) so it docks cleanly into the header controls or a login-screen
 * corner instead of floating over the buttons beneath it.
 */

import { useState } from 'react';

import { type Theme, getTheme, toggleTheme } from '../../lib/theme.js';

export function ThemeToggle(): JSX.Element {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setThemeState(toggleTheme())}
      title={dark ? 'Heller Modus' : 'Dunkler Modus'}
      aria-label="Darstellung umschalten"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        flex: '0 0 auto',
        fontSize: '1rem',
        lineHeight: 1,
        color: 'var(--w14-ink-faded)',
        background: 'transparent',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
    </button>
  );
}
