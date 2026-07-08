/**
 * KundenPanel — the Kunden surface (digit 4). Owner customer overview on
 * `GET /api/customers`: name, KYC status, trust level, sanctions flag, and
 * cumulative Ankauf/spend. A row opens the AML/Trust editor (trust level +
 * KYC stamp), guarded by Owner + step-up. Answers "who are my customers, is
 * anyone flagged, and let me act on it".
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  CUSTOMER_KYC_STATUS_LABELS,
  CUSTOMER_TRUST_LEVEL_LABELS,
  type CustomerKycStatus,
  type CustomerTrustLevel,
} from '@warehouse14/api-client';
import { DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { CustomerEditDialog } from '../components/CustomerEditDialog.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

interface CustomerRow {
  id: string;
  fullName: string;
  kycStatus: string;
  kycVerifiedAt: string | null;
  trustLevel: string;
  sanctionsMatch: boolean;
  cumulativeAnkaufEur: string;
  cumulativeSpendEur: string;
}

interface CustomersResponse {
  items: CustomerRow[];
}

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

function trustTone(trust: string, sanctions: boolean): StatusTone {
  if (sanctions || trust === 'BANNED') return 'alert';
  if (trust === 'SUSPICIOUS') return 'watch';
  return 'ok';
}

export function KundenPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  const query = useQuery<CustomersResponse>({
    queryKey: ['customers', baseUrl],
    queryFn: () => client.request<CustomersResponse>('GET', '/api/customers?limit=200'),
    staleTime: 30_000,
  });

  const all = query.data?.items ?? [];
  const needle = q.trim().toLowerCase();
  const items = needle ? all.filter((c) => c.fullName.toLowerCase().includes(needle)) : all;

  return (
    <>
      <DiamondRule tone="gold" label="Kunden" />
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
        <p style={caption}>
          Kundenstamm. KYC, Vertrauensstufe, Sanktionen, Umsätze. Zeile wählen zum Bearbeiten.
        </p>
        <input
          className="w14cd-focusable"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche Name"
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
          <p style={caption}>Lädt Kunden …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={caption}>{all.length === 0 ? 'Keine Kunden erfasst.' : 'Keine Treffer.'}</p>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>KYC</th>
                <th style={th}>Vertrauen</th>
                <th style={{ ...th, textAlign: 'right' }}>Ankauf gesamt</th>
                <th style={{ ...th, textAlign: 'right' }}>Umsatz gesamt</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="w14cd-focusable"
                  tabIndex={0}
                  onClick={() => setEditing(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEditing(c);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ ...td, fontFamily: 'var(--w14-font-display)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <StatusDot tone={trustTone(c.trustLevel, c.sanctionsMatch)} size={9} />
                      {c.fullName}
                    </span>
                    {c.sanctionsMatch ? (
                      <span
                        style={{
                          display: 'block',
                          fontSize: '0.75rem',
                          color: 'var(--w14-wax-red)',
                        }}
                      >
                        Sanktionstreffer
                      </span>
                    ) : null}
                  </td>
                  <td style={{ ...td, fontSize: '0.85rem' }}>
                    {c.kycVerifiedAt
                      ? 'Verifiziert'
                      : (CUSTOMER_KYC_STATUS_LABELS[c.kycStatus as CustomerKycStatus] ??
                        c.kycStatus)}
                  </td>
                  <td style={{ ...td, fontSize: '0.85rem' }}>
                    {CUSTOMER_TRUST_LEVEL_LABELS[c.trustLevel as CustomerTrustLevel] ??
                      c.trustLevel}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <MoneyAmount valueEur={c.cumulativeAnkaufEur} />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <MoneyAmount valueEur={c.cumulativeSpendEur} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ParchmentCard>
      )}

      {editing && <CustomerEditDialog customer={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
