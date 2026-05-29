/**
 * LagerTable — sticky-header data table for the Lager surface (Day 9).
 *
 * Layout: CSS grid (NOT a real <table>) so we get sticky-header behaviour
 * without DOM acrobatics. Each row is its own memoised component keyed on
 * product id — a single product mutation re-renders that row only.
 *
 * Columns: SKU · Name · Status · Kategorie · Lagerort · Preis.
 * Monospaced (`var(--w14-font-mono)`) for SKU, barcode, price, location.
 * Display-serif (`var(--w14-font-display)`) for Name + small-caps headers.
 *
 * For V1 catalog sizes (< 5k rows) plain rendering is fast enough — see
 * memory.md §13.2. Phase 1.5 #I-46 wraps with `@tanstack/react-virtual`.
 */

import { type CSSProperties, memo } from 'react';

import type { ProductListRow } from '@warehouse14/api-client';
import { MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

const STATUS_LABEL: Record<ProductListRow['status'], string> = {
  DRAFT: 'Entwurf',
  AVAILABLE: 'Verfügbar',
  RESERVED: 'Reserviert',
  SOLD: 'Verkauft',
};

const STATUS_COLOR: Record<ProductListRow['status'], string> = {
  DRAFT: 'var(--w14-ink-faded)',
  AVAILABLE: 'var(--w14-gold)',
  RESERVED: 'var(--w14-ink-aged)',
  SOLD: 'var(--w14-ink-faded)',
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  gold_coin: 'Goldmünze',
  gold_bar: 'Goldbarren',
  gold_jewelry: 'Goldschmuck',
  silver_coin: 'Silbermünze',
  silver_bar: 'Silberbarren',
  silver_jewelry: 'Silberschmuck',
  platinum_coin: 'Platinmünze',
  platinum_bar: 'Platinbarren',
  platinum_jewelry: 'Platinschmuck',
  antique: 'Antiquität',
  watch: 'Uhr',
  other: 'Sonstiges',
};

const GRID_TEMPLATE =
  'minmax(120px, 1fr) minmax(0, 2fr) 110px 130px minmax(140px, 1.2fr) 110px 90px';
const CELL_PADDING = '10px 12px';

export interface LagerTableProps {
  rows: readonly ProductListRow[];
  highlightedId: string | null;
  loading: boolean;
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onRowClick: (row: ProductListRow) => void;
}

export function LagerTable({
  rows,
  highlightedId,
  loading,
  total,
  hasMore,
  onLoadMore,
  onRowClick,
}: LagerTableProps): JSX.Element {
  return (
    <div
      role="region"
      aria-label="Lagerliste"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        background: 'var(--w14-parchment-1)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        position: 'relative',
      }}
    >
      <HeaderRow />
      {rows.length === 0 && !loading ? (
        <EmptyTable />
      ) : (
        rows.map((row) => (
          <LagerRow
            key={row.id}
            row={row}
            highlighted={highlightedId === row.id}
            onClick={onRowClick}
          />
        ))
      )}
      <Footer
        rowsShown={rows.length}
        total={total}
        hasMore={hasMore}
        loading={loading}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Header — sticky via position: sticky on the inner container
// ────────────────────────────────────────────────────────────────────────

function HeaderRow(): JSX.Element {
  const headerStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: GRID_TEMPLATE,
    position: 'sticky',
    top: 0,
    background: 'var(--w14-parchment-2)',
    borderBottom: '1px solid var(--w14-rule)',
    zIndex: 1,
  };
  const cellStyle: CSSProperties = {
    padding: CELL_PADDING,
    fontFamily: 'var(--w14-font-display)',
    fontVariant: 'all-small-caps',
    letterSpacing: '0.08em',
    fontSize: '0.78rem',
    color: 'var(--w14-ink-faded)',
  };
  return (
    <div style={headerStyle}>
      <div style={cellStyle}>SKU · Barcode</div>
      <div style={cellStyle}>Bezeichnung</div>
      <div style={cellStyle}>Status</div>
      <div style={cellStyle}>Kategorie</div>
      <div style={cellStyle}>Lagerort</div>
      <div style={{ ...cellStyle, textAlign: 'right' }}>Preis</div>
      <div style={{ ...cellStyle, textAlign: 'right' }}>Aktion</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Per-row component — memoised on row id + content hash
// ────────────────────────────────────────────────────────────────────────

interface LagerRowProps {
  row: ProductListRow;
  highlighted: boolean;
  onClick: (row: ProductListRow) => void;
}

const LagerRow = memo(
  function LagerRow({ row, highlighted, onClick }: LagerRowProps): JSX.Element {
    const lagerort = [row.locationStorageUnit, row.locationDrawer, row.locationPosition]
      .filter((s): s is string => s !== null && s.length > 0)
      .join(' · ');

    const rowStyle: CSSProperties = {
      display: 'grid',
      gridTemplateColumns: GRID_TEMPLATE,
      borderBottom: '1px solid var(--w14-rule)',
      background: highlighted ? 'var(--w14-parchment-3)' : 'transparent',
      transition: 'background-color var(--w14-dur-short) var(--w14-ease-curator)',
      cursor: 'pointer',
    };
    const cellBase: CSSProperties = {
      padding: CELL_PADDING,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };
    const monoCell: CSSProperties = {
      ...cellBase,
      fontFamily: 'var(--w14-font-mono)',
      fontSize: '0.88rem',
      color: 'var(--w14-ink)',
    };

    return (
      <div
        style={rowStyle}
        onClick={() => onClick(row)}
        role="row"
        data-product-id={row.id}
        data-highlighted={highlighted ? 'true' : 'false'}
      >
        <div style={monoCell}>
          <div className="w14-tabular" style={{ color: 'var(--w14-ink-aged)' }}>
            {row.sku}
          </div>
          {row.barcode && (
            <div style={{ fontSize: '0.72rem', color: 'var(--w14-ink-faded)' }}>{row.barcode}</div>
          )}
        </div>
        <div
          style={{
            ...cellBase,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '0.95rem',
          }}
          title={row.name}
        >
          {row.name}
        </div>
        <div style={{ ...cellBase }}>
          <span
            className="w14-smallcaps"
            style={{
              color: STATUS_COLOR[row.status],
              fontSize: '0.78rem',
              letterSpacing: '0.08em',
            }}
          >
            {STATUS_LABEL[row.status]}
          </span>
          {row.archivedAt && (
            <span
              className="w14-smallcaps"
              style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--w14-wax-red)' }}
            >
              archiviert
            </span>
          )}
        </div>
        <div
          style={{
            ...cellBase,
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.88rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {ITEM_TYPE_LABEL[row.itemType] ?? row.itemType}
        </div>
        <div
          style={{
            ...cellBase,
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.82rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {lagerort || '—'}
        </div>
        <div style={{ ...cellBase, textAlign: 'right' }}>
          <MoneyAmount valueEur={row.listPriceEur} />
        </div>
        <div
          style={{
            ...cellBase,
            textAlign: 'right',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.82rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          anpassen
        </div>
      </div>
    );
  },
  (prev, next) => prev.highlighted === next.highlighted && prev.row === next.row,
);

// ────────────────────────────────────────────────────────────────────────
// Empty + Footer
// ────────────────────────────────────────────────────────────────────────

function EmptyTable(): JSX.Element {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <ParchmentCard padding="lg" style={{ display: 'inline-block', minWidth: 320 }}>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
          }}
        >
          Keine Stücke entsprechen den Filtern.
        </p>
      </ParchmentCard>
    </div>
  );
}

function Footer({
  rowsShown,
  total,
  hasMore,
  loading,
  onLoadMore,
}: {
  rowsShown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        padding: '10px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        background: 'var(--w14-parchment-2)',
        borderTop: '1px solid var(--w14-rule)',
        position: 'sticky',
        bottom: 0,
      }}
    >
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.82rem',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {rowsShown} von {total} Stück{total === 1 ? '' : 'en'}
      </span>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-ink-aged)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.92rem',
            cursor: loading ? 'default' : 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          {loading ? 'Lädt…' : 'weitere laden'}
        </button>
      )}
    </div>
  );
}
