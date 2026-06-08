/**
 * CustomerDetailPanel — right column of Kunden (Day 10).
 *
 * Composes:
 *   • Header card (name, customer number, KYC + Trust chips, sanctions banner)
 *   • Personal data card (Geburtsdatum, Telefon, E-Mail, Adresse, Notizen) +
 *     "Bearbeiten" → CustomerEditDialog (PUT /api/customers/:id)
 *   • Compliance card: KYC stamp action + Trust level change action
 *   • History — Ankauf list + Verkauf list (collapsible)
 *
 * Triggers `useQuery(['customers', customerId])` for the detail. Three
 * independent queries run alongside: detail, ankauf-history, sales-history.
 * One slow query doesn't block the others.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { type CustomerDetail, customersApi } from '@warehouse14/api-client';
import { Button, DiamondRule, MoneyAmount, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

import { CustomerEditDialog } from './CustomerEditDialog.js';
import { CustomerAnkaufHistory, CustomerSalesHistory } from './CustomerHistoryPanels.js';
import { CustomerTrustDialog } from './CustomerTrustDialog.js';
import { KycCaptureModal } from './KycCaptureModal.js';
import { KycLocalDocs, kycLocalQueryKey } from './KycLocalDocs.js';

export interface CustomerDetailPanelProps {
  customerId: string | null;
}

export function CustomerDetailPanel({ customerId }: CustomerDetailPanelProps): JSX.Element {
  if (customerId === null) return <EmptyDetailPlaceholder />;
  return <DetailLoaded customerId={customerId} />;
}

function DetailLoaded({ customerId }: { customerId: string }): JSX.Element {
  const api = useApiClient();
  const q = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId),
    staleTime: 10_000,
  });

  if (q.isLoading) return <LoadingPlaceholder />;
  if (q.isError || !q.data) return <ErrorPlaceholder />;

  return <CustomerCard detail={q.data} />;
}

// ────────────────────────────────────────────────────────────────────────
// Main detail card
// ────────────────────────────────────────────────────────────────────────

function CustomerCard({ detail }: { detail: CustomerDetail }): JSX.Element {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [trustOpen, setTrustOpen] = useState<boolean>(false);
  const [kycOpen, setKycOpen] = useState<boolean>(false);
  const blocked = detail.sanctionsMatch || detail.trustLevel === 'BANNED';
  const kycVerified = detail.kycVerifiedAt !== null;

  return (
    <section
      aria-label="Kundenakte"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-5)',
        gap: 'var(--space-4)',
        overflowY: 'auto',
      }}
    >
      {/* Sanctions / Banned banner */}
      {blocked && (
        <ParchmentCard
          padding="md"
          style={{ border: '2px solid var(--w14-wax-red)', background: 'var(--w14-parchment-3)' }}
        >
          <p
            style={{
              margin: 0,
              color: 'var(--w14-wax-red)',
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1rem',
            }}
          >
            Geschäft mit diesem Kunden gesperrt.
          </p>
          <p
            style={{
              margin: 'var(--space-2) 0 0',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.85rem',
            }}
          >
            {detail.sanctionsMatch
              ? 'Sanktionslisten-Treffer — EU-Verordnung.'
              : 'Vom Inhaber gesperrt — Trust = BANNED.'}
          </p>
        </ParchmentCard>
      )}

      {/* Header */}
      <ParchmentCard padding="lg">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: '1.6rem',
              }}
            >
              {detail.fullName}
            </h1>
            <p
              className="w14-tabular"
              style={{
                margin: 'var(--space-1) 0 0',
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.85rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {detail.customerNumber}
              {' · seit '}
              {new Date(detail.createdAt).toLocaleDateString('de-DE')}
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 'var(--space-2)',
            }}
          >
            <TrustChip
              kycVerified={kycVerified}
              trust={detail.trustLevel}
              sanctions={detail.sanctionsMatch}
            />
            <Button variant="ghost" size="sm" onClick={() => setTrustOpen(true)}>
              Trust ändern
            </Button>
          </div>
        </div>

        <DiamondRule label="Persönliche Daten" />
        <DataGrid>
          <DataRow label="Geburtsdatum" value={detail.dateOfBirth} mono />
          <DataRow label="E-Mail" value={detail.email} />
          <DataRow label="Telefon" value={detail.phone} mono />
          <DataRow label="Adresse" value={detail.address} multiline />
          <DataRow label="Notizen" value={detail.notes} multiline />
        </DataGrid>

        <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            size="md"
            onClick={() => setEditOpen(true)}
            disabled={detail.sanctionsMatch}
          >
            Bearbeiten
          </Button>
        </div>
      </ParchmentCard>

      {/* KYC + cumulative card */}
      <ParchmentCard padding="md">
        <DiamondRule label="KYC + Bilanz" />
        <DataGrid>
          <DataRow
            label="KYC-Status"
            value={
              kycVerified
                ? `bestätigt ${detail.kycVerifiedAt ? new Date(detail.kycVerifiedAt).toLocaleString('de-DE') : ''}`
                : 'noch nicht bestätigt'
            }
            tone={kycVerified ? 'gold' : 'faded'}
          />
          <DataRow
            label="KYC-Eingang"
            value={
              detail.kycCompletedAt ? new Date(detail.kycCompletedAt).toLocaleString('de-DE') : '—'
            }
            mono
          />
          <DataRow
            label="Bisherige Ankäufe"
            valueElement={<MoneyAmount valueEur={detail.cumulativeAnkaufEur} />}
          />
          <DataRow
            label="Bisherige Käufe"
            valueElement={<MoneyAmount valueEur={detail.cumulativeSpendEur} />}
          />
          {detail.cumulativeDebtEur !== '0.00' && (
            <DataRow
              label="Offene Schuld"
              valueElement={<MoneyAmount valueEur={detail.cumulativeDebtEur} emphasis />}
              tone="wax-red"
            />
          )}
        </DataGrid>
        <KycLocalDocs customerId={detail.id} onPromoteTrust={() => setTrustOpen(true)} />

        <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="md" onClick={() => setKycOpen(true)}>
            Ausweis erfassen
          </Button>
        </div>
      </ParchmentCard>

      {/* History */}
      <CustomerAnkaufHistory customerId={detail.id} />
      <CustomerSalesHistory customerId={detail.id} />

      <CustomerEditDialog open={editOpen} customer={detail} onClose={() => setEditOpen(false)} />
      <CustomerTrustDialog open={trustOpen} customer={detail} onClose={() => setTrustOpen(false)} />
      {kycOpen && (
        <KycCaptureModal
          customerId={detail.id}
          onClose={() => setKycOpen(false)}
          onSaved={() => void qc.invalidateQueries({ queryKey: kycLocalQueryKey(detail.id) })}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Empty / Loading / Error placeholders
// ────────────────────────────────────────────────────────────────────────

function EmptyDetailPlaceholder(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-9)' }}>
      <ParchmentCard padding="lg" style={{ textAlign: 'center', maxWidth: 440 }}>
        <Seal size="md" tone="faded" label="7" />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: '1.4rem',
          }}
        >
          Kein Kunde ausgewählt
        </h2>
        <DiamondRule />
        <p
          style={{
            margin: 'var(--space-2) 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.95rem',
          }}
        >
          Wählen Sie links einen Kunden, um die Akte zu öffnen.
        </p>
      </ParchmentCard>
    </div>
  );
}

function LoadingPlaceholder(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-9)' }}>
      <ParchmentCard padding="md">
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
          Lädt Kundenakte…
        </p>
      </ParchmentCard>
    </div>
  );
}

function ErrorPlaceholder(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-9)' }}>
      <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
        <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
          Kundenakte konnte nicht geladen werden.
        </p>
      </ParchmentCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Data-grid primitives
// ────────────────────────────────────────────────────────────────────────

function DataGrid({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
      {children}
    </div>
  );
}

function DataRow({
  label,
  value,
  valueElement,
  mono = false,
  multiline = false,
  tone = 'ink',
}: {
  label: string;
  value?: string | null;
  valueElement?: JSX.Element;
  mono?: boolean;
  multiline?: boolean;
  tone?: 'ink' | 'gold' | 'faded' | 'wax-red';
}): JSX.Element {
  const toneColor: Record<typeof tone, string> = {
    ink: 'var(--w14-ink)',
    gold: 'var(--w14-gold)',
    faded: 'var(--w14-ink-faded)',
    'wax-red': 'var(--w14-wax-red)',
  };
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, auto) 1fr',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) 0',
        alignItems: multiline ? 'start' : 'baseline',
      }}
    >
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.74rem', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      {valueElement ?? (
        <span
          style={{
            fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
            fontSize: '0.92rem',
            textAlign: 'right',
            whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: toneColor[tone],
          }}
        >
          {value ?? '—'}
        </span>
      )}
    </div>
  );
}

function TrustChip({
  kycVerified,
  trust,
  sanctions,
}: {
  kycVerified: boolean;
  trust: 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED';
  sanctions: boolean;
}): JSX.Element {
  const base: React.CSSProperties = {
    fontSize: '0.85rem',
    letterSpacing: '0.08em',
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--w14-radius-button)',
    border: '1px solid',
  };
  if (sanctions) {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-wax-red)', borderColor: 'var(--w14-wax-red)' }}
      >
        Sanktion
      </span>
    );
  }
  if (trust === 'BANNED' || trust === 'SUSPICIOUS') {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-wax-red)', borderColor: 'var(--w14-wax-red)' }}
      >
        {trust === 'BANNED' ? 'gesperrt' : 'beobachten'}
      </span>
    );
  }
  if (trust === 'VIP') {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-gold)', borderColor: 'var(--w14-gold)' }}
      >
        ◆◆ VIP
      </span>
    );
  }
  if (kycVerified || trust === 'VERIFIED') {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-gold)', borderColor: 'var(--w14-gold)' }}
      >
        KYC bestätigt
      </span>
    );
  }
  return (
    <span
      className="w14-smallcaps"
      style={{ ...base, color: 'var(--w14-ink-faded)', borderColor: 'var(--w14-rule)' }}
    >
      ohne KYC
    </span>
  );
}
