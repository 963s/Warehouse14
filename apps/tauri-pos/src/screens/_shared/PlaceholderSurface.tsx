/**
 * PlaceholderSurface — minimal brand-themed scaffold for the screens that
 * have not yet been implemented. Each surface is one ~30-line file that
 * re-exports this with surface-specific props. As real screens land in
 * Phase 2 Day 5+ they replace these one by one.
 */

import type { ReactNode } from 'react';

import { DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

export interface PlaceholderSurfaceProps {
  digit?: number;
  title: string;
  motto?: string;
  /** Optional extra content rendered below the diamond rule. */
  children?: ReactNode;
}

export function PlaceholderSurface({
  digit,
  title,
  motto = 'Bald geöffnet.',
  children,
}: PlaceholderSurfaceProps): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 32,
      }}
    >
      <ParchmentCard
        padding="lg"
        style={{ width: 'min(640px, 100%)', textAlign: 'center' }}
      >
        <Seal size="lg" tone="faded" label={digit !== undefined ? String(digit) : '14'} />
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '2rem',
            margin: '20px 0 4px',
          }}
        >
          {title}
        </h1>
        <DiamondRule />
        <p
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            color: 'var(--w14-ink-faded)',
            margin: 0,
            fontSize: '1.05rem',
          }}
        >
          {motto}
        </p>
        {children && <div style={{ marginTop: 28 }}>{children}</div>}
      </ParchmentCard>
    </div>
  );
}
