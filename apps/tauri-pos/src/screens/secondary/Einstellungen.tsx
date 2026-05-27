/**
 * Einstellungen — operator settings hub.
 *
 * V1 ships ONE tab: Hardware & Kasse (the new Gerätemanager). Future
 * tabs (Operator-Profile, mTLS-Geräte, Belegtext-Vorlagen) will join
 * the same chip-row pattern — keep the layout intentional now so the
 * second tab is a 10-line PR.
 */

import { useState } from 'react';

import { DiamondRule, Seal } from '@warehouse14/ui-kit';

import { GeraeteManager } from './GeraeteManager.js';

type Tab = 'hardware';

export function Einstellungen(): JSX.Element {
  const [tab, setTab] = useState<Tab>('hardware');

  return (
    <section
      aria-label="Einstellungen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          padding: '20px 20px 0',
        }}
      >
        <Seal size="sm" tone="ink" label="○" />
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.5rem',
          }}
        >
          Einstellungen
        </h1>
        <nav
          aria-label="Tabs"
          style={{ display: 'flex', gap: 6, marginLeft: 18 }}
        >
          <TabChip active={tab === 'hardware'} label="Hardware & Kasse" onClick={() => setTab('hardware')} />
        </nav>
      </header>

      <div style={{ padding: '8px 20px 0' }}>
        <DiamondRule />
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'hardware' && <GeraeteManager />}
      </div>
    </section>
  );
}

function TabChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w14-smallcaps"
      style={{
        padding: '4px 12px',
        fontFamily: 'var(--w14-font-display)',
        letterSpacing: '0.08em',
        fontSize: '0.78rem',
        backgroundColor: active ? 'var(--w14-gold)' : 'var(--w14-parchment-2)',
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 999,
        cursor: 'pointer',
      }}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
