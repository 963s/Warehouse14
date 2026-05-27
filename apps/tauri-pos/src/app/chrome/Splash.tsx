/**
 * Splash — the cold-start parchment behind the session probe.
 *
 * Renders the brand seal + italic motto. Stays under ~200 ms on a healthy
 * network — the operator essentially sees a quiet "warming up" beat, then
 * either the login screen (no session) or the Werkstatt (session restored).
 */

import { DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

export function Splash(): JSX.Element {
  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--w14-parchment)',
        padding: 24,
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(380px, 100%)', textAlign: 'center' }}>
        <Seal size="lg" />
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.5rem',
            margin: '16px 0 4px',
          }}
        >
          Warehouse14
        </h1>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
          }}
        >
          Sitzung wird geprüft…
        </p>
        <DiamondRule />
      </ParchmentCard>
    </div>
  );
}
