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

import { ApiError, closingsApi } from '@warehouse14/api-client';
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
  const [finalizing, setFinalizing] = useState<boolean>(false);

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
   * Stream the DATEV CSV via the ApiClient and trigger a browser download.
   * Routing through the client (not a raw fetch) means a 403 STEP_UP_REQUIRED is
   * caught by the wired step-up middleware: the PIN modal opens and the request
   * replays once. A cancelled step-up surfaces as an honest "abgebrochen".
   */
  async function downloadDatev(item: ClosingItem): Promise<void> {
    setDownloading(item.id);
    try {
      const csv = await closingsApi.datevCsv(client, item.id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
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
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        pushToast('alert', 'Export abgebrochen', 'Die PIN-Bestätigung wurde abgebrochen.');
      } else {
        pushToast('alert', 'Export fehlgeschlagen', describeError(err));
      }
    } finally {
      setDownloading(null);
    }
  }

  /**
   * Stream the local DSFinV-K bundle ZIP (the DFKA-Taxonomie core export for a
   * §146b Kassen-Nachschau) and trigger a browser download. The client returns
   * the ZIP base64-encoded (?encoding=base64) — decode to bytes so the archive is
   * not corrupted. Same step-up flow as DATEV.
   */
  async function downloadDsfinvk(item: ClosingItem): Promise<void> {
    setDownloading(`${item.id}:dsfinvk`);
    try {
      const b64 = await closingsApi.dsfinvkZipBase64(client, item.id);
      // Base64 → bytes: a plain Blob([b64]) would ship the ASCII text and corrupt
      // the ZIP. Decode to a Uint8Array first.
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DSFinV-K_${item.businessDay}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      pushToast(
        'success',
        'DSFinV-K-Export geladen',
        `Kassendaten-Paket für ${formatDay(item.businessDay)} (Kern-Export — vor einer Prüfung mit dem DSFinV-K-Prüftool abgleichen).`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        pushToast('alert', 'Export abgebrochen', 'Die PIN-Bestätigung wurde abgebrochen.');
      } else {
        pushToast('alert', 'Export fehlgeschlagen', describeError(err));
      }
    } finally {
      setDownloading(null);
    }
  }

  /**
   * Finalize the legal Z-Bon (Tagesabschluss) for the current business day — the
   * act that aggregates the day's sales into the row every fiscal export reads.
   * Routed through the client so a 403 STEP_UP_REQUIRED opens the PIN modal and
   * replays; a 409 (open shift / already finalized) becomes an actionable German
   * line, never the server's raw English body.
   */
  async function runTagesabschluss(): Promise<void> {
    setFinalizing(true);
    try {
      const data = await closingsApi.finalize(client);
      pushToast(
        'success',
        'Tagesabschluss erstellt',
        `Z-Bon für ${formatDay(data.businessDay)} — ${data.verkaufCount} Verkäufe, Kassendiff. ${data.cashVarianceEur} EUR.`,
      );
      await query.refetch();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        pushToast('alert', 'Tagesabschluss abgebrochen', 'Die PIN-Bestätigung wurde abgebrochen.');
      } else if (err instanceof ApiError && err.httpStatus === 409) {
        pushToast(
          'alert',
          'Tagesabschluss nicht möglich',
          'Für diesen Geschäftstag besteht bereits ein Tagesabschluss oder er wird gerade erstellt.',
        );
      } else {
        pushToast(
          'alert',
          'Tagesabschluss fehlgeschlagen',
          'Der Tagesabschluss konnte nicht erstellt werden. Bitte später erneut versuchen.',
        );
      }
    } finally {
      setFinalizing(false);
    }
  }

  const items = query.data?.items ?? [];

  return (
    <>
      <DiamondRule tone="gold" label="Kassenabschluss" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 8,
          marginBottom: 20,
        }}
      >
        <p style={{ ...captionStyle, margin: 0, maxWidth: 620 }}>
          Jeder Tagesabschluss (Z-Bon) im Überblick — und der DATEV-Export für den Steuerberater.
          Der Tagesabschluss bündelt die Verkäufe des Tages zum gesetzlichen Z-Bon, den jede Prüfung
          verlangt.
        </p>
        <Button
          className="w14cd-focusable"
          variant="primary"
          size="md"
          disabled={finalizing}
          onClick={() => {
            void runTagesabschluss();
          }}
          style={{ flex: 'none', whiteSpace: 'nowrap' }}
        >
          {finalizing ? 'Wird abgeschlossen …' : 'Tagesabschluss durchführen'}
        </Button>
      </div>

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
                    <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
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
                      <Button
                        className="w14cd-focusable"
                        variant="ghost"
                        size="sm"
                        disabled={downloading === `${item.id}:dsfinvk`}
                        title="DSFinV-K · DFKA-Taxonomie Kassendaten (ZIP, Kern-Export)"
                        onClick={() => {
                          void downloadDsfinvk(item);
                        }}
                      >
                        {downloading === `${item.id}:dsfinvk` ? '…' : 'DSFinV-K'}
                      </Button>
                    </span>
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
