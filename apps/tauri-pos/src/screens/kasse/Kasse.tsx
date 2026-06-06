/**
 * Kasse — Tier-1 surface #4 (memory.md §11.3).
 *
 * Three sub-views driven by `useCurrentShift`:
 *   • loading              → minimal Splash
 *   • shift === null       → <ShiftOpenPanel/>      (open a new shift)
 *   • shift.status==='OPEN'→ <KassenbuchPanel/>     (live management + Z-Bon)
 *
 * Per §10/§11 the chrome (Karteikasten + sub-breadcrumb if applicable) is
 * owned by AppShell; this file owns ONLY the surface body.
 *
 * Toasts:
 *   • shift opened   → success
 *   • Einlage logged → success
 *   • Entnahme logged→ info
 *   • Z-Bon with variance → wax-red alert
 *   • Z-Bon clean    → success
 */

import { DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';

import { KassePurposeBanner } from './KassePurposeBanner.js';
import { KassenbuchPanel } from './KassenbuchPanel.js';
import { ShiftOpenPanel } from './ShiftOpenPanel.js';

export function Kasse(): JSX.Element {
  const { data, isLoading } = useCurrentShift();

  if (isLoading && data === undefined) return <KasseLoadingSplash />;

  // The purpose banner sits above BOTH sub-views — the owner has to meet the
  // "Tageskasse ≠ checkout" concept no matter which state the day is in.
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 32px 0' }}>
        <KassePurposeBanner />
      </div>
      {data === null || data === undefined ? <ShiftOpenPanel /> : <KassenbuchPanel shift={data} />}
    </div>
  );
}

function KasseLoadingSplash(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 32,
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <Seal size="md" tone="faded" label="4" />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: '14px 0 4px',
            fontSize: '1.4rem',
          }}
        >
          Kasse wird geprüft…
        </h2>
        <DiamondRule />
      </ParchmentCard>
    </div>
  );
}
