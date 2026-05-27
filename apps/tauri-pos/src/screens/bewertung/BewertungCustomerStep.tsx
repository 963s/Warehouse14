/**
 * BewertungCustomerStep — pre-open phase (Day 11).
 *
 * Asks the operator to pick or create the seller (customer) BEFORE a
 * DRAFT appraisal exists server-side. Reuses the Day-10 customer search
 * primitive via the same `customersApi.list` endpoint.
 *
 * Once a customer is selected, the "Bewertung starten" button POSTs to
 * `/api/appraisals` (via the parent's `onStart` callback) and the
 * coordinator's phase machine flips to the workspace.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { customersApi, type CustomerListRow } from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  MagnifierIcon,
  ParchmentCard,
  Seal,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

export interface BewertungCustomerStepProps {
  customerId: string | null;
  onPickCustomer: (id: string | null) => void;
  onStart: () => void;
  starting: boolean;
}

export function BewertungCustomerStep({
  customerId,
  onPickCustomer,
  onStart,
  starting,
}: BewertungCustomerStepProps): JSX.Element {
  const api = useApiClient();
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedQ, setDebouncedQ] = useState<string>('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 240);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [searchInput]);

  const q = useQuery({
    queryKey: ['customers', 'list', { q: debouncedQ }],
    queryFn: () =>
      customersApi.list(api, {
        ...(debouncedQ.length > 0 ? { q: debouncedQ } : {}),
        limit: 20,
        excludeBlocked: true, // banned/sanctions never get to seller-pick
      }),
    staleTime: 10_000,
    enabled: debouncedQ.length > 0,
  });

  const detailQ = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId!),
    enabled: customerId !== null,
    staleTime: 10_000,
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 32,
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(560px, 100%)' }}>
        <div style={{ textAlign: 'center' }}>
          <Seal size="md" tone="faded" label="8" />
          <h2
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              margin: '14px 0 4px',
              fontSize: '1.5rem',
            }}
          >
            Neue Bewertung
          </h2>
          <p
            style={{
              margin: '4px 0 0',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.92rem',
            }}
          >
            Wählen Sie zuerst den Verkäufer der Sammlung.
          </p>
        </div>

        <DiamondRule label="Verkäufer suchen" />

        {customerId === null ? (
          <>
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
                placeholder="Name · E-Mail · Telefon"
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
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {items.map((row) => (
                <CustomerRow key={row.id} row={row} onSelect={() => onPickCustomer(row.id)} />
              ))}
              {debouncedQ.length > 0 && items.length === 0 && !q.isFetching && (
                <p style={{ margin: 0, textAlign: 'center', color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
                  Kein Treffer. Bitte zuerst Kunde im Tab „Kunden“ anlegen.
                </p>
              )}
            </div>
          </>
        ) : (
          <SelectedCustomerCard
            detail={detailQ.data}
            loading={detailQ.isLoading}
            onChange={() => onPickCustomer(null)}
            onStart={onStart}
            starting={starting}
          />
        )}
      </ParchmentCard>
    </div>
  );
}

function CustomerRow({ row, onSelect }: { row: CustomerListRow; onSelect: () => void }): JSX.Element {
  return (
    <ParchmentCard
      padding="sm"
      onClick={onSelect}
      style={{ cursor: 'pointer', background: 'var(--w14-parchment-2)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '0.96rem' }}>
            {row.fullName}
          </div>
          <div className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.74rem', color: 'var(--w14-ink-faded)' }}>
            {row.customerNumber}
          </div>
        </div>
        <span
          className="w14-smallcaps"
          style={{
            fontSize: '0.72rem',
            color: row.kycVerifiedAt ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
            letterSpacing: '0.08em',
          }}
        >
          {row.kycVerifiedAt ? 'KYC ✓' : 'ohne KYC'}
        </span>
      </div>
    </ParchmentCard>
  );
}

function SelectedCustomerCard({
  detail,
  loading,
  onChange,
  onStart,
  starting,
}: {
  detail: import('@warehouse14/api-client').CustomerDetail | undefined;
  loading: boolean;
  onChange: () => void;
  onStart: () => void;
  starting: boolean;
}): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ background: 'var(--w14-parchment-2)' }}>
      {loading || !detail ? (
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '1.15rem' }}>
                {detail.fullName}
              </h3>
              <p className="w14-tabular" style={{ margin: '4px 0 0', fontFamily: 'var(--w14-font-mono)', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
                {detail.customerNumber}
              </p>
            </div>
            <span
              className="w14-smallcaps"
              style={{
                fontSize: '0.78rem',
                color: detail.kycVerifiedAt ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
                letterSpacing: '0.08em',
                padding: '4px 10px',
                border: `1px solid ${detail.kycVerifiedAt ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                borderRadius: 'var(--w14-radius-button)',
              }}
            >
              {detail.kycVerifiedAt ? 'KYC bestätigt' : 'ohne KYC'}
            </span>
          </div>
          <DiamondRule />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onChange} disabled={starting}>
              Anderer Kunde
            </Button>
            <Button variant="primary" size="lg" onClick={onStart} disabled={starting}>
              {starting ? 'Beginnt…' : 'Bewertung starten'}
            </Button>
          </div>
        </>
      )}
    </ParchmentCard>
  );
}
