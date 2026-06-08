/**
 * TerminePanel — the Termine surface (digit 6). Owner appointments overview on
 * `GET /api/appointments?from&to` (next 30 days). Read-only glance: when, what
 * type, status, customer. Answers "who's coming and what do they want?".
 */

import type { CSSProperties } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
} from '@warehouse14/api-client';
import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

interface ApptRow {
  id: string;
  appointment_type: string;
  status: string;
  starts_at: string;
  staff_user_id: string;
  customer_id: string | null;
}

interface AppointmentsResponse {
  appointments: ApptRow[];
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

function statusTone(status: string): StatusTone {
  if (status === 'CHECKED_IN' || status === 'IN_PROGRESS' || status === 'COMPLETED') return 'ok';
  if (status === 'NO_SHOW') return 'alert';
  if (status === 'CONFIRMED') return 'ok';
  return 'info';
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(d);
}

export function TerminePanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();

  const query = useQuery<AppointmentsResponse>({
    queryKey: ['appointments', baseUrl],
    queryFn: () => {
      const from = new Date();
      const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
      const params = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
      return client.request<AppointmentsResponse>('GET', `/api/appointments?${params}`);
    },
    staleTime: 30_000,
  });

  const items = query.data?.appointments ?? [];

  return (
    <>
      <DiamondRule tone="gold" label="Termine" />
      <p style={{ ...caption, marginTop: 8, marginBottom: 16 }}>
        Die nächsten 30 Tage — wer kommt, wann, und wozu.
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 860 }}>
          <p style={caption}>Lädt Termine …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 860 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot tone="ok" size={12} />
            <p style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontSize: '1.15rem' }}>
              Keine anstehenden Termine
            </p>
          </div>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 860, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr>
                <th style={th}>Wann</th>
                <th style={th}>Art</th>
                <th style={th}>Status</th>
                <th style={th}>Kunde</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td
                    style={{ ...td, fontFamily: 'var(--w14-font-display)', whiteSpace: 'nowrap' }}
                  >
                    {formatWhen(a.starts_at)}
                  </td>
                  <td style={{ ...td, fontSize: '0.85rem' }}>
                    {APPOINTMENT_TYPE_LABELS[a.appointment_type as AppointmentType] ??
                      a.appointment_type}
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <StatusDot tone={statusTone(a.status)} size={9} />
                      <span style={{ fontSize: '0.85rem' }}>
                        {APPOINTMENT_STATUS_LABELS[a.status as AppointmentStatus] ?? a.status}
                      </span>
                    </span>
                  </td>
                  <td style={{ ...td, fontFamily: 'var(--w14-font-mono)', fontSize: '0.8rem' }}>
                    {a.customer_id ? a.customer_id.slice(0, 8) : '—'}
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
