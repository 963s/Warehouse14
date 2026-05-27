/**
 * router — react-router-dom v6 derived from the surface-registry.
 *
 * Single source: surface-registry.SURFACES. Adding a screen is one
 * append; the router picks it up automatically.
 *
 *   /            → redirect to HOME_PATH (/werkstatt)
 *   /werkstatt   → AppShell > Werkstatt
 *   /verkauf     → AppShell > Verkauf
 *   …            (all 15 surfaces)
 *   *            → fallback to home
 *
 * Uses BrowserRouter because Tauri's webview supports the history API.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './chrome/AppShell.js';
import { HOME_PATH, SURFACES } from './chrome/surface-registry.js';

export function AppRouter(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={HOME_PATH} replace />} />
          {SURFACES.map((s) => {
            const Component = s.component;
            return (
              <Route
                key={s.path}
                path={s.path}
                element={<Component />}
              />
            );
          })}
          <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
