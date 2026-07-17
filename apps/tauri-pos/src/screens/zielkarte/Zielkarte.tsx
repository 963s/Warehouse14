/**
 * Zielkarte — the owner's live "treasure board" of goals (Tier-2 surface).
 *
 * A deliberate dark instrument panel over the same live sources the Werkstatt
 * dashboard reads (bridge · finance · inventory · metals · fixed costs), folded
 * into vector gauges. Every value is a real endpoint number; an unreadable
 * source draws a calm locked instrument, never a fabricated figure.
 *
 * Ported into tauri-pos as a pure ADDITION (nothing removed). The data layer +
 * instruments are self-contained under ./; this screen only lays them out.
 */

import { DiamondRule } from '@warehouse14/ui-kit';

import { C, GoalTile, GoalsScroll, TreasureMapPanel } from './instruments.js';
import { useZielkarteBoard } from './zielkarte-data.js';

export function Zielkarte(): JSX.Element {
  const board = useZielkarteBoard();

  return (
    <div style={{ padding: 20 }}>
      <DiamondRule tone="gold" label="Zielkarte" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 8,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: '0.9rem', maxWidth: 640, lineHeight: 1.5 }}>
          Die Ziele des Hauses als lebendige Instrumententafel. Jeder Zeiger liest denselben
          Live-Wert wie die Übersicht, das Ziel daneben ist der Richtwert. Ein noch nicht lesbarer
          Wert zeigt ein ruhiges, gesperrtes Instrument statt einer erfundenen Zahl.
        </p>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--w14-ink-faded)',
            fontSize: '0.8rem',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: board.isFetching ? 'var(--w14-gold, #c9a55c)' : '#74c07a',
              display: 'inline-block',
            }}
          />
          {board.isFetching ? 'Aktualisiert …' : 'Live · alle 30 s'}
        </span>
      </div>

      {/* The dark instrument-panel canvas. */}
      <div
        style={{
          position: 'relative',
          background: `radial-gradient(140% 120% at 50% 0%, #17140d, ${C.page} 70%)`,
          borderRadius: 16,
          border: `1px solid ${C.edge}`,
          padding: 18,
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 0 rgba(255,240,200,0.05), 0 8px 26px rgba(0,0,0,0.35)',
        }}
      >
        {/* faint brushed-panel grain over the whole console */}
        <svg
          aria-hidden="true"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 16, pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.5 }}
        >
          <filter id="ziel_boardnoise">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.32  0 0 0 0.5 0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#ziel_boardnoise)" />
        </svg>
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
            gap: 14,
          }}
        >
          {board.metrics.map((m) => (
            <GoalTile key={m.id} metric={m} />
          ))}
        </div>

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 14,
            marginTop: 14,
          }}
        >
          <GoalsScroll bars={board.monthlyBars} />
          <TreasureMapPanel overall={board.overall} available={board.overallAvailable} />
        </div>
      </div>
    </div>
  );
}
