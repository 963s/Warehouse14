/**
 * Risikoanalyse — the analytical view over the risk signals that until now only
 * lived as `alert.*` ledger events: an alert rollup by type over the trailing 30
 * days, a recent-alert feed, and the customer watchlist (SUSPICIOUS / BANNED /
 * sanctions / PEP). Reads `GET /api/risk/overview` (ADMIN, read-only).
 *
 * Ported into tauri-pos as a pure ADDITION; the local `Dot` stands in for the
 * control-desktop StatusDot (ui-kit has none).
 */

import { type CSSProperties, type ReactNode } from 'react';

import { useQuery } from '@tanstack/react-query';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

type DotTone = 'ok' | 'watch' | 'alert' | 'info';

function Dot({ tone, size = 10 }: { tone: DotTone; size?: number }): JSX.Element {
  const color =
    tone === 'ok'
      ? '#5aa469'
      : tone === 'watch'
        ? 'var(--w14-gold, #c9a55c)'
        : tone === 'alert'
          ? 'var(--w14-wax-red, #b23a2e)'
          : 'var(--w14-ink-faded)';
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }}
    />
  );
}

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

// ── Edge protection (Cloudflare) ─────────────────────────────────────────────

type EdgeData =
  | { configured: false }
  | { configured: true; available: false }
  | {
      configured: true;
      available: true;
      windowDays: number;
      since: string;
      totalThreats: number;
      totalRequests: number;
      daily: Array<{ date: string; threats: number; requests: number }>;
      byCountry: Array<{ country: string; threats: number }>;
    };

const de0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const LAND_DE = new Intl.DisplayNames(['de'], { type: 'region' });
/** ISO-3166 alpha-2 → German country name; unknown codes stay as-is. */
function landName(code: string): string {
  try {
    return LAND_DE.of(code) ?? code;
  } catch {
    return code;
  }
}
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function EdgeSchutz(): JSX.Element {
  const client = useApiClient();
  const q = useQuery<EdgeData>({
    queryKey: ['risk', 'edge'],
    queryFn: () => client.request<EdgeData>('GET', '/api/risk/edge'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const d = q.data;

  return (
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
        Edge-Schutz · Cloudflare
      </div>

      {q.isLoading ? (
        <p style={captionStyle}>Lädt Edge-Schutz …</p>
      ) : !d || !d.configured ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Dot tone="info" size={10} />
          <p style={captionStyle}>
            Cloudflare-Analyse ist nicht konfiguriert. Sobald der API-Schlüssel hinterlegt ist,
            erscheinen hier die abgewehrten Zugriffe.
          </p>
        </div>
      ) : !d.available ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Dot tone="watch" size={10} />
          <p style={captionStyle}>Cloudflare-Daten derzeit nicht abrufbar.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'baseline', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: '2rem', fontFamily: 'var(--w14-font-display)', color: 'var(--w14-ink)' }}>
                {de0.format(d.totalThreats)}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
                abgewehrte Bedrohungen · letzte {d.windowDays} Tage
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.3rem', fontFamily: 'var(--w14-font-display)', color: 'var(--w14-ink-faded)' }}>
                {de0.format(d.totalRequests)}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Anfragen gesamt am Rand</div>
            </div>
          </div>

          {/* Threats per day — a small engraved bar row. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 54, marginBottom: 14 }}>
            {d.daily.map((day) => {
              const max = Math.max(1, ...d.daily.map((x) => x.threats));
              const h = day.threats === 0 ? 2 : Math.max(4, Math.round((day.threats / max) * 46));
              return (
                <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div
                    title={`${dayLabel(day.date)}: ${de0.format(day.threats)}`}
                    style={{
                      width: '100%',
                      height: h,
                      borderRadius: 2,
                      background: day.threats === 0 ? 'var(--w14-parchment-3)' : 'var(--w14-gold)',
                    }}
                  />
                  <span style={{ fontSize: '0.6rem', color: 'var(--w14-ink-faded)', whiteSpace: 'nowrap' }}>
                    {dayLabel(day.date).slice(0, 2)}
                  </span>
                </div>
              );
            })}
          </div>

          {d.byCountry.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Dot tone="ok" size={10} />
              <p style={captionStyle}>Keine Bedrohung im Zeitraum. Ruhig an der Grenze.</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--w14-ink-faded)', marginBottom: 8 }}>
                Herkunft der Bedrohungen
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.byCountry.map((c) => (
                  <div key={c.country} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 200, fontSize: '0.9rem' }}>{landName(c.country)}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--w14-parchment-3)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${d.totalThreats > 0 ? Math.round((c.threats / d.totalThreats) * 100) : 0}%`,
                          height: '100%',
                          background: 'var(--w14-gold)',
                        }}
                      />
                    </div>
                    <span style={{ width: 56, textAlign: 'right', fontFamily: 'var(--w14-font-mono)', fontSize: '0.9rem' }}>
                      {de0.format(c.threats)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <p style={{ ...captionStyle, marginTop: 12 }}>
            Cloudflare zählt hier gestoppte Bedrohungen. Die Aufschlüsselung nach Art der Abwehr
            (Blockade oder Challenge) gehört zu einem kostenpflichtigen Tarif und bleibt deshalb leer,
            statt geraten zu werden.
          </p>
        </>
      )}
    </ParchmentCard>
  );
}

function WatchTile({ label, value, tone }: { label: string; value: ReactNode; tone: DotTone }): JSX.Element {
  return (
    <ParchmentCard tone="parchment" padding="md" style={{ flex: '1 1 150px', minWidth: 150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot tone={tone} size={10} />
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
      <div style={{ marginTop: 8, fontSize: '1.6rem', fontFamily: 'var(--w14-font-display)' }}>{value}</div>
    </ParchmentCard>
  );
}

export function Risikoanalyse(): JSX.Element {
  const client = useApiClient();

  const query = useQuery<RiskOverview>({
    queryKey: ['risk', 'overview'],
    queryFn: () => client.request<RiskOverview>('GET', '/api/risk/overview'),
    staleTime: 30_000,
  });

  const d = query.data;
  const countRows = d ? Object.entries(d.alertCounts).sort((a, b) => b[1] - a[1]) : [];
  const maxCount = countRows.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div style={{ padding: 20 }}>
      <DiamondRule tone="gold" label="Risikoanalyse" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 640 }}>
        Warnsignale der letzten {d?.windowDays ?? 30} Tage im Überblick: Auffälligkeiten,
        Strukturierung, Sanktions- und PEP-Treffer sowie die Beobachtungsliste der Kunden.
      </p>

      <EdgeSchutz />

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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, maxWidth: 920 }}>
            <WatchTile label="Verdächtig" value={d.watchlist.suspicious} tone="watch" />
            <WatchTile label="Gesperrt" value={d.watchlist.banned} tone="alert" />
            <WatchTile label="Sanktionen" value={d.watchlist.sanctions} tone="alert" />
            <WatchTile label="PEP" value={d.watchlist.pep} tone="watch" />
          </div>

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
                <Dot tone="ok" size={10} />
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
                      style={{ width: 36, textAlign: 'right', fontFamily: 'var(--w14-font-mono)', fontSize: '0.9rem' }}
                    >
                      {n}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ParchmentCard>

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
                      <Dot tone="watch" size={8} />
                      <span style={{ fontSize: '0.92rem' }}>{alertLabel(a.eventType)}</span>
                    </span>
                    <span
                      style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}
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
    </div>
  );
}
