/**
 * LagerTable — sticky-header data table for the Lager surface (Day 9).
 *
 * Layout: CSS grid (NOT a real <table>) so we get sticky-header behaviour
 * without DOM acrobatics. Each row is its own memoised component keyed on
 * product id — a single product mutation re-renders that row only.
 *
 * Columns: Foto · SKU · Bezeichnung · Status · Kategorie · Lagerort · Preis.
 * Monospaced (`var(--w14-font-mono)`) for SKU, barcode, price, location.
 * Display-serif (`var(--w14-font-display)`) for Name + small-caps headers.
 *
 * UX brief (§3 inventory + §5d a11y): calm dense rows ≥56px carrying
 * photo + name + price + location so staff recognise an item by sight while
 * holding it; status is redundantly coded (state dot + colour + German
 * label) so it survives colour-blindness and glare; money is right-aligned
 * `.w14-tabular`. Scan-match rows get a brass left-edge marker + lift so the
 * pinpointed item is unmistakable. Presentation only — no query/mutation
 * logic lives here.
 *
 * For V1 catalog sizes (< 5k rows) plain rendering is fast enough — see
 * memory.md §13.2. Phase 1.5 #I-46 wraps with `@tanstack/react-virtual`.
 */

import { type CSSProperties, memo, useState } from 'react';

import type { ProductListRow } from '@warehouse14/api-client';
import { IconButton, MoneyAmount, ParchmentCard, Trash2 } from '@warehouse14/ui-kit';

import { formatGrams } from '../../lib/decimal.js';
import { itemTypeLabel } from '../../lib/item-type-label.js';
import { PRODUCT_STATUS_COLOR, PRODUCT_STATUS_LABEL } from '../../lib/product-status-label.js';

// Frozen column geometry (brief: spatial stability). Foto thumb · SKU/Barcode ·
// Bezeichnung · Status · Kategorie · Lagerort · Preis · Aktion.
const GRID_TEMPLATE =
  '56px minmax(120px, 1fr) minmax(0, 2fr) 124px 130px minmax(140px, 1.2fr) 116px 132px';
const CELL_PADDING = 'var(--space-3) var(--space-3)';
const ROW_MIN_HEIGHT = 56; // ≥48px dense scan-rows (brief §3).

/** German one-word metal tag for the row's calm secondary scan-line. */
const METAL_LABEL: Readonly<Record<string, string>> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

/**
 * Resolve a product's primary-photo thumb. The API hands back a RELATIVE
 * path (`/api/photos/<id>/thumb`); we prefix it with the api-client baseUrl
 * so the public-by-UUID /thumb route resolves in the Tauri webview — same
 * contract the Verkauf catalog tiles use.
 */
function resolveThumbUrl(baseUrl: string, path: string | null): string | null {
  if (!path) return null;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export interface LagerTableProps {
  rows: readonly ProductListRow[];
  highlightedId: string | null;
  loading: boolean;
  total: number;
  hasMore: boolean;
  /** api-client base URL — prefixes each row's relative thumb path. */
  baseUrl: string;
  onLoadMore: () => void;
  onRowClick: (row: ProductListRow) => void;
  /** „Endgültig löschen" row action — opens the DeleteProductDialog. */
  onDelete: (row: ProductListRow) => void;
}

export function LagerTable({
  rows,
  highlightedId,
  loading,
  total,
  hasMore,
  baseUrl,
  onLoadMore,
  onRowClick,
  onDelete,
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
      {rows.length === 0 && loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <EmptyTable />
      ) : (
        rows.map((row) => (
          <LagerRow
            key={row.id}
            row={row}
            highlighted={highlightedId === row.id}
            baseUrl={baseUrl}
            onClick={onRowClick}
            onDelete={onDelete}
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
    color: 'var(--w14-ink-aged)', // ≥4.5:1 header label (was ink-faded)
  };
  return (
    <div style={headerStyle}>
      <div style={cellStyle} aria-hidden="true" />
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
// Row thumbnail — recognition over recall (brief §3 / §1 dual-product-path).
// Decoupled so an onError fallback doesn't force the whole row to carry
// image-load state. Mirrors the Verkauf CatalogGrid thumb contract.
// ────────────────────────────────────────────────────────────────────────

function RowThumb({ thumbUrl, alt }: { thumbUrl: string | null; alt: string }): JSX.Element {
  const [failed, setFailed] = useState<boolean>(false);
  const showImage = thumbUrl !== null && !failed;
  return (
    <div
      aria-hidden={showImage ? undefined : 'true'}
      style={{
        width: 36,
        height: 36,
        flexShrink: 0,
        borderRadius: 'var(--w14-radius-button)',
        overflow: 'hidden',
        background: 'var(--w14-parchment-3)',
        border: '1px solid var(--w14-rule)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {showImage ? (
        <img
          src={thumbUrl ?? undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="3"
            y="5"
            width="18"
            height="14"
            rx="2"
            stroke="var(--w14-ink-faded)"
            strokeWidth="1.5"
          />
          <circle cx="8.5" cy="10" r="1.5" fill="var(--w14-ink-faded)" />
          <path
            d="M5 17l4-4 3 3 3-3 4 4"
            stroke="var(--w14-ink-faded)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Per-row component — memoised on row id + content hash
// ────────────────────────────────────────────────────────────────────────

interface LagerRowProps {
  row: ProductListRow;
  highlighted: boolean;
  baseUrl: string;
  onClick: (row: ProductListRow) => void;
  onDelete: (row: ProductListRow) => void;
}

const LagerRow = memo(
  function LagerRow({ row, highlighted, baseUrl, onClick, onDelete }: LagerRowProps): JSX.Element {
    const lagerort = [row.locationStorageUnit, row.locationDrawer, row.locationPosition]
      .filter((s): s is string => s !== null && s.length > 0)
      .join(' · ');

    // Calm secondary scan-line: metal + weight when present (helps staff
    // confirm a piece by sight). Presentation only — no math, just a label.
    const metalTag = row.metal ? (METAL_LABEL[row.metal] ?? row.metal) : null;
    const weightTag =
      row.weightGrams && row.weightGrams.trim().length > 0
        ? `${formatGrams(row.weightGrams)} g`
        : null;
    const scanLine = [metalTag, weightTag].filter((s): s is string => s !== null).join(' · ');

    const rowStyle: CSSProperties = {
      display: 'grid',
      gridTemplateColumns: GRID_TEMPLATE,
      alignItems: 'center',
      minHeight: ROW_MIN_HEIGHT,
      borderBottom: '1px solid var(--w14-rule)',
      // Scan-match marker: brass left edge + raised surface so the pinpointed
      // item is unmistakable (brief §3 recognition + §1 scan-success flash).
      background: highlighted ? 'var(--w14-parchment-3)' : 'transparent',
      boxShadow: highlighted ? 'inset 3px 0 0 0 var(--w14-accent)' : 'none',
      transition:
        'background-color var(--w14-dur-short) var(--w14-ease-curator), box-shadow var(--w14-dur-short) var(--w14-ease-curator)',
      cursor: 'pointer',
    };
    const cellBase: CSSProperties = {
      padding: CELL_PADDING,
      minWidth: 0,
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingLeft: 'var(--space-3)',
          }}
        >
          <RowThumb thumbUrl={resolveThumbUrl(baseUrl, row.primaryPhotoThumbUrl)} alt={row.name} />
        </div>
        <div style={monoCell}>
          <div className="w14-tabular" style={{ color: 'var(--w14-ink-aged)' }}>
            {row.sku}
          </div>
          {row.barcode && (
            <div style={{ fontSize: '0.72rem', color: 'var(--w14-ink-faded)' }}>{row.barcode}</div>
          )}
        </div>
        <div style={{ ...cellBase, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '0.95rem',
              color: 'var(--w14-ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={row.name}
          >
            {row.name}
          </div>
          {scanLine && (
            <div
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.72rem',
                color: 'var(--w14-ink-faded)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {scanLine}
            </div>
          )}
        </div>
        <div style={{ ...cellBase, whiteSpace: 'normal' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                flexShrink: 0,
                borderRadius: '50%',
                // For a sellable item, distinguish shop-only ("Im Laden", blue)
                // from web-published ("Online", green) — what the owner wanted to
                // see in the cashier, not only in the phone companion.
                background:
                  row.status === 'AVAILABLE'
                    ? row.listedOnStorefront
                      ? '#157a4b'
                      : '#3b82f6'
                    : PRODUCT_STATUS_COLOR[row.status],
              }}
            />
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-aged)',
                fontSize: '0.78rem',
                letterSpacing: '0.08em',
              }}
            >
              {row.status === 'AVAILABLE'
                ? row.listedOnStorefront
                  ? 'Online'
                  : 'Im Laden'
                : PRODUCT_STATUS_LABEL[row.status]}
            </span>
          </span>
          {row.archivedAt && (
            <span
              className="w14-smallcaps"
              style={{
                display: 'inline-block',
                marginTop: 2,
                fontSize: '0.7rem',
                color: 'var(--w14-wax-red)',
              }}
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
            color: 'var(--w14-ink-aged)',
          }}
        >
          {itemTypeLabel(row.itemType)}
        </div>
        <div
          style={{
            ...cellBase,
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.82rem',
            color: lagerort ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          }}
          title={lagerort || undefined}
        >
          {lagerort || '—'}
        </div>
        <div style={{ ...cellBase, textAlign: 'right' }}>
          <MoneyAmount valueEur={row.listPriceEur} />
        </div>
        <div
          style={{
            ...cellBase,
            overflow: 'visible',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 'var(--space-1)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.82rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            anpassen
          </span>
          {/* „Endgültig löschen" — stops the row-click (which opens the
              ProductSheet) and hands off to the DeleteProductDialog. */}
          <IconButton
            icon={Trash2}
            label={`${row.sku} endgültig löschen`}
            tone="danger"
            iconSize={17}
            onClick={(ev) => {
              ev.stopPropagation();
              onDelete(row);
            }}
          />
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.highlighted === next.highlighted && prev.row === next.row && prev.baseUrl === next.baseUrl,
);

// ────────────────────────────────────────────────────────────────────────
// Empty + Footer
// ────────────────────────────────────────────────────────────────────────

/**
 * First-load skeleton — calm placeholder rows at the frozen row geometry so
 * the table doesn't flash empty before the first page lands (brief: Doherty
 * <400ms perceived feedback). Pure presentation; no spinner spin/bounce.
 */
function SkeletonRows(): JSX.Element {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list, never reordered
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: GRID_TEMPLATE,
            alignItems: 'center',
            minHeight: ROW_MIN_HEIGHT,
            borderBottom: '1px solid var(--w14-rule)',
            opacity: 1 - i * 0.07,
          }}
        >
          <div style={{ paddingLeft: 'var(--space-3)' }}>
            <SkeletonBar width={36} height={36} radius="var(--w14-radius-button)" />
          </div>
          <div style={{ padding: CELL_PADDING }}>
            <SkeletonBar width="70%" />
          </div>
          <div style={{ padding: CELL_PADDING }}>
            <SkeletonBar width="85%" />
          </div>
          <div style={{ padding: CELL_PADDING }}>
            <SkeletonBar width="60%" />
          </div>
          <div style={{ padding: CELL_PADDING }}>
            <SkeletonBar width="65%" />
          </div>
          <div style={{ padding: CELL_PADDING }}>
            <SkeletonBar width="75%" />
          </div>
          <div style={{ padding: CELL_PADDING, display: 'flex', justifyContent: 'flex-end' }}>
            <SkeletonBar width="50%" />
          </div>
          <div style={{ padding: CELL_PADDING, display: 'flex', justifyContent: 'flex-end' }}>
            <SkeletonBar width="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonBar({
  width,
  height = 12,
  radius = 'var(--w14-radius-button)',
}: {
  width: number | string;
  height?: number;
  radius?: string;
}): JSX.Element {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'var(--w14-parchment-3)',
      }}
    />
  );
}

function EmptyTable(): JSX.Element {
  return (
    <div style={{ padding: 'var(--space-9)', textAlign: 'center' }}>
      <ParchmentCard
        padding="lg"
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          minWidth: 320,
        }}
      >
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1rem',
          }}
        >
          Keine Stücke gefunden
        </p>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.88rem',
          }}
        >
          Passen Sie Suche oder Filter an — oder legen Sie ein neues Produkt an.
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
        padding: 'var(--space-3) var(--space-4)',
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
