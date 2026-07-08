/**
 * Persistent footer — the salon counter readout.
 *
 *   N° XLVII · Heute · Shift OPEN · €4.231,42
 *
 * Always reads from the dashboard summary (so it stays consistent with
 * the tiles above). Shift status renders as ink-aged when closed,
 * gold when open, wax-red when missing.
 */

import { MoneyAmount, RomanIndex } from '@warehouse14/ui-kit';

export interface WerkstattFooterProps {
  currentShiftId: string | null;
  revenueEur: string;
  /** Monotonic counter — the daily transaction tally, lifted from useDashboardSummary. */
  counterValue: number;
}

export function WerkstattFooter({
  currentShiftId,
  revenueEur,
  counterValue,
}: WerkstattFooterProps): JSX.Element {
  const shiftLabel = currentShiftId ? 'Shift OPEN' : 'Shift -';
  const shiftColor = currentShiftId ? 'var(--w14-gold)' : 'var(--w14-ink-faded)';

  return (
    <footer
      style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--w14-parchment-2)',
        borderTop: '1px solid var(--w14-rule)',
        padding: 'var(--space-3) var(--space-7)',
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.95rem',
        color: 'var(--w14-ink-aged)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <RomanIndex value={counterValue || 1} tone="ink" />
        <span style={{ color: 'var(--w14-ink-faded)' }}>Heute</span>
      </div>
      <div
        style={{
          color: shiftColor,
          fontVariant: 'all-small-caps',
          letterSpacing: '0.12em',
        }}
      >
        {shiftLabel}
      </div>
      <div style={{ justifySelf: 'end' }}>
        <MoneyAmount valueEur={revenueEur} emphasis />
      </div>
    </footer>
  );
}
