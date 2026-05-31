/**
 * KonformitaetPanel — the Konformität surface (digit 7). The compliance trail:
 * the append-only `ledger_events` audit log on `GET /api/ledger` (ADMIN).
 * Every fiscal + AML event is here, hash-chained server-side. Answers "what
 * happened, who did it, and is anything flagged?".
 */

import type { CSSProperties } from 'react';

import { useQuery } from '@tanstack/react-query';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

interface LedgerRow {
  id: number;
  eventType: string;
  entityTable: string;
  entityId: string;
  actorUserId: string | null;
  createdAt: string;
}

interface LedgerResponse {
  items: LedgerRow[];
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

function eventTone(eventType: string): StatusTone {
  if (eventType.startsWith('alert.')) return 'alert';
  if (eventType.startsWith('command.')) return 'watch';
  if (/(finalized|success|verified|resolved)/.test(eventType)) return 'ok';
  return 'info';
}

function formatTs(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

export function KonformitaetPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();

  const query = useQuery<LedgerResponse>({
    queryKey: ['ledger', baseUrl],
    queryFn: () => client.request<LedgerResponse>('GET', '/api/ledger'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const items = query.data?.items ?? [];
  const alerts = items.filter((e) => e.eventType.startsWith('alert.')).length;

  return (
    <>
      <DiamondRule tone="gold" label="Konformität" />
      <p style={{ ...caption, marginTop: 8, marginBottom: 16 }}>
        Das fälschungssichere Prüfprotokoll (hash-chained). Jedes fiskalische und AML-Ereignis —
        {alerts > 0 ? ` ${alerts} Warnung(en) in der Ansicht.` : ' keine Warnungen in der Ansicht.'}
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={caption}>Lädt Prüfprotokoll …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={caption}>Noch keine Ereignisse im Protokoll.</p>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Zeit</th>
                <th style={th}>Ereignis</th>
                <th style={th}>Entität</th>
                <th style={th}>Akteur</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td
                    style={{
                      ...td,
                      fontFamily: 'var(--w14-font-mono)',
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatTs(e.createdAt)}
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <StatusDot tone={eventTone(e.eventType)} size={9} />
                      <span style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.82rem' }}>
                        {e.eventType}
                      </span>
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: '0.82rem' }}>
                    {e.entityTable} · {e.entityId.slice(0, 8)}
                  </td>
                  <td style={{ ...td, fontFamily: 'var(--w14-font-mono)', fontSize: '0.8rem' }}>
                    {e.actorUserId ? e.actorUserId.slice(0, 8) : 'System'}
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
