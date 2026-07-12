/**
 * Spotlight — the Cmd+K palette. The only chord shortcut Warehouse14 ships.
 *
 * Two kinds of result, in this order:
 *   • Entities — customers and products matching the query, fetched live from
 *     the shared api-client and deep-linked to their surface (`/kunden?id=…`,
 *     `/lager?produkt=…`). This is the one box that spans domains from anywhere.
 *   • Surfaces — the Tier-1 Karteikasten and Tier-2 screens, fuzzy-matched on
 *     label / description / path / aliases, plus the last-visited list when the
 *     input is empty.
 *
 * Entity search covers customers + products because those are the domains with
 * a real detail surface to land on. Transactions have no standalone detail
 * route (recent sales live inside a shift's Kassenbuch), so a transaction hit
 * would deep-link nowhere useful; it is deliberately left out rather than
 * offered as a dead end.
 *
 * ↑ / ↓ + Enter navigate; Esc dismisses; hover syncs with keyboard focus.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { customersApi, productsApi } from '@warehouse14/api-client';
import { DiamondRule, MagnifierIcon, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { formatEur } from '../../lib/decimal.js';
import { useRecents } from '../../state/recents-store.js';
import {
  PRIMARY_SURFACES,
  SECONDARY_SURFACES,
  type SurfaceDescriptor,
  findSurfaceByPath,
} from './surface-registry.js';

export interface SpotlightProps {
  open: boolean;
  onClose: () => void;
}

type SpotGroup = 'zuletzt' | 'kunden' | 'artikel' | 'karteikasten' | 'weitere';

/** One normalized palette row — a surface or a live entity, rendered the same. */
interface SpotItem {
  key: string;
  group: SpotGroup;
  /** Path (with query) to navigate to on activation. */
  navigate: string;
  glyph: string;
  glyphGold: boolean;
  primary: string;
  secondary: string;
  trailing: string;
}

function surfaceMatches(s: SurfaceDescriptor, q: string): boolean {
  if (q.length === 0) return true;
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.description.toLowerCase().includes(q)) return true;
  if (s.path.toLowerCase().includes(q)) return true;
  if (s.searchAliases?.some((a) => a.toLowerCase().includes(q))) return true;
  if (s.digit !== undefined && String(s.digit) === q) return true;
  return false;
}

function surfaceToItem(s: SurfaceDescriptor, group: SpotGroup): SpotItem {
  return {
    key: `surface-${s.path}`,
    group,
    navigate: s.path,
    glyph: s.digit !== undefined ? String(s.digit) : '◆',
    glyphGold: s.digit !== undefined,
    primary: s.label,
    secondary: s.description,
    trailing: s.path,
  };
}

export function Spotlight({ open, onClose }: SpotlightProps): JSX.Element | null {
  const navigate = useNavigate();
  const api = useApiClient();
  const recents = useRecents((s) => s.paths);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState<string>('');
  const [debounced, setDebounced] = useState<string>('');
  const [activeIdx, setActiveIdx] = useState<number>(0);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setActiveIdx(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounce the query that reaches the network (surface filtering stays instant).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const entityEnabled = open && debounced.length >= 2;

  const customersQ = useQuery({
    queryKey: ['spotlight', 'customers', debounced],
    queryFn: () => customersApi.list(api, { q: debounced, limit: 5 }),
    enabled: entityEnabled,
    staleTime: 15_000,
  });

  const productsQ = useQuery({
    queryKey: ['spotlight', 'products', debounced],
    queryFn: () => productsApi.list(api, { q: debounced, limit: 5 }),
    enabled: entityEnabled,
    staleTime: 15_000,
  });

  const items: SpotItem[] = useMemo(() => {
    const q = query.toLowerCase().trim();
    const acc: SpotItem[] = [];

    // Live entities first — they are the answer to a typed name/SKU.
    for (const c of customersQ.data?.items ?? []) {
      acc.push({
        key: `kunde-${c.id}`,
        group: 'kunden',
        navigate: `/kunden?id=${encodeURIComponent(c.id)}`,
        glyph: '☞',
        glyphGold: true,
        primary: c.fullName,
        secondary: `Kunde · ${c.customerNumber}`,
        trailing: 'Kundenakte',
      });
    }
    for (const p of productsQ.data?.items ?? []) {
      acc.push({
        key: `artikel-${p.id}`,
        group: 'artikel',
        navigate: `/lager?produkt=${encodeURIComponent(p.id)}`,
        glyph: '◈',
        glyphGold: true,
        primary: p.name,
        secondary: `${p.sku} · ${formatEur(p.listPriceEur)} €`,
        trailing: 'Artikel',
      });
    }

    // Zuletzt — only when the input is empty (otherwise it is noise).
    if (q.length === 0) {
      for (const path of recents) {
        const s = findSurfaceByPath(path);
        if (s) acc.push(surfaceToItem(s, 'zuletzt'));
      }
    }
    for (const s of PRIMARY_SURFACES) {
      if (surfaceMatches(s, q)) acc.push(surfaceToItem(s, 'karteikasten'));
    }
    for (const s of SECONDARY_SURFACES) {
      if (surfaceMatches(s, q)) acc.push(surfaceToItem(s, 'weitere'));
    }
    return acc;
  }, [query, recents, customersQ.data, productsQ.data]);

  // Keep activeIdx in range when the result set shrinks.
  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(Math.max(0, items.length - 1));
  }, [activeIdx, items.length]);

  const activate = (item: SpotItem | undefined): void => {
    if (!item) return;
    navigate(item.navigate);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setActiveIdx((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        activate(items[activeIdx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Depend on items + activeIdx so Enter sees fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, activeIdx, onClose]);

  if (!open) return null;

  const entitiesLoading = entityEnabled && (customersQ.isFetching || productsQ.isFetching);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'start center',
        paddingTop: '12vh',
      }}
    >
      <button
        type="button"
        aria-label="Suche schließen"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'default',
          backgroundColor: 'var(--w14-overlay)',
        }}
      />
      <ParchmentCard
        role="dialog"
        aria-modal="true"
        aria-label="Suchen"
        padding="none"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(560px, 92vw)',
          boxShadow: 'var(--w14-shadow-modal)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 18px',
            borderBottom: '1px solid var(--w14-rule)',
          }}
        >
          <MagnifierIcon size={22} tone="ink" />
          <input
            ref={inputRef}
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value);
              setActiveIdx(0);
            }}
            placeholder="Suchen: Kunde, Artikel oder Bereich…"
            spellCheck={false}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '1.05rem',
              color: 'var(--w14-ink)',
              borderBottom: '1px solid transparent',
              padding: '4px 0',
              transition: 'border-color 160ms var(--w14-ease-curator)',
            }}
            onFocus={(ev) => {
              (ev.currentTarget as HTMLInputElement).style.borderBottom =
                '1px solid var(--w14-gold)';
            }}
            onBlur={(ev) => {
              (ev.currentTarget as HTMLInputElement).style.borderBottom = '1px solid transparent';
            }}
          />
          <span
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.72rem',
              color: entitiesLoading ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              border: '1px solid var(--w14-rule)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            {entitiesLoading ? 'sucht…' : 'Esc'}
          </span>
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <ResultList
              items={items}
              activeIdx={activeIdx}
              onHover={setActiveIdx}
              onActivate={activate}
            />
          )}
        </div>
      </ParchmentCard>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ padding: '36px 24px', textAlign: 'center' }}>
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '1rem',
        }}
      >
        Was lange ruht, spricht leise.
      </p>
      <p style={{ margin: '8px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}>
        Nichts gefunden.
      </p>
    </div>
  );
}

function ResultList({
  items,
  activeIdx,
  onHover,
  onActivate,
}: {
  items: SpotItem[];
  activeIdx: number;
  onHover: (i: number) => void;
  onActivate: (item: SpotItem) => void;
}): JSX.Element {
  const groupBoundaries: number[] = [];
  let lastGroup: string | null = null;
  items.forEach((item, i) => {
    if (item.group !== lastGroup) {
      groupBoundaries.push(i);
      lastGroup = item.group;
    }
  });

  return (
    <ul style={{ listStyle: 'none', padding: '8px 0', margin: 0 }}>
      {items.map((item, i) => {
        const startsGroup = groupBoundaries.includes(i);
        return (
          <li key={item.key} style={{ listStyle: 'none' }}>
            {startsGroup && (
              <div style={{ padding: '8px 16px 2px' }}>
                <GroupLabel group={item.group} />
              </div>
            )}
            <ResultRowItem
              item={item}
              active={i === activeIdx}
              onMouseEnter={() => onHover(i)}
              onClick={() => onActivate(item)}
            />
          </li>
        );
      })}
    </ul>
  );
}

const GROUP_LABELS: Readonly<Record<SpotGroup, string>> = {
  zuletzt: 'Zuletzt',
  kunden: 'Kunden',
  artikel: 'Artikel',
  karteikasten: 'Karteikasten',
  weitere: 'Weitere',
};

function GroupLabel({ group }: { group: SpotGroup }): JSX.Element {
  return (
    <div style={{ padding: '6px 0' }}>
      <DiamondRule label={GROUP_LABELS[group]} />
    </div>
  );
}

function ResultRowItem({
  item,
  active,
  onMouseEnter,
  onClick,
}: {
  item: SpotItem;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        border: 'none',
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        cursor: 'pointer',
        padding: '10px 18px',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 14,
        alignItems: 'baseline',
        color: 'var(--w14-ink)',
        transition: 'background-color 100ms var(--w14-ease-curator)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.86rem',
          color: item.glyphGold ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          minWidth: 16,
        }}
      >
        {item.glyph}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '0.95rem',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.primary}
        </span>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}>{item.secondary}</span>
      </div>
      <span
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.72rem',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {item.trailing}
      </span>
    </button>
  );
}
