/**
 * KonformitaetPanel — the Konformität surface (digit 7). The compliance trail:
 * the append-only `ledger_events` audit log on `GET /api/ledger` (ADMIN).
 * Every fiscal + AML event is here, hash-chained server-side. Answers "what
 * happened, who did it, and is anything flagged?".
 *
 * It also hosts the An-/Verkaufsbuch export — the GwG §10 / §38 GewO purchase
 * register an inspector asks for: who we bought from (ID-verified) and what.
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { ApiError, registersApi } from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  ParchmentCard,
  ToastContainer,
  type ToastShape,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';
import { actorInfo, describeError, entityLabel, eventLabel, shortId } from '@warehouse14/i18n-de';

interface LedgerRow {
  id: number;
  eventType: string;
  entityTable: string;
  entityId: string;
  actorUserId: string | null;
  createdAt: string;
  /** Owner-trusted event payload; carries a cashier name for some events. */
  payload?: unknown;
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
const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  marginBottom: 4,
};
const inputStyle: CSSProperties = {
  padding: '7px 9px',
  border: '1px solid var(--w14-parchment-3)',
  borderRadius: 6,
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontSize: '0.9rem',
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

/** YYYY-MM-DD for a Date (local). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function KonformitaetPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();

  const now = new Date();
  const [direction, setDirection] = useState<'ANKAUF' | 'VERKAUF'>('ANKAUF');
  const [from, setFrom] = useState<string>(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState<string>(ymd(now));
  const [downloading, setDownloading] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastShape[]>([]);

  const pushToast = (tone: ToastShape['tone'], title: string, body?: string): void => {
    setToasts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), tone, title, autoDismissMs: 4500, ...(body ? { body } : {}) },
    ]);
  };
  const dismissToast = (id: string): void => setToasts((prev) => prev.filter((t) => t.id !== id));

  /**
   * Stream the An-/Verkaufsbuch CSV via the ApiClient. Routing through the client
   * (not a raw fetch) means the 403 STEP_UP_REQUIRED it raises — the register
   * decrypts counterparty identity, so it demands a fresh PIN — is caught by the
   * wired step-up middleware: the PIN modal opens and the request replays once.
   */
  async function downloadRegister(): Promise<void> {
    setDownloading(true);
    try {
      const csv = await registersApi.anVerkaufsbuchCsv(client, { direction, from, to });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `An-Verkaufsbuch_${direction}_${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      pushToast(
        'success',
        'An-/Verkaufsbuch geladen',
        `${direction === 'ANKAUF' ? 'Ankäufe' : 'Verkäufe'} ${from} – ${to}.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        pushToast('alert', 'Export abgebrochen', 'Die PIN-Bestätigung wurde abgebrochen.');
      } else {
        pushToast('alert', 'Export fehlgeschlagen', describeError(err));
      }
    } finally {
      setDownloading(false);
    }
  }

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

      <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: 'var(--w14-ink)' }}>
          An-/Verkaufsbuch
        </h3>
        <p style={{ ...caption, marginBottom: 14 }}>
          Das gesetzliche Register (GwG §10 · §38 GewO): geprüfte Verkäufer-Identität + Gegenstände
          für einen Zeitraum, als CSV zur Vorlage bei einer Prüfung.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 14 }}>
          <div>
            <label style={fieldLabel} htmlFor="av-richtung">
              Richtung
            </label>
            <select
              id="av-richtung"
              style={inputStyle}
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'ANKAUF' | 'VERKAUF')}
            >
              <option value="ANKAUF">Ankauf (Verkäufer)</option>
              <option value="VERKAUF">Verkauf (Käufer)</option>
            </select>
          </div>
          <div>
            <label style={fieldLabel} htmlFor="av-von">
              Von
            </label>
            <input
              id="av-von"
              type="date"
              style={inputStyle}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label style={fieldLabel} htmlFor="av-bis">
              Bis
            </label>
            <input
              id="av-bis"
              type="date"
              style={inputStyle}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button
            className="w14cd-focusable"
            variant="primary"
            size="md"
            onClick={downloadRegister}
            disabled={downloading || from > to}
          >
            {downloading ? 'Lädt …' : 'CSV exportieren'}
          </Button>
        </div>
      </ParchmentCard>

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
                      <span style={{ fontSize: '0.85rem' }}>{eventLabel(e.eventType)}</span>
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: '0.82rem' }}>
                    {entityLabel(e.entityTable)}
                    {shortId(e.entityId) ? (
                      <span style={{ color: 'var(--w14-ink-faded)' }}> · {shortId(e.entityId)}</span>
                    ) : null}
                  </td>
                  <td style={{ ...td, fontSize: '0.82rem' }}>
                    {actorInfo(e.actorUserId, e.payload).label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ParchmentCard>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
