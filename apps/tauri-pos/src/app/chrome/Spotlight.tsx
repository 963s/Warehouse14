/**
 * Spotlight — the Cmd+K palette. The only chord shortcut Warehouse14 ships.
 *
 * Locked by memory.md §11.6:
 *   • centred parchment-2 modal, 560 px wide, marbled-noise overlay
 *   • monospaced input with gold underline on focus
 *   • three groups separated by <DiamondRule>:
 *       Zuletzt   — last 3 visited (from recents-store)
 *       Karteikasten — 8 Tier 1 surfaces
 *       Weitere   — 7 Tier 2 surfaces
 *   • ↑ / ↓ + Enter to navigate; Esc dismisses
 *   • mouse hover synchronises with keyboard focus (no dual focus model)
 *   • empty input → all results visible; non-empty input → fuzzy filter
 *     across `label`, `description`, and `searchAliases`
 *
 * Entity search (customers / products / appraisals) lives in Phase 1.5 #I-32.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { DiamondRule, MagnifierIcon, ParchmentCard } from '@warehouse14/ui-kit';

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

interface ResultRow {
  surface: SurfaceDescriptor;
  group: 'zuletzt' | 'karteikasten' | 'weitere';
}

function matches(s: SurfaceDescriptor, query: string): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase().trim();
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.description.toLowerCase().includes(q)) return true;
  if (s.path.toLowerCase().includes(q)) return true;
  if (s.searchAliases?.some((a) => a.toLowerCase().includes(q))) return true;
  if (s.digit !== undefined && String(s.digit) === q) return true;
  return false;
}

export function Spotlight({ open, onClose }: SpotlightProps): JSX.Element | null {
  const navigate = useNavigate();
  const recents = useRecents((s) => s.paths);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState<string>('');
  const [activeIdx, setActiveIdx] = useState<number>(0);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Focus runs after the next paint so the input is mounted.
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const rows: ResultRow[] = useMemo(() => {
    const acc: ResultRow[] = [];

    // Zuletzt — only when no query (the recents list otherwise becomes noise).
    if (query.length === 0) {
      for (const path of recents) {
        const s = findSurfaceByPath(path);
        if (s) acc.push({ surface: s, group: 'zuletzt' });
      }
    }
    for (const s of PRIMARY_SURFACES) {
      if (matches(s, query)) acc.push({ surface: s, group: 'karteikasten' });
    }
    for (const s of SECONDARY_SURFACES) {
      if (matches(s, query)) acc.push({ surface: s, group: 'weitere' });
    }
    return acc;
  }, [query, recents]);

  // Keep activeIdx in range when the result set shrinks.
  useEffect(() => {
    if (activeIdx >= rows.length) setActiveIdx(Math.max(0, rows.length - 1));
  }, [activeIdx, rows.length]);

  const activate = (row: ResultRow | undefined): void => {
    if (!row) return;
    navigate(row.surface.path);
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
        setActiveIdx((i) => Math.min(rows.length - 1, i + 1));
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        activate(rows[activeIdx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // We deliberately depend on rows + activeIdx so Enter sees fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, activeIdx, onClose]);

  if (!open) return null;

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
      {/* Backdrop — a real button so click- and keyboard-dismiss are equivalent
          and it is announced as a control rather than a bare clickable div. */}
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
        // Stop the click from bubbling to the backdrop; this card is the dialog
        // surface, not a control, so no keyboard handler is needed here.
        onClick={(ev) => ev.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(560px, 92vw)',
          boxShadow: 'var(--w14-shadow-modal)',
          overflow: 'hidden',
        }}
      >
        {/* Input row */}
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
            placeholder="Suchen…"
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
              color: 'var(--w14-ink-faded)',
              border: '1px solid var(--w14-rule)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            Esc
          </span>
        </div>

        {/* Results */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {rows.length === 0 ? (
            <EmptyState />
          ) : (
            <ResultList
              rows={rows}
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
      <p
        style={{
          margin: '8px 0 0',
          color: 'var(--w14-ink-faded)',
          fontSize: '0.78rem',
        }}
      >
        Nichts gefunden.
      </p>
    </div>
  );
}

function ResultList({
  rows,
  activeIdx,
  onHover,
  onActivate,
}: {
  rows: ResultRow[];
  activeIdx: number;
  onHover: (i: number) => void;
  onActivate: (row: ResultRow) => void;
}): JSX.Element {
  // Compute group boundaries so we render a <DiamondRule> between them.
  const groupBoundaries: number[] = [];
  let lastGroup: string | null = null;
  rows.forEach((row, i) => {
    if (row.group !== lastGroup) {
      groupBoundaries.push(i);
      lastGroup = row.group;
    }
  });

  // Each row is a real <button> (ResultRowItem), so we use a plain semantic
  // list rather than the ARIA listbox/option pattern — layering listbox roles
  // on top of focusable buttons is contradictory. Keyboard navigation is driven
  // by the global keydown handler + `active`, and the active row is exposed via
  // aria-current on the button itself.
  return (
    <ul style={{ listStyle: 'none', padding: '8px 0', margin: 0 }}>
      {rows.map((row, i) => {
        const startsGroup = groupBoundaries.includes(i);
        return (
          <li key={`${row.group}-${row.surface.path}`} style={{ listStyle: 'none' }}>
            {startsGroup && (
              <div style={{ padding: '8px 16px 2px' }}>
                <GroupLabel group={row.group} />
              </div>
            )}
            <ResultRowItem
              row={row}
              active={i === activeIdx}
              onMouseEnter={() => onHover(i)}
              onClick={() => onActivate(row)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function GroupLabel({ group }: { group: ResultRow['group'] }): JSX.Element {
  const label =
    group === 'zuletzt' ? 'Zuletzt' : group === 'karteikasten' ? 'Karteikasten' : 'Weitere';
  return (
    <div style={{ padding: '6px 0' }}>
      <DiamondRule label={label} />
    </div>
  );
}

function ResultRowItem({
  row,
  active,
  onMouseEnter,
  onClick,
}: {
  row: ResultRow;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}): JSX.Element {
  const { surface } = row;
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
          color: surface.digit !== undefined ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          minWidth: 16,
        }}
      >
        {surface.digit ?? '◆'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '0.95rem',
          }}
        >
          {surface.label}
        </span>
        <span
          style={{
            color: 'var(--w14-ink-faded)',
            fontSize: '0.78rem',
          }}
        >
          {surface.description}
        </span>
      </div>
      <span
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.72rem',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {surface.path}
      </span>
    </button>
  );
}
