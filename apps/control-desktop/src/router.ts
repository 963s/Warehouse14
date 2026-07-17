/**
 * A tiny, dependency-free hash router for the single-window Control Desktop
 * (Track B0 — replaces the useState + 17-branch ternary that grew unwieldy).
 *
 * Why hash, not a full router library: this is one Tauri window with a flat list
 * of back-office surfaces. A hash route gives everything a "real router" buys us
 * here — URL-addressable surfaces (`#/kunden`), browser back/forward, and a
 * location that survives a reload — with zero new dependency and no nested-route
 * ceremony. The surface registry in `surfaces.tsx` is the single source of truth;
 * the shell just looks up the current path in it.
 */

import { useCallback, useEffect, useState } from 'react';

/** The surface shown at `#/` and for any unknown route. */
export const DEFAULT_PATH = '/uebersicht';

/** Current route path from the URL hash (`#/kunden` → `/kunden`); default when empty. */
function currentHashPath(): string {
  if (typeof window === 'undefined') return DEFAULT_PATH;
  const h = window.location.hash.replace(/^#/, '');
  return h.length > 0 ? h : DEFAULT_PATH;
}

/**
 * Subscribe to the hash route. Returns the current path plus a `navigate` that
 * pushes a new hash (which the browser records in history, so back/forward work).
 */
export function useHashRoute(): { path: string; navigate: (to: string) => void } {
  const [path, setPath] = useState<string>(() => currentHashPath());

  useEffect(() => {
    // Stamp a default hash on first load so the URL is always addressable.
    if (!window.location.hash) window.location.replace(`#${DEFAULT_PATH}`);
    const onChange = (): void => setPath(currentHashPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((to: string): void => {
    if (currentHashPath() !== to) window.location.hash = to;
  }, []);

  return { path, navigate };
}
