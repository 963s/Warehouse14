/**
 * LagerPanel — the Lager surface (digit 5). The owner's inventory control on
 * `GET /api/products` (+ `PUT /api/products/:id`): SKU, name, status, eBay
 * state, list price — with inline price editing and a one-click Veröffentlichen
 * (DRAFT → AVAILABLE). Price/status edits go through PUT and require a fresh PIN
 * step-up (a 403 surfaces as a toast).
 */

import { type CSSProperties, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  Button,
  DiamondRule,
  MoneyAmount,
  ParchmentCard,
  ToastContainer,
  type ToastShape,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';
import { describeError } from '@warehouse14/i18n-de';

type ProductStatus = 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  status: ProductStatus;
  listPriceEur: string;
  listedOnEbay: boolean;
  primaryCategory: { nameDe: string } | null;
}

interface ProductsResponse {
  items: ProductRow[];
  total: number;
}

const STATUS_TONE: Record<ProductStatus, StatusTone> = {
  AVAILABLE: 'ok',
  RESERVED: 'watch',
  DRAFT: 'info',
  SOLD: 'info',
};

const STATUS_LABEL: Record<ProductStatus, string> = {
  AVAILABLE: 'Verfügbar',
  RESERVED: 'Reserviert',
  DRAFT: 'Entwurf',
  SOLD: 'Verkauft',
};

const PRODUCTS_KEY = ['products'] as const;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

const caption: CSSProperties = { margin: 0, color: 'var(--w14-ink-faded)', fontSize: '0.9rem' };
const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  borderBottom: '1px solid var(--w14-ink-faded)',
  whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--w14-parchment-3)',
  verticalAlign: 'middle',
};

type Mutation = { id: string; body: Record<string, unknown> };

export function LagerPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [toasts, setToasts] = useState<ToastShape[]>([]);

  const pushToast = (tone: ToastShape['tone'], title: string, body?: string): void => {
    setToasts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), tone, title, autoDismissMs: 4000, ...(body ? { body } : {}) },
    ]);
  };
  const dismissToast = (id: string): void => setToasts((prev) => prev.filter((t) => t.id !== id));

  const query = useQuery<ProductsResponse>({
    queryKey: [...PRODUCTS_KEY, baseUrl],
    queryFn: () => client.request<ProductsResponse>('GET', '/api/products?limit=200'),
    staleTime: 30_000,
  });

  const mutation = useMutation<unknown, Error, Mutation>({
    mutationFn: (v) => client.request('PUT', `/api/products/${v.id}`, v.body),
    onSuccess: (_data, v) => {
      pushToast('success', v.body.status ? 'Veröffentlicht' : 'Preis aktualisiert');
      setEditId(null);
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
    },
    onError: (err) => {
      const msg = describeError(err);
      if (/step[_-]?up/i.test(msg)) {
        pushToast(
          'alert',
          'PIN-Bestätigung nötig',
          'Diese Änderung verlangt eine frische PIN-Freigabe.',
        );
      } else {
        pushToast('alert', 'Änderung fehlgeschlagen', msg);
      }
    },
  });

  const startEdit = (item: ProductRow): void => {
    setEditId(item.id);
    setEditValue(item.listPriceEur);
  };
  const saveEdit = (item: ProductRow): void => {
    const v = editValue.trim();
    if (!PRICE_RE.test(v)) {
      pushToast('alert', 'Ungültiger Preis', 'Format: 1234.56');
      return;
    }
    mutation.mutate({ id: item.id, body: { listPriceEur: v } });
  };

  const all = query.data?.items ?? [];
  const needle = q.trim().toLowerCase();
  const items = needle
    ? all.filter(
        (p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle),
      )
    : all;

  return (
    <>
      <DiamondRule tone="gold" label="Lager" />
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 8,
          marginBottom: 16,
          maxWidth: 1000,
        }}
      >
        <p style={caption}>
          Bestand steuern. Status, eBay, Listenpreis bearbeiten, veröffentlichen.
        </p>
        <input
          className="w14cd-focusable"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche SKU / Name"
          style={{
            padding: '6px 12px',
            border: '1px solid var(--w14-ink-faded)',
            borderRadius: 'var(--w14-radius-button)',
            background: 'var(--w14-parchment)',
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-body)',
            minWidth: 220,
          }}
        />
      </div>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 1000 }}>
          <p style={caption}>Lädt Bestand …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 1000 }}>
          <p style={caption}>{all.length === 0 ? 'Kein Bestand erfasst.' : 'Keine Treffer.'}</p>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 1000, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                <th style={th}>SKU</th>
                <th style={th}>Artikel</th>
                <th style={th}>Status</th>
                <th style={th}>eBay</th>
                <th style={{ ...th, textAlign: 'right' }}>Listenpreis</th>
                <th style={{ ...th, textAlign: 'right' }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const editable = p.status === 'DRAFT' || p.status === 'AVAILABLE';
                const editing = editId === p.id;
                return (
                  <tr key={p.id}>
                    <td style={{ ...td, fontFamily: 'var(--w14-font-mono)', fontSize: '0.82rem' }}>
                      {p.sku}
                    </td>
                    <td style={td}>
                      <span style={{ fontFamily: 'var(--w14-font-display)' }}>{p.name}</span>
                      {p.primaryCategory ? (
                        <span style={{ ...caption, display: 'block', fontSize: '0.75rem' }}>
                          {p.primaryCategory.nameDe}
                        </span>
                      ) : null}
                    </td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <StatusDot tone={STATUS_TONE[p.status]} size={9} />
                        <span style={{ fontSize: '0.85rem' }}>{STATUS_LABEL[p.status]}</span>
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: '0.85rem' }}>
                      {p.listedOnEbay ? 'Online' : '-'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {editing ? (
                        <input
                          className="w14cd-focusable"
                          type="text"
                          inputMode="decimal"
                          value={editValue}
                          disabled={mutation.isPending}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(p);
                            if (e.key === 'Escape') setEditId(null);
                          }}
                          style={{
                            width: 100,
                            textAlign: 'right',
                            padding: '4px 8px',
                            border: '1px solid var(--w14-gold)',
                            borderRadius: 'var(--w14-radius-button)',
                            background: 'var(--w14-parchment)',
                            color: 'var(--w14-ink)',
                            fontFamily: 'var(--w14-font-mono)',
                          }}
                        />
                      ) : (
                        <MoneyAmount valueEur={p.listPriceEur} />
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {editing ? (
                        <span
                          style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}
                        >
                          <Button
                            className="w14cd-focusable"
                            variant="primary"
                            size="sm"
                            disabled={mutation.isPending}
                            onClick={() => saveEdit(p)}
                          >
                            ✓
                          </Button>
                          <Button
                            className="w14cd-focusable"
                            variant="ghost"
                            size="sm"
                            disabled={mutation.isPending}
                            onClick={() => setEditId(null)}
                          >
                            ✗
                          </Button>
                        </span>
                      ) : (
                        <span
                          style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}
                        >
                          {editable ? (
                            <Button
                              className="w14cd-focusable"
                              variant="ghost"
                              size="sm"
                              disabled={mutation.isPending}
                              onClick={() => startEdit(p)}
                            >
                              Preis
                            </Button>
                          ) : null}
                          {p.status === 'DRAFT' ? (
                            <Button
                              className="w14cd-focusable"
                              variant="primary"
                              size="sm"
                              disabled={mutation.isPending}
                              onClick={() =>
                                mutation.mutate({ id: p.id, body: { status: 'AVAILABLE' } })
                              }
                            >
                              Veröffentlichen
                            </Button>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ParchmentCard>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
