/**
 * RecentSalesPanel — last 24h of sales so the cashier can Storno a mistaken
 * ring AFTER leaving the post-finalize screen (late storno). Reuses the same
 * StornoDialog (PIN step-up). Already-stornoed / storno rows can't be reversed
 * again.
 */

import { useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiClient } from '@warehouse14/api-client';
import { Button, DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

import { StornoDialog } from '../verkauf/StornoDialog.js';

interface RecentItem {
  id: string;
  receiptLocator: string;
  totalEur: string;
  finalizedAt: string;
  isStorno: boolean;
  alreadyStornoed: boolean;
}

export const recentSalesQueryKey = ['transactions', 'recent'] as const;

export function RecentSalesPanel(): JSX.Element {
  const api = useApiClient() as ApiClient;
  const qc = useQueryClient();
  const [storno, setStorno] = useState<{ id: string; locator: string } | null>(null);

  const { data, isLoading } = useQuery<{ items: RecentItem[] }>({
    queryKey: recentSalesQueryKey,
    queryFn: () => api.request<{ items: RecentItem[] }>('GET', '/api/transactions/recent'),
    staleTime: 15_000,
  });

  const items = data?.items ?? [];
  const time = (iso: string): string =>
    new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  return (
    <ParchmentCard padding="md">
      <DiamondRule label="Letzte Verkäufe" />
      {isLoading ? (
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            textAlign: 'center',
            fontStyle: 'italic',
          }}
        >
          Lädt …
        </p>
      ) : items.length === 0 ? (
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            textAlign: 'center',
            fontStyle: 'italic',
          }}
        >
          Keine Verkäufe in den letzten 24 Stunden.
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {items.map((it) => {
            const reversed = it.isStorno || it.alreadyStornoed;
            return (
              <div
                key={it.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 4px',
                  borderBottom: '1px solid var(--w14-parchment-3)',
                  opacity: reversed ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: '0.78rem',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  {time(it.finalizedAt)}
                </span>
                <span style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.8rem' }}>
                  {it.receiptLocator}
                  {it.isStorno && (
                    <span style={{ color: 'var(--w14-wax-red)', marginLeft: 6 }}>(Storno)</span>
                  )}
                  {it.alreadyStornoed && !it.isStorno && (
                    <span style={{ color: 'var(--w14-wax-red)', marginLeft: 6 }}>storniert</span>
                  )}
                </span>
                <MoneyAmount valueEur={it.totalEur} />
                {reversed ? (
                  <span style={{ width: 92 }} />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStorno({ id: it.id, locator: it.receiptLocator })}
                  >
                    Stornieren
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {storno && (
        <StornoDialog
          transactionId={storno.id}
          receiptLocator={storno.locator}
          onClose={() => setStorno(null)}
          onStornoed={() => {
            setStorno(null);
            void qc.invalidateQueries({ queryKey: recentSalesQueryKey });
          }}
        />
      )}
    </ParchmentCard>
  );
}
