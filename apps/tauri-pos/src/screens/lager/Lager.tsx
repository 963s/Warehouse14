/**
 * Lager — Tier-1 surface #6 (Day 9). Inventory observability + audit-safe
 * mutation. The operator's bird's-eye view of every product in the catalog.
 *
 * State machine:
 *   • idle → load page (TanStack Query keyed on filters)
 *   • filter change → re-query (cached if seen before)
 *   • barcode scan → exact-match query → row auto-highlights + scrolls into view
 *   • row click → InventoryAdjustmentDialog
 *   • dialog success → catalog query invalidates; row updates in place
 *
 * Audit posture: every mutation goes through
 * `POST /api/products/:id/inventory-adjustment` (Day 9 additive). NEVER
 * touch products directly from the client — the route writes audit_log
 * + (for LOCATION_CHANGE) updates the row in one DB transaction.
 *
 * No shift gate: Lager is a read-mostly observability surface that the
 * Owner may open before / after a shift. The mutation gate is step-up,
 * not shift presence.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type ProductListRow, type ProductStatus, productsApi } from '@warehouse14/api-client';
import { Button, DiamondRule, MagnifierIcon, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { useApiClient } from '../../lib/api-context.js';
import { type StatusFilter, useLagerFilterStore } from '../../state/lager-filter-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { InventoryAdjustmentDialog } from './InventoryAdjustmentDialog.js';
import { LagerTable } from './LagerTable.js';
import { NeuesProduktDialog } from './NeuesProduktDialog.js';

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'Alle' },
  { value: 'AVAILABLE', label: 'Verfügbar' },
  { value: 'DRAFT', label: 'Entwurf' },
  { value: 'RESERVED', label: 'Reserviert' },
  { value: 'SOLD', label: 'Verkauft' },
];

const PAGE_SIZE = 50;

export function Lager(): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const filters = useLagerFilterStore();
  const setStatus = useLagerFilterStore((s) => s.setStatus);
  const setQ = useLagerFilterStore((s) => s.setQ);
  const setBarcode = useLagerFilterStore((s) => s.setBarcode);
  const queryClient = useQueryClient();

  // ── Local UX state ──
  const [newOpen, setNewOpen] = useState<boolean>(false);
  const [searchInput, setSearchInput] = useState<string>('');
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [dialogProduct, setDialogProduct] = useState<ProductListRow | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  /** Barcode we already auto-opened the dialog for — so a re-render can't reopen it. */
  const autoOpenedBarcodeRef = useRef<string | null>(null);

  // Debounce free-text q.
  const debounceTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      setQ(searchInput.trim());
      setPageOffset(0);
    }, 240);
    return () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    };
  }, [searchInput, setQ]);

  // Reset page offset on any other filter change.
  useEffect(() => {
    setPageOffset(0);
  }, [filters.status, filters.barcode, filters.itemType]);

  // ── Catalog query ──
  const queryArgs = useMemo(() => {
    const args: Parameters<typeof productsApi.list>[1] = {
      limit: PAGE_SIZE,
      offset: pageOffset,
    };
    if (filters.status !== 'ALL') {
      args.status = filters.status as ProductStatus;
    }
    if (filters.q.length > 0) args.q = filters.q;
    if (filters.barcode !== null) args.barcode = filters.barcode;
    if (filters.itemType !== null) args.itemType = filters.itemType;
    return args;
  }, [filters, pageOffset]);

  const q = useQuery({
    queryKey: ['products', 'list', queryArgs],
    queryFn: () => productsApi.list(api, queryArgs),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const hasMore = q.data?.hasMore ?? false;

  // ── Barcode scanner integration ──
  // Disable scanner while the adjustment dialog wants Enter for submit.
  const scannerEnabled = dialogProduct === null;

  const onScan = useCallback(
    (code: string) => {
      setBarcode(code);
      setSearchInput('');
      setPageOffset(0);
      addToast({ tone: 'info', title: 'Barcode erfasst', body: code });
    },
    [addToast, setBarcode],
  );

  useBarcodeScanner({ enabled: scannerEnabled, onScan });

  // Auto-highlight + scroll first row after a scan resolves; on a genuine
  // SINGLE-product match also auto-open the adjustment dialog (P1). A no-match
  // (0 rows) or an ambiguous multi-match (>1) keeps the highlight-only behaviour.
  useEffect(() => {
    if (filters.barcode === null) {
      setHighlightedId(null);
      autoOpenedBarcodeRef.current = null;
      return;
    }
    const first = rows[0];
    if (first) {
      setHighlightedId(first.id);
      const node = tableContainerRef.current?.querySelector(`[data-product-id="${first.id}"]`);
      if (node instanceof HTMLElement) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // NO FACADE: open only when the scan resolved (not mid-fetch) to EXACTLY one
    // product, and only once per scanned barcode (a re-render must not reopen
    // after a manual close). The scanner is disabled while a dialog is open, so
    // there is no race with an in-flight edit.
    if (
      !q.isFetching &&
      rows.length === 1 &&
      first &&
      autoOpenedBarcodeRef.current !== filters.barcode
    ) {
      autoOpenedBarcodeRef.current = filters.barcode;
      setDialogProduct(first);
    }
  }, [filters.barcode, rows, q.isFetching]);

  return (
    <section
      aria-label="Lager"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 20,
        gap: 14,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Seal size="sm" tone="ink" label="6" />
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1.5rem',
            }}
          >
            Lager
          </h1>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em', fontSize: '0.78rem' }}
          >
            Tresor · Fach · Position
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.82rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {q.isFetching ? 'lädt…' : `${total} Stück${total === 1 ? '' : 'e'}`}
          </span>
          <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
            + Neues Produkt
          </Button>
        </div>
      </header>

      <DiamondRule />

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
          }}
        >
          <MagnifierIcon size={20} tone="ink" />
          <input
            type="text"
            value={searchInput}
            onChange={(ev) => setSearchInput(ev.target.value)}
            placeholder="SKU · Barcode · Bezeichnung — oder Barcode-Scanner verwenden"
            spellCheck={false}
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
          {filters.barcode !== null && (
            <button
              type="button"
              onClick={() => setBarcode(null)}
              className="w14-smallcaps"
              style={{
                background: 'transparent',
                border: '1px solid var(--w14-gold)',
                color: 'var(--w14-gold)',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
                padding: '2px 8px',
                borderRadius: 'var(--w14-radius-button)',
                cursor: 'pointer',
              }}
              aria-label="Barcode-Filter entfernen"
            >
              Scan: {filters.barcode} ×
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {STATUS_CHIPS.map((chip) => (
            <StatusChip
              key={chip.value}
              label={chip.label}
              active={filters.status === chip.value}
              onClick={() => setStatus(chip.value)}
            />
          ))}
        </div>
      </div>

      <div
        ref={tableContainerRef}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {q.isError ? (
          <ErrorBanner message="Lagerliste konnte nicht geladen werden." />
        ) : (
          <LagerTable
            rows={rows}
            highlightedId={highlightedId}
            loading={q.isFetching}
            total={total}
            hasMore={hasMore}
            onLoadMore={() => setPageOffset((prev) => prev + PAGE_SIZE)}
            onRowClick={(row) => setDialogProduct(row)}
          />
        )}
      </div>

      <InventoryAdjustmentDialog
        open={dialogProduct !== null}
        product={dialogProduct}
        onClose={() => setDialogProduct(null)}
      />

      <NeuesProduktDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['products', 'list'] });
        }}
      />
    </section>
  );
}

function StatusChip({
  label,
  active,
  onClick,
}: { label: string; active: boolean; onClick: () => void }): JSX.Element {
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
        fontSize: '0.78rem',
        letterSpacing: '0.08em',
        padding: '6px 12px',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <ParchmentCard
      padding="lg"
      style={{ textAlign: 'center', border: '1px solid var(--w14-wax-red)' }}
    >
      <p
        role="alert"
        style={{ margin: 0, color: 'var(--w14-wax-red)', fontFamily: 'var(--w14-font-display)' }}
      >
        {message}
      </p>
    </ParchmentCard>
  );
}
