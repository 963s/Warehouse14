/**
 * CustomerListPanel — left column of Kunden (Day 10).
 *
 * Debounced 240ms search; status filter chips at top (Alle / KYC ✓ / VIP /
 * Verdächtig / Gesperrt). Result rows render as compact cards with KYC
 * chip + cumulative Ankauf. Clicking a row updates the URL search-param
 * (via parent's `onSelect`) which drives the detail panel.
 *
 * Row component is memoised on `(row, selected)` — re-renders only when
 * the row itself changes or selection moves. Filter toggles do NOT
 * re-render unrelated rows.
 */

import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from 'react';

import {
  type CustomerListQuery,
  type CustomerListRow,
  customersApi,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  MagnifierIcon,
  MoneyAmount,
  ParchmentCard,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

type FilterTab = 'ALL' | 'KYC_VERIFIED' | 'VIP' | 'WATCHLIST' | 'BLOCKED';

const FILTER_CHIPS: Array<{ value: FilterTab; label: string }> = [
  { value: 'ALL', label: 'Alle' },
  { value: 'KYC_VERIFIED', label: 'KYC ✓' },
  { value: 'VIP', label: 'VIP' },
  { value: 'WATCHLIST', label: 'Verdächtig' },
  { value: 'BLOCKED', label: 'Gesperrt' },
];

export interface CustomerListPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function CustomerListPanel({ selectedId, onSelect }: CustomerListPanelProps): JSX.Element {
  const api = useApiClient();
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedQ, setDebouncedQ] = useState<string>('');
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 240);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [searchInput]);

  const queryArgs = useMemo(() => {
    const args: CustomerListQuery = { limit: 30 };
    if (debouncedQ.length > 0) args.q = debouncedQ;
    if (filter === 'KYC_VERIFIED') args.kycVerifiedOnly = true;
    if (filter === 'BLOCKED' || filter === 'WATCHLIST') {
      args.excludeBlocked = false; // surface them so Owner can act
    } else if (filter === 'VIP') {
      // V1 backend exposes no trustLevel filter directly; we filter client-side below.
      args.kycVerifiedOnly = true;
    }
    return args;
  }, [debouncedQ, filter]);

  const q = useQuery({
    queryKey: ['customers', 'list', queryArgs],
    queryFn: () => customersApi.list(api, queryArgs),
    staleTime: 30_000,
  });

  // Client-side post-filter for the three trust-based tabs (the backend's
  // /api/customers/q exposes excludeBlocked but not a trust filter directly).
  const items = useMemo(() => {
    const raw = q.data?.items ?? [];
    switch (filter) {
      case 'VIP':
        return raw.filter((c) => c.trustLevel === 'VIP');
      case 'WATCHLIST':
        return raw.filter((c) => c.trustLevel === 'SUSPICIOUS');
      case 'BLOCKED':
        return raw.filter((c) => c.trustLevel === 'BANNED' || c.sanctionsMatch);
      default:
        return raw;
    }
  }, [q.data, filter]);

  return (
    <section
      aria-label="Kundenliste"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 16,
        gap: 12,
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
          }}
        >
          Kundenakte
        </h2>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
        >
          {q.isFetching ? 'sucht…' : `${items.length}`}
        </span>
      </header>

      {/* Search */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          backgroundColor: 'var(--w14-parchment-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <MagnifierIcon size={20} tone="ink" />
        <input
          type="text"
          value={searchInput}
          onChange={(ev) => setSearchInput(ev.target.value)}
          placeholder="Name · E-Mail · Telefon"
          spellCheck={false}
          autoFocus
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.92rem',
            color: 'var(--w14-ink)',
          }}
        />
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTER_CHIPS.map((chip) => (
          <FilterChip
            key={chip.value}
            label={chip.label}
            active={filter === chip.value}
            onClick={() => setFilter(chip.value)}
          />
        ))}
      </div>

      {/* Results */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {q.isError ? (
          <ErrorBanner />
        ) : items.length === 0 ? (
          <EmptyHint hasQuery={debouncedQ.length > 0} />
        ) : (
          items.map((row) => (
            <CustomerRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onClick={() => onSelect(row.id)}
            />
          ))
        )}
      </div>

      {selectedId && (
        <Button variant="ghost" size="md" onClick={() => onSelect(null)}>
          Auswahl aufheben
        </Button>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Row — memoised
// ────────────────────────────────────────────────────────────────────────

interface CustomerRowProps {
  row: CustomerListRow;
  selected: boolean;
  onClick: () => void;
}

const CustomerRow = memo(
  function CustomerRow({ row, selected, onClick }: CustomerRowProps): JSX.Element {
    const blocked = row.sanctionsMatch || row.trustLevel === 'BANNED';
    const verified = row.kycVerifiedAt !== null;

    const cardStyle: CSSProperties = {
      cursor: 'pointer',
      border: selected
        ? '1px solid var(--w14-gold)'
        : blocked
          ? '1px solid var(--w14-wax-red)'
          : '1px solid transparent',
      background: selected ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
      opacity: blocked ? 0.7 : 1,
      transition:
        'background-color var(--w14-dur-short) var(--w14-ease-curator), border-color var(--w14-dur-short) var(--w14-ease-curator)',
    };

    return (
      <ParchmentCard padding="sm" onClick={onClick} style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: '0.98rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {row.fullName}
            </div>
            <div
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.74rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {row.customerNumber}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <TrustChip
              kycVerified={verified}
              trust={row.trustLevel}
              sanctions={row.sanctionsMatch}
            />
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.72rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Ank. <MoneyAmount valueEur={row.cumulativeAnkaufEur} />
            </span>
          </div>
        </div>
      </ParchmentCard>
    );
  },
  (prev, next) => prev.selected === next.selected && prev.row === next.row,
);

function TrustChip({
  kycVerified,
  trust,
  sanctions,
}: {
  kycVerified: boolean;
  trust: 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED';
  sanctions: boolean;
}): JSX.Element {
  if (sanctions) {
    return <Chip color="var(--w14-wax-red)">Sanktion</Chip>;
  }
  if (trust === 'BANNED') return <Chip color="var(--w14-wax-red)">gesperrt</Chip>;
  if (trust === 'SUSPICIOUS') return <Chip color="var(--w14-wax-red)">beobachten</Chip>;
  if (trust === 'VIP') return <Chip color="var(--w14-gold)">◆◆ VIP</Chip>;
  if (kycVerified) return <Chip color="var(--w14-gold)">KYC ✓</Chip>;
  return <Chip color="var(--w14-ink-faded)">ohne KYC</Chip>;
}

function Chip({ color, children }: { color: string; children: React.ReactNode }): JSX.Element {
  return (
    <span className="w14-smallcaps" style={{ fontSize: '0.72rem', color, letterSpacing: '0.08em' }}>
      {children}
    </span>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w14-smallcaps"
      style={{
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.74rem',
        letterSpacing: '0.08em',
        padding: '4px 10px',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function EmptyHint({ hasQuery }: { hasQuery: boolean }): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <DiamondRule />
      <p
        style={{
          margin: '8px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.92rem',
        }}
      >
        {hasQuery
          ? 'Keine Treffer für diese Suche.'
          : 'Geben Sie Name oder Kontakt ein,\num einen Kunden zu finden.'}
      </p>
    </ParchmentCard>
  );
}

function ErrorBanner(): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
      <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
        Kundenliste konnte nicht geladen werden.
      </p>
    </ParchmentCard>
  );
}
