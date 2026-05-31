/**
 * CatalogGrid — left column of Verkauf.
 *
 * Loads `GET /api/products?status=AVAILABLE` via TanStack Query. Renders
 * a sparse grid: each card shows SKU + Name + listPrice. Clicking a card
 * fires the reservation flow (parent handles the API + cart-store push).
 *
 * Search affordance — the brand MagnifierIcon + a mono input — refetches
 * with the `q` query param so the server does the ILIKE work. Debounced
 * 240 ms.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { type ProductListRow, productsApi } from '@warehouse14/api-client';
import { MagnifierIcon, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

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
}

export function CatalogGrid({
  reservingProductIds,
  inCart,
  onSelect,
}: CatalogGridProps): JSX.Element {
  const api = useApiClient();
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedQ, setDebouncedQ] = useState<string>('');

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

  const items = useMemo(() => q.data?.items ?? [], [q.data]);

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

      {/* Results */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {q.isLoading && items.length === 0 ? (
          <CatalogPlaceholder />
        ) : items.length === 0 ? (
          <EmptyState query={debouncedQ} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {items.map((it) => {
              const busy = reservingProductIds.has(it.id);
              const isInCart = inCart.has(it.id);
              return (
                <ProductTile
                  key={it.id}
                  product={it}
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

function ProductTile({
  product,
  disabled,
  busy,
  inCart,
  onSelect,
}: {
  product: ProductListRow;
  disabled: boolean;
  busy: boolean;
  inCart: boolean;
  onSelect: (p: ProductListRow) => void;
}): JSX.Element {
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
        gap: 6,
        padding: '16px 16px 14px', // A1: roomier touch target for fast-paced retail
        minHeight: 108, // A1: consistent, comfortable tap area
        border: '1px solid transparent',
        borderRadius: 'var(--w14-radius-card)',
        backgroundColor: inCart ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
        boxShadow: 'var(--w14-shadow-card)',
        color: 'var(--w14-ink)',
        cursor: disabled || inCart ? 'default' : 'pointer',
        opacity: disabled && !busy ? 0.55 : 1,
        transition:
          'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
          ' background-color var(--w14-dur-short) var(--w14-ease-curator)',
      }}
      onMouseEnter={(ev) => {
        if (disabled || inCart) return;
        (ev.currentTarget as HTMLButtonElement).style.borderColor = 'var(--w14-gold)';
      }}
      onMouseLeave={(ev) => {
        (ev.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
      }}
    >
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.78rem',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {product.sku}
      </span>
      <span
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1rem',
          lineHeight: 1.3,
        }}
      >
        {product.name}
      </span>
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
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
    </button>
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
