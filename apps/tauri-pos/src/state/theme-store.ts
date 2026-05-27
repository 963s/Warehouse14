/**
 * theme-store — light / midnight-vellum toggle.
 *
 * Mirrors the `data-theme` attribute on <html>. `Cmd+Shift+D` toggles
 * (registered in AppShell). The preference persists across reloads via
 * localStorage so a single operator's choice survives a Tauri restart.
 */

import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'w14.theme';

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // Honour the OS preference on first launch.
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readInitial(),
  toggle: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light';
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    set({ theme: next });
  },
  set: (theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
    set({ theme });
  },
}));
