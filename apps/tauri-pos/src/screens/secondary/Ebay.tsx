/**
 * Ebay — Tier-2 9-stufige Listing-Pipeline (Phase 2 Day 8).
 *
 * Kanban-style 9 columns (one per ebayState). Cards are products enrolled
 * in the eBay workflow (listedOnEbay = true). Drag-and-drop NOT required:
 *   • click a card → side drawer opens
 *   • drawer shows product header + history timeline + "Übergang zu …"
 *     buttons drawn from ALLOWED_EBAY_TRANSITIONS for the current state
 *
 * Since `GET /api/products` does not yet expose ebayState in the row, we
 * fetch the list once and then issue one `productsApi.get()` per row to
 * resolve current states. Cached for 30s, which is fine for the volume
 * of an eBay seller's open listings (typically < 100).
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  ALLOWED_EBAY_TRANSITIONS,
  ApiError,
  EBAY_STATE_LABELS,
  EBAY_STATE_ORDER,
  type EbayState,
  type ProductDetail,
  type ProductListRow,
  ebayApi,
  productsApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

export function Ebay(): JSX.Element {
  const api = useApiClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['products', 'list', { listedOnEbay: true, limit: 200 }],
    queryFn: () => productsApi.list(api, { listedOnEbay: true, limit: 200 }),
    staleTime: 30_000,
  });

  const rows = listQ.data?.items ?? [];

  // One detail per row — N+1 by design (the volume is small enough).
  const detailQs = useQueries({
    queries: rows.map((r) => ({
      queryKey: ['products', 'detail', r.id] as const,
      queryFn: () => productsApi.get(api, r.id),
      staleTime: 30_000,
    })),
  });

  const detailById = useMemo(() => {
    const m = new Map<string, ProductDetail>();
    detailQs.forEach((q) => {
      if (q.data) m.set(q.data.id, q.data);
    });
    return m;
  }, [detailQs]);

  const byState = useMemo(() => {
    const buckets = new Map<EbayState | '__NULL__', ProductListRow[]>();
    for (const state of EBAY_STATE_ORDER) buckets.set(state, []);
    buckets.set('__NULL__', []);
    for (const row of rows) {
      const detail = detailById.get(row.id);
      const state = detail?.ebayState ?? '__NULL__';
      const bucket = buckets.get(state);
      if (bucket) bucket.push(row);
    }
    return buckets;
  }, [rows, detailById]);

  const totalDetailLoading = detailQs.some((q) => q.isLoading);

  return (
    <section
      aria-label="eBay-Pipeline"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 20,
        gap: 14,
        overflow: 'hidden',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.6rem',
          }}
        >
          eBay-Konsole
        </h1>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.74rem', letterSpacing: '0.08em' }}
        >
          {listQ.isFetching || totalDetailLoading ? 'lädt…' : `${rows.length} Artikel`}
        </span>
      </header>

      <DiamondRule />

      {listQ.isLoading ? (
        <KanbanSkeleton />
      ) : listQ.isError ? (
        <ErrorBanner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 8,
          }}
        >
          {EBAY_STATE_ORDER.map((state) => (
            <Column
              key={state}
              title={EBAY_STATE_LABELS[state]}
              count={byState.get(state)?.length ?? 0}
            >
              {(byState.get(state) ?? []).map((row) => (
                <ProductCard
                  key={row.id}
                  row={row}
                  selected={selectedId === row.id}
                  onClick={() => setSelectedId(row.id)}
                />
              ))}
            </Column>
          ))}
          {(byState.get('__NULL__')?.length ?? 0) > 0 && (
            <Column title="ohne State" count={byState.get('__NULL__')?.length ?? 0}>
              {(byState.get('__NULL__') ?? []).map((row) => (
                <ProductCard
                  key={row.id}
                  row={row}
                  selected={selectedId === row.id}
                  onClick={() => setSelectedId(row.id)}
                />
              ))}
            </Column>
          )}
        </div>
      )}

      {selectedId && <ProductDrawer productId={selectedId} onClose={() => setSelectedId(null)} />}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Column + Card
// ════════════════════════════════════════════════════════════════════════

function Column({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        flex: '0 0 220px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--w14-parchment-1)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        padding: 8,
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '4px 6px',
        }}
      >
        <span
          className="w14-smallcaps"
          style={{
            fontSize: '0.74rem',
            letterSpacing: '0.08em',
            color: 'var(--w14-ink-aged)',
          }}
        >
          {title}
        </span>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.7rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {count}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflowY: 'auto',
          minHeight: 0,
          flex: 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ProductCard({
  row,
  selected,
  onClick,
}: {
  row: ProductListRow;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="sm"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        border: selected ? '1px solid var(--w14-gold)' : '1px solid transparent',
        background: selected ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontSize: '0.86rem',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {row.name}
      </div>
      <div
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.7rem',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {row.sku} · {formatEuro(row.listPriceEur)} €
      </div>
    </ParchmentCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Drawer
// ════════════════════════════════════════════════════════════════════════

function ProductDrawer({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const detailQ = useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: () => productsApi.get(api, productId),
    staleTime: 5_000,
  });

  const historyQ = useQuery({
    queryKey: ['products', 'ebay-history', productId],
    queryFn: () => ebayApi.history(api, productId, { limit: 20 }),
    staleTime: 5_000,
  });

  const transition = useMutation({
    mutationFn: (toState: EbayState) => ebayApi.transition(api, productId, { toState }),
    onSuccess: async (res) => {
      addToast({
        tone: 'success',
        title: `Übergang ${res.fromState ?? '—'} → ${res.toState}`,
        body:
          res.inventorySideEffect !== 'NONE' ? `Inventar: ${res.inventorySideEffect}` : undefined,
      });
      await qc.invalidateQueries({ queryKey: ['products', 'detail', productId] });
      await qc.invalidateQueries({ queryKey: ['products', 'ebay-history', productId] });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Übergang abgelehnt',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const detail = detailQ.data;
  const fromKey = detail?.ebayState ?? '__NULL__';
  const allowed = ALLOWED_EBAY_TRANSITIONS[fromKey] ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Artikel-Übergänge"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(420px, 100%)',
        background: 'var(--w14-parchment)',
        borderLeft: '1px solid var(--w14-rule)',
        boxShadow: '-12px 0 28px rgba(0,0,0,0.18)',
        padding: 22,
        overflowY: 'auto',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.2rem',
          }}
        >
          eBay-Übergang
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1.4rem',
            lineHeight: 1,
            color: 'var(--w14-ink-faded)',
          }}
        >
          ×
        </button>
      </header>

      {detailQ.isLoading || !detail ? (
        <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lade…</p>
      ) : (
        <>
          <ParchmentCard padding="md">
            <div
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: '1rem',
              }}
            >
              {detail.name}
            </div>
            <div
              className="w14-tabular"
              style={{
                marginTop: 4,
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {detail.sku} · {formatEuro(detail.listPriceEur)} €
            </div>
            <div style={{ marginTop: 8 }}>
              <span
                className="w14-smallcaps"
                style={{
                  fontSize: '0.74rem',
                  letterSpacing: '0.08em',
                  color: 'var(--w14-gold)',
                }}
              >
                {detail.ebayState
                  ? `Aktuell: ${EBAY_STATE_LABELS[detail.ebayState]}`
                  : 'Noch nicht enrollt'}
              </span>
            </div>
          </ParchmentCard>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <DiamondRule label="Übergänge" />
            {allowed.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontStyle: 'italic',
                  color: 'var(--w14-ink-faded)',
                  fontSize: '0.9rem',
                }}
              >
                Endzustand erreicht.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {allowed.map((next) => (
                  <Button
                    key={next}
                    variant={next === 'VERSENDET' || next === 'BEZAHLT' ? 'primary' : 'ghost'}
                    onClick={() => transition.mutate(next)}
                    disabled={transition.isPending}
                  >
                    → {EBAY_STATE_LABELS[next]}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div>
            <DiamondRule label="Historie" />
            {historyQ.isLoading ? (
              <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic', margin: 0 }}>Lade…</p>
            ) : !historyQ.data || historyQ.data.items.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontStyle: 'italic',
                  color: 'var(--w14-ink-faded)',
                  fontSize: '0.9rem',
                }}
              >
                Noch keine Übergänge.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {historyQ.data.items.map((ev) => (
                  <li
                    key={ev.id}
                    className="w14-tabular"
                    style={{
                      fontFamily: 'var(--w14-font-mono)',
                      fontSize: '0.74rem',
                      color: 'var(--w14-ink-aged)',
                    }}
                  >
                    {new Date(ev.createdAt).toLocaleString('de-DE')} ·{' '}
                    <strong style={{ color: 'var(--w14-ink)' }}>
                      {ev.fromState ?? '∅'} → {ev.toState}
                    </strong>{' '}
                    · {ev.changedBySource.toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

function formatEuro(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function KanbanSkeleton(): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            flex: '0 0 220px',
            background:
              'linear-gradient(180deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '100% 200%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            borderRadius: 'var(--w14-radius-card)',
            border: '1px solid var(--w14-rule)',
          }}
        />
      ))}
      <style>{`@keyframes w14-skel { 0%,100%{background-position:0% 0%;} 50%{background-position:0% 100%;} }`}</style>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}>
      <ParchmentCard padding="lg" style={{ textAlign: 'center', maxWidth: 480 }}>
        <DiamondRule />
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          Noch keine Artikel im eBay-Workflow.
        </p>
      </ParchmentCard>
    </div>
  );
}

function ErrorBanner(): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
      <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
        eBay-Pipeline konnte nicht geladen werden.
      </p>
    </ParchmentCard>
  );
}
