/**
 * CatalogGrid — left column of Verkauf.
 *
 * Loads `GET /api/products?status=AVAILABLE` via TanStack Query. Renders a
 * responsive grid of IMAGE CARDS: each tile leads with the product's primary
 * photo (a tasteful placeholder when none), then name, price, SKU and a small
 * status/metal chip. Clicking a card fires the reservation flow (parent handles
 * the API + cart-store push).
 *
 * Search affordance — the brand MagnifierIcon + a mono input — refetches
 * with the `q` query param so the server does the ILIKE work. Debounced
 * 240 ms.
 *
 * Performance: the tile is wrapped in `React.memo` and `onSelect` is forwarded
 * unchanged from the parent (a stable useCallback), so a scanner burst that
 * mutates `reservingProductIds` / `inCart` only re-renders the tiles whose
 * membership actually flipped — not the whole grid (audit fix for the
 * re-render storms under fast USB-scanner input).
 */

import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { type ProductListRow, productsApi } from '@warehouse14/api-client';
import { Button, MagnifierIcon, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

/** German labels for the metal chip. `null` metal renders no chip. */
const METAL_LABEL: Record<string, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

/**
 * Resolve the catalog tile image. The API returns a RELATIVE thumb path
 * (`/api/photos/<id>/thumb`); we prefix it with the api-client baseUrl so the
 * public-by-UUID /thumb route resolves cross-origin in the Tauri webview.
 */
function resolveThumbUrl(baseUrl: string, path: string | null): string | null {
  if (!path) return null;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export interface CatalogGridProps {
  /**
   * Set of product ids currently mid-reserve. Each tile disables itself
   * only when ITSELF is in the set — other tiles remain clickable so a
   * USB barcode scanner can fire 5–10 reservations per second without
   * being throttled by a single in-flight global guard.
   */
  reservingProductIds: ReadonlySet<string>;
  /** Set of product ids already in cart — render with subdued look. */
  inCart: ReadonlySet<string>;
  onSelect: (product: ProductListRow) => void;
  /**
   * Incremented by the parent after a sale finalizes and its dialog closes —
   * refocuses the search input so the next scan/typing lands here. Ignored on
   * the initial render (autoFocus handles first mount).
   */
  focusToken?: number;
  /**
   * Incremented by the parent after a barcode scan is handled. The scanner's
   * keystrokes leak into this input (the hook only swallows the trailing
   * Enter), so we clear it — otherwise the grid would filter to the just-sold
   * SKU and show "Keine Treffer" after a successful scan.
   */
  searchResetToken?: number;
}

const METAL_FILTERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'ALL', label: 'Alle' },
  { key: 'gold', label: 'Gold' },
  { key: 'silver', label: 'Silber' },
  { key: 'platinum', label: 'Platin' },
  { key: 'palladium', label: 'Palladium' },
  { key: 'other', label: 'Sonstiges' },
];

export function CatalogGrid({
  reservingProductIds,
  inCart,
  onSelect,
  focusToken,
  searchResetToken,
}: CatalogGridProps): JSX.Element {
  const api = useApiClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedQ, setDebouncedQ] = useState<string>('');
  const [metalFilter, setMetalFilter] = useState<string>('ALL');

  // P2: when the parent bumps `focusToken` (after a successful finalize closes
  // the Bezahlen dialog), refocus + select the search so the next USB-scanner
  // burst or keystroke lands here — no clicking required to start the next sale.
  useEffect(() => {
    if (focusToken && focusToken > 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [focusToken]);

  // Clear the search after a handled scan so the leaked SKU keystrokes don't
  // strand the grid on a now-reserved item. Skip the initial mount.
  useEffect(() => {
    if (searchResetToken && searchResetToken > 0) {
      setSearchInput('');
      setDebouncedQ('');
      searchRef.current?.focus();
    }
  }, [searchResetToken]);

  // 240ms debounce on the search input.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setDebouncedQ(searchInput.trim());
    }, 240);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [searchInput]);

  const q = useQuery({
    queryKey: ['products', 'list', { status: 'AVAILABLE', q: debouncedQ }],
    queryFn: () =>
      productsApi.list(api, {
        status: 'AVAILABLE',
        ...(debouncedQ.length > 0 ? { q: debouncedQ } : {}),
        limit: 60,
      }),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const allItems = useMemo(() => q.data?.items ?? [], [q.data]);
  const items = useMemo(() => {
    if (metalFilter === 'ALL') return allItems;
    if (metalFilter === 'other') return allItems.filter((i) => i.metal == null);
    return allItems.filter((i) => i.metal === metalFilter);
  }, [allItems, metalFilter]);

  return (
    <section
      aria-label="Kataloge"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 16,
        gap: 14,
      }}
    >
      {/* Search row */}
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
          ref={searchRef}
          type="text"
          value={searchInput}
          onChange={(ev) => setSearchInput(ev.target.value)}
          placeholder="SKU · Name · Beschreibung"
          spellCheck={false}
          autoFocus
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.95rem',
            color: 'var(--w14-ink)',
          }}
        />
        {q.isFetching && (
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.78rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            sucht…
          </span>
        )}
      </div>

      {/* Quick metal filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {METAL_FILTERS.map((f) => {
          const active = f.key === metalFilter;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setMetalFilter(f.key)}
              className="w14-smallcaps"
              style={{
                padding: '7px 16px',
                fontSize: '0.84rem',
                letterSpacing: '0.04em',
                borderRadius: 999,
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                background: active ? 'var(--w14-gold)' : 'var(--w14-parchment-2)',
                color: active ? '#fff' : 'var(--w14-ink-faded)',
                fontWeight: active ? 600 : 500,
                transition: 'background 140ms ease',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {q.isError && items.length === 0 ? (
          <CatalogError onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : q.isLoading && items.length === 0 ? (
          <CatalogPlaceholder />
        ) : items.length === 0 ? (
          <EmptyState query={debouncedQ} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 14,
            }}
          >
            {items.map((it) => {
              const busy = reservingProductIds.has(it.id);
              const isInCart = inCart.has(it.id);
              return (
                <ProductTile
                  key={it.id}
                  product={it}
                  thumbUrl={resolveThumbUrl(api.baseUrl, it.primaryPhotoThumbUrl)}
                  disabled={busy || isInCart}
                  busy={busy}
                  inCart={isInCart}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

interface ProductTileProps {
  product: ProductListRow;
  /** Absolute thumb URL, or null when the product has no primary photo. */
  thumbUrl: string | null;
  disabled: boolean;
  busy: boolean;
  inCart: boolean;
  onSelect: (p: ProductListRow) => void;
}

/**
 * Image card for one catalog product. Memoized so a scanner burst that flips
 * one product's reserve/cart membership doesn't re-render every sibling tile.
 */
const ProductTile = memo(function ProductTile({
  product,
  thumbUrl,
  disabled,
  busy,
  inCart,
  onSelect,
}: ProductTileProps): JSX.Element {
  const metalLabel = product.metal ? METAL_LABEL[product.metal] : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      disabled={disabled || inCart}
      title={`${product.name} · ${product.sku}`}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        overflow: 'hidden',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        backgroundColor: inCart ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
        boxShadow: 'var(--w14-shadow-card)',
        color: 'var(--w14-ink)',
        cursor: disabled || inCart ? 'default' : 'pointer',
        opacity: disabled && !busy ? 0.6 : 1,
        transition:
          'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
          ' box-shadow var(--w14-dur-short) var(--w14-ease-curator),' +
          ' transform var(--w14-dur-short) var(--w14-ease-curator)',
      }}
      onMouseEnter={(ev) => {
        if (disabled || inCart) return;
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'var(--w14-gold)';
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(ev) => {
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'var(--w14-rule)';
        el.style.transform = 'translateY(0)';
      }}
    >
      {/* Image */}
      <ProductThumb thumbUrl={thumbUrl} alt={product.name} dimmed={inCart} />

      {/* Body */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '12px 14px 14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.74rem',
              color: 'var(--w14-ink-faded)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {product.sku}
          </span>
          {metalLabel && (
            <span
              className="w14-smallcaps"
              style={{
                flexShrink: 0,
                padding: '2px 8px',
                fontSize: '0.66rem',
                letterSpacing: '0.06em',
                borderRadius: 999,
                border: '1px solid var(--w14-rule)',
                color: 'var(--w14-ink-faded)',
                backgroundColor: 'var(--w14-parchment-1)',
              }}
            >
              {metalLabel}
            </span>
          )}
        </div>

        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '0.98rem',
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.5em',
          }}
        >
          {product.name}
        </span>

        <div
          style={{
            marginTop: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <MoneyAmount valueEur={product.listPriceEur} emphasis />
          {inCart && (
            <span
              className="w14-smallcaps"
              style={{
                fontSize: '0.72rem',
                color: 'var(--w14-gold)',
                letterSpacing: '0.08em',
              }}
            >
              im Korb
            </span>
          )}
          {busy && !inCart && (
            <span
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              reserviert…
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

/**
 * Square image header for a tile. Renders the WebP thumb when present, else a
 * neutral placeholder mark. Decoupled into its own component so an `onError`
 * fallback (e.g. a deleted byte / offline thumb route) doesn't force the whole
 * tile to carry image-load state.
 */
function ProductThumb({
  thumbUrl,
  alt,
  dimmed,
}: {
  thumbUrl: string | null;
  alt: string;
  dimmed: boolean;
}): JSX.Element {
  const [failed, setFailed] = useState<boolean>(false);
  const showImage = thumbUrl !== null && !failed;

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        width: '100%',
        backgroundColor: 'var(--w14-parchment-3)',
        borderBottom: '1px solid var(--w14-rule)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {showImage ? (
        <img
          src={thumbUrl ?? undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: dimmed ? 0.7 : 1,
          }}
        />
      ) : (
        <PhotoPlaceholder />
      )}
    </div>
  );
}

/** Neutral mark shown when a product has no catalog photo yet. */
function PhotoPlaceholder(): JSX.Element {
  return (
    <svg
      width={40}
      height={40}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Kein Foto"
      style={{ color: 'var(--w14-ink-faded)', opacity: 0.5 }}
    >
      <rect x={3} y={4} width={18} height={16} rx={2} stroke="currentColor" strokeWidth={1.4} />
      <circle cx={8.5} cy={9} r={1.6} fill="currentColor" />
      <path
        d="M4 17l4.5-4.5 3 3L16 11l4 5"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CatalogPlaceholder(): JSX.Element {
  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
        }}
      >
        Lädt den Katalog…
      </p>
    </div>
  );
}

/**
 * Distinct from the empty state: the catalog request FAILED. Telling the
 * operator "leer" here would be a lie (the inventory may be full) — show the
 * real cause + a retry instead.
 */
function CatalogError({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <p
        style={{
          margin: '0 0 12px',
          color: 'var(--w14-ink-aged)',
          fontFamily: 'var(--w14-font-display)',
        }}
      >
        Katalog konnte nicht geladen werden — Verbindung prüfen.
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Lädt…' : 'Erneut laden'}
      </Button>
    </ParchmentCard>
  );
}

function EmptyState({ query }: { query: string }): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
        }}
      >
        {query.length > 0
          ? `Keine Treffer für „${query}“.`
          : 'Der Katalog ist leer — fügen Sie Artikel über die Aufnahme hinzu.'}
      </p>
    </ParchmentCard>
  );
}
