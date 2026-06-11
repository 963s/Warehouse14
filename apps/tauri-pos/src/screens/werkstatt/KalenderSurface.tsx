/**
 * KalenderSurface — the /kalender secondary surface (Spotlight-only).
 *
 * Full-page fit of the same GoogleKalenderCard the Werkstatt shows in its
 * left column: on 1024px screens the Werkstatt slot is too cramped for a
 * comfortable WEEK view, so Spotlight → „Kalender“ opens it edge-to-edge.
 */

import { GoogleKalenderCard } from './GoogleKalenderCard.js';

export function KalenderSurface(): JSX.Element {
  return (
    <div
      className="w14-paper-noise"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--w14-parchment)',
        padding: 'var(--space-5) var(--space-7) var(--space-6)',
      }}
    >
      <GoogleKalenderCard variant="full" />
    </div>
  );
}
