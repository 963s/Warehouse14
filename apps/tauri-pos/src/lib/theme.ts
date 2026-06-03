/**
 * Theme — light / dark ("midnight-vellum"). The palette lives entirely in
 * ui-kit tokens.css under `:root[data-theme="dark"]`; we just flip the
 * `data-theme` attribute on <html> and persist the choice.
 */

const STORAGE_KEY = 'warehouse14.theme';

export type Theme = 'light' | 'dark';

export function getTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // private mode / quota — non-fatal, the in-page attribute still applies.
  }
  applyTheme(theme);
}

/** Apply the persisted theme on cold boot (call once, before first paint). */
export function initTheme(): void {
  applyTheme(getTheme());
}

/** Flip light↔dark, persist, and return the new value. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
