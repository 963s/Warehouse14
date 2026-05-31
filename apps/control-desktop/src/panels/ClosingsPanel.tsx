/**
 * ClosingsPanel — the Kassenabschluss surface (digit 3). The owner's
 * back-office view of every daily closing (Z-Bon) + the bookkeeping export the
 * Steuerberater/Finanzamt asks for. Read-only oversight on top of
 * `GET /api/closings`, with a per-day DATEV CSV download
 * (`/api/closings/:id/export/datev`, ADMIN + PIN step-up).
 *
 * Answers in one glance: "did every day close cleanly, and can I hand the
 * books over right now?" — cash-drawer variance and TSE failures are flagged.
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

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

interface ClosingItem {
  id: string;
  businessDay: string;
  state: 'COUNTING' | 'FINALIZED';
  verkaufCount: number;
  ankaufCount: number;
  stornoCount: number;
  netVerkaufEur: string;
  netAnkaufEur: string;
  cashVarianceEur: string | null;
  tseFailedCount: number;
  finalizedAt: string | null;
}

interface ClosingsResponse {
  items: ClosingItem[];
}

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  borderBottom: '1px solid var(--w14-ink-faded)',
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--w14-parchment-3)',
  verticalAlign: 'middle',
};

/** Berlin date string (YYYY-MM-DD) → readable de-DE date. */
function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Variance tone: exact zero or null = ok, anything else = watch (needs a look). */
function varianceTone(v: string | null): StatusTone {
  if (v === null) return 'info';
  return Number.parseFloat(v) === 0 ? 'ok' : 'watch';
}

export function ClosingsPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [toasts, setToasts] = useState<ToastShape[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);

  const pushToast = (tone: ToastShape['tone'], title: string, body?: string): void => {
    setToasts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), tone, title, autoDismissMs: 4000, ...(body ? { body } : {}) },
    ]);
  };
  const dismissToast = (id: string): void => setToasts((prev) => prev.filter((t) => t.id !== id));

  const query = useQuery<ClosingsResponse>({
    queryKey: ['closings', baseUrl],
    queryFn: () => client.request<ClosingsResponse>('GET', '/api/closings'),
    staleTime: 60_000,
  });

  /**
   * Stream the DATEV CSV (raw fetch — it's a file, not JSON) and trigger a
   * browser download. Cookie auth rides along; a 403 means a PIN step-up is
   * required for the export.
   */
  async function downloadDatev(item: ClosingItem): Promise<void> {
    setDownloading(item.id);
    try {
      const res = await fetch(`${baseUrl}/api/closings/${item.id}/export/datev`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 403) {
          pushToast(
            'alert',
            'PIN-Bestätigung nötig',
            'Der DATEV-Export verlangt eine frische PIN-Freigabe.',
          );
        } else {
          pushToast('alert', 'Export fehlgeschlagen', `HTTP ${res.status}`);
        }
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DATEV_${item.businessDay}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      pushToast(
        'success',
        'DATEV-Export geladen',
        `Buchungsstapel für ${formatDay(item.businessDay)}.`,
      );
    } catch (err) {
      pushToast(
        'alert',
        'Export fehlgeschlagen',
        err instanceof Error ? err.message : 'Netzwerkfehler',
      );
    } finally {
      setDownloading(null);
    }
  }

  const items = query.data?.items ?? [];

  return (
    <>
      <DiamondRule tone="gold" label="Kassenabschluss" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20 }}>
        Jeder Tagesabschluss (Z-Bon) im Überblick — und der DATEV-Export für den Steuerberater.
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Lädt Abschlüsse …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot tone="info" size={12} />
            <p style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontSize: '1.15rem' }}>
              Noch keine Tagesabschlüsse
            </p>
          </div>
          <p style={{ ...captionStyle, marginTop: 8 }}>
            Sobald an der Kasse ein Z-Bon gezogen wird, erscheint er hier.
          </p>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thStyle}>Tag</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Verkauf (netto)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Ankauf (netto)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Kassendiff.</th>
                <th style={thStyle}>TSE</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Export</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td
                    style={{
                      ...tdStyle,
                      fontFamily: 'var(--w14-font-display)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatDay(item.businessDay)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <StatusDot tone={item.state === 'FINALIZED' ? 'ok' : 'watch'} size={9} />
                      <span style={{ fontSize: '0.85rem' }}>
                        {item.state === 'FINALIZED' ? 'Abgeschlossen' : 'Zählung'}
                      </span>
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <MoneyAmount valueEur={item.netVerkaufEur} />
                    <span style={{ ...captionStyle, display: 'block', fontSize: '0.75rem' }}>
                      {item.verkaufCount} Verk.
                      {item.stornoCount > 0 ? ` · ${item.stornoCount} Storno` : ''}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <MoneyAmount valueEur={item.netAnkaufEur} />
                    <span style={{ ...captionStyle, display: 'block', fontSize: '0.75rem' }}>
                      {item.ankaufCount} Ank.
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        justifyContent: 'flex-end',
                      }}
                    >
                      <StatusDot tone={varianceTone(item.cashVarianceEur)} size={9} />
                      {item.cashVarianceEur === null ? (
                        <span style={captionStyle}>—</span>
                      ) : (
                        <MoneyAmount valueEur={item.cashVarianceEur} signed />
                      )}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <StatusDot tone={item.tseFailedCount > 0 ? 'alert' : 'ok'} size={9} />
                      <span style={{ fontSize: '0.85rem' }}>
                        {item.tseFailedCount > 0 ? `${item.tseFailedCount} Fehler` : 'OK'}
                      </span>
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <Button
                      className="w14cd-focusable"
                      variant="ghost"
                      size="sm"
                      disabled={downloading === item.id}
                      onClick={() => {
                        void downloadDatev(item);
                      }}
                    >
                      {downloading === item.id ? '…' : 'DATEV'}
                    </Button>
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
