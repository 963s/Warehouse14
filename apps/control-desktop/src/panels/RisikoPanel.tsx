/**
 * RisikoPanel — the Risikoanalyse surface (B2). The analytical view over the
 * risk signals that until now only lived as `alert.*` ledger events: an alert
 * rollup by type over the trailing 30 days, a recent-alert feed, and the
 * customer watchlist (SUSPICIOUS / BANNED / sanctions / PEP).
 *
 * Reads `GET /api/risk/overview` (ADMIN, read-only). Mirrors the FinanzenPanel
 * chrome. German throughout; alert tokens are mapped to readable labels.
 */

import { type CSSProperties, type ReactNode } from 'react';

import { useQuery } from '@tanstack/react-query';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

interface RiskOverview {
  windowDays: number;
  totalAlerts: number;
  alertCounts: Record<string, number>;
  recentAlerts: Array<{ id: string; eventType: string; createdAt: string }>;
  watchlist: { suspicious: number; banned: number; sanctions: number; pep: number };
}

const ALERT_DE: Record<string, string> = {
  'alert.suspicious_aml_flagged': 'Geldwäsche-Verdacht',
  'alert.smurfing_detected': 'Strukturierung erkannt',
  'alert.anomaly_detected': 'Auffälliges Muster',
  'alert.customer_marked_suspicious': 'Kunde als verdächtig markiert',
  'alert.customer_banned': 'Kunde gesperrt',
  'alert.ebay_sale_conflict': 'eBay-Verkaufskonflikt',
  'alert.ebay_double_sale_attempt': 'eBay-Doppelverkauf',
  'alert.hash_chain_verification_failed': 'Prüfsummenkette fehlerhaft',
  'alert.worker_job_dead_letter': 'Hintergrundjob fehlgeschlagen',
  'alert.tse_cert_expiry': 'TSE-Zertifikat läuft ab',
  'alert.tse_critical_failure': 'TSE: kritischer Fehler',
  'alert.duress': 'Notfall-Anmeldung',
};

/** Human label for an alert event type (mapped, else de-tokenised). */
function alertLabel(eventType: string): string {
  const m = ALERT_DE[eventType];
  if (m) return m;
  return eventType
    .replace(/^alert\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function WatchTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone: StatusTone;
}): JSX.Element {
  return (
    <ParchmentCard tone="parchment" padding="md" style={{ flex: '1 1 150px', minWidth: 150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot tone={tone} size={10} />
        <span
          style={{
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: '1.6rem', fontFamily: 'var(--w14-font-display)' }}>
        {value}
      </div>
    </ParchmentCard>
  );
}

export function RisikoPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();

  const query = useQuery<RiskOverview>({
    queryKey: ['risk', 'overview', baseUrl],
    queryFn: () => client.request<RiskOverview>('GET', '/api/risk/overview'),
    staleTime: 30_000,
  });

  const d = query.data;
  const countRows = d
    ? Object.entries(d.alertCounts).sort((a, b) => b[1] - a[1])
    : [];
  const maxCount = countRows.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <>
      <DiamondRule tone="gold" label="Risikoanalyse" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 640 }}>
        Warnsignale der letzten {d?.windowDays ?? 30} Tage im Überblick: Auffälligkeiten,
        Strukturierung, Sanktions- und PEP-Treffer sowie die Beobachtungsliste der Kunden.
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Lädt Risikoübersicht …</p>
        </ParchmentCard>
      ) : !d ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Risikoübersicht derzeit nicht verfügbar.</p>
        </ParchmentCard>
      ) : (
        <>
          {/* Watchlist tiles. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, maxWidth: 920 }}>
            <WatchTile label="Verdächtig" value={d.watchlist.suspicious} tone="watch" />
            <WatchTile label="Gesperrt" value={d.watchlist.banned} tone="alert" />
            <WatchTile label="Sanktionen" value={d.watchlist.sanctions} tone="alert" />
            <WatchTile label="PEP" value={d.watchlist.pep} tone="watch" />
          </div>

          {/* Alert counts by type. */}
          <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, marginBottom: 20 }}>
            <div
              style={{
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--w14-ink-faded)',
                marginBottom: 12,
              }}
            >
              Warnungen nach Art · {d.totalAlerts} gesamt
            </div>
            {countRows.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StatusDot tone="ok" size={10} />
                <p style={captionStyle}>Keine Warnungen im Zeitraum. Alles ruhig.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {countRows.map(([type, n]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 220, fontSize: '0.9rem' }}>{alertLabel(type)}</span>
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        background: 'var(--w14-parchment-3)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${maxCount > 0 ? Math.round((n / maxCount) * 100) : 0}%`,
                          height: '100%',
                          background: 'var(--w14-gold)',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        width: 36,
                        textAlign: 'right',
                        fontFamily: 'var(--w14-font-mono)',
                        fontSize: '0.9rem',
                      }}
                    >
                      {n}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ParchmentCard>

          {/* Recent alerts. */}
          <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920 }}>
            <div
              style={{
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--w14-ink-faded)',
                marginBottom: 10,
              }}
            >
              Letzte Warnungen
            </div>
            {d.recentAlerts.length === 0 ? (
              <p style={captionStyle}>Keine Einträge.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {d.recentAlerts.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--w14-parchment-3)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <StatusDot tone="watch" size={8} />
                      <span style={{ fontSize: '0.92rem' }}>{alertLabel(a.eventType)}</span>
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--w14-font-mono)',
                        fontSize: '0.8rem',
                        color: 'var(--w14-ink-faded)',
                      }}
                    >
                      {formatDateTime(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ParchmentCard>
        </>
      )}
    </>
  );
}
