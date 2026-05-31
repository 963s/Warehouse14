/**
 * LagerPanel — the Lager surface (digit 5). The owner's inventory overview on
 * `GET /api/products`: SKU, name, status, category, list price, eBay state.
 * Read-only oversight for V1 (search + glance); price/state editing is a
 * follow-up. Answers "what do I have, and what's live where?".
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

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

export function LagerPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [q, setQ] = useState('');

  const query = useQuery<ProductsResponse>({
    queryKey: ['products', baseUrl],
    queryFn: () => client.request<ProductsResponse>('GET', '/api/products?limit=200'),
    staleTime: 30_000,
  });

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
          maxWidth: 920,
        }}
      >
        <p style={caption}>Bestand auf einen Blick — Status, Standort eBay, Listenpreis.</p>
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
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={caption}>Lädt Bestand …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={caption}>{all.length === 0 ? 'Kein Bestand erfasst.' : 'Keine Treffer.'}</p>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>SKU</th>
                <th style={th}>Artikel</th>
                <th style={th}>Status</th>
                <th style={th}>eBay</th>
                <th style={{ ...th, textAlign: 'right' }}>Listenpreis</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
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
                  <td style={{ ...td, fontSize: '0.85rem' }}>{p.listedOnEbay ? 'Online' : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <MoneyAmount valueEur={p.listPriceEur} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ParchmentCard>
      )}
    </>
  );
}
