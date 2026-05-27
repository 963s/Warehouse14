/**
 * Edelmetallkurs mini-panel — Werkstatt left column, beneath the Übersicht.
 *
 *   ◆ Edelmetallkurs
 *   Gold        62,5000 €/g
 *   Silber       0,8000 €/g
 *   Platin      29,4500 €/g
 *   Palladium   40,0000 €/g
 *
 * Renders the current per-gram prices from the dashboard summary. When a
 * `metal_price.*` event lands on the SSE feed, the `pulse` counter in the
 * ledger-feed-store ticks; the panel watches a derived "freshness" flag
 * for ~600 ms and pulses the gold marker.
 *
 * The values are NUMERIC(15,4) strings on the wire — we render to 4 decimals
 * with German locale separators using JetBrains Mono for the columns.
 */

import { useEffect, useRef, useState } from 'react';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import type { DashboardSummary } from '@warehouse14/api-client';

import { selectPulse, useLedgerFeed } from '../../state/ledger-feed-store.js';

export interface EdelmetallkursPanelProps {
  data: DashboardSummary | undefined;
  isLoading: boolean;
}

const METAL_LABELS: Array<{ key: keyof DashboardSummary['currentMetalPrices']; label: string }> = [
  { key: 'gold',      label: 'Gold' },
  { key: 'silver',    label: 'Silber' },
  { key: 'platinum',  label: 'Platin' },
  { key: 'palladium', label: 'Palladium' },
];

function formatPrice(raw: string | null): string {
  if (!raw) return '—';
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(num);
}

export function EdelmetallkursPanel({
  data,
  isLoading,
}: EdelmetallkursPanelProps): JSX.Element {
  const pulse = useLedgerFeed(selectPulse);
  const [recent, setRecent] = useState(false);
  const lastPulseRef = useRef(pulse);
  const placeholder = isLoading || data === undefined;

  // Flash the gold marker for 600 ms after any new event arrives. The panel
  // does NOT check the event type itself — that lives in the SSE hook's
  // invalidation logic. Here we just react to the dashboard refresh that
  // follows. (For tighter coupling we could subscribe to a per-event-type
  // selector — Phase 1.5 #I-31 if it becomes useful.)
  useEffect(() => {
    if (pulse === lastPulseRef.current) return;
    lastPulseRef.current = pulse;
    setRecent(true);
    const t = window.setTimeout(() => setRecent(false), 600);
    return () => window.clearTimeout(t);
  }, [pulse]);

  return (
    <section aria-label="Edelmetallkurs" style={{ marginTop: 24 }}>
      <DiamondRule label="Edelmetallkurs" />
      <ParchmentCard tone="deep" padding="md">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            rowGap: 8,
            columnGap: 16,
            alignItems: 'baseline',
          }}
        >
          {METAL_LABELS.map(({ key, label }) => (
            <RowSlot
              key={key}
              label={label}
              value={placeholder ? '—' : formatPrice(data!.currentMetalPrices[key])}
            />
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.82rem',
          }}
        >
          <span>€/Gramm · LBMA-Verkettung</span>
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: recent ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
                opacity: recent ? 1 : 0.4,
                transition: 'opacity 280ms var(--w14-ease-curator),' +
                            ' background-color 280ms var(--w14-ease-curator)',
              }}
            />
            {recent ? 'soeben' : 'still'}
          </span>
        </div>
      </ParchmentCard>
    </section>
  );
}

function RowSlot({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <span
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-faded)',
          fontSize: '0.85rem',
        }}
      >
        {label}
      </span>
      <span style={{ borderBottom: '1px dotted var(--w14-rule)', opacity: 0.35, alignSelf: 'end' }} />
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.95rem',
        }}
      >
        {value}
      </span>
    </>
  );
}
