/**
 * ZielkartePanel — the owner's "treasure board" of live goals (Track B3).
 *
 * A deliberate dark instrument panel (independent of the app's parchment theme)
 * laid over the Übersicht dashboard's own live sources. Ten vector gauges + the
 * month-goal scroll + the overall treasure-map, all fed by `useZielkarteBoard`.
 * Ported and deepened from the mobile /zielkarte route; every value is a real
 * endpoint number, and an unreadable source draws a calm locked instrument.
 */

import { DiamondRule } from '@warehouse14/ui-kit';

import { StatusDot } from '../components/StatusDot.js';
import {
  C,
  GoalTile,
  GoalsScroll,
  TreasureMapPanel,
} from './zielkarte/instruments.js';
import { useZielkarteBoard } from './zielkarte/zielkarte-data.js';

export function ZielkartePanel(): JSX.Element {
  const board = useZielkarteBoard();

  return (
    <>
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
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: '0.9rem', maxWidth: 620, lineHeight: 1.5 }}>
          Die Ziele des Hauses als lebendige Instrumententafel. Jeder Zeiger liest denselben
          Live-Wert wie die Übersicht, das Ziel daneben ist der Richtwert. Ein noch nicht lesbarer
          Wert zeigt ein ruhiges, gesperntes Instrument statt einer erfundenen Zahl.
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
          <StatusDot tone={board.isFetching ? 'watch' : 'ok'} size={9} />
          {board.isFetching ? 'Aktualisiert …' : 'Live · alle 30 s'}
        </span>
      </div>

      {/* The dark instrument-panel canvas. */}
      <div
        style={{
          background: `radial-gradient(140% 120% at 50% 0%, #17140d, ${C.page} 70%)`,
          borderRadius: 16,
          border: `1px solid ${C.edge}`,
          padding: 18,
          boxShadow: 'inset 0 1px 0 rgba(255,240,200,0.05), 0 8px 26px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
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
    </>
  );
}
