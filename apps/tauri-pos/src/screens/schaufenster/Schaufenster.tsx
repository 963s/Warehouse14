/**
 * Schaufenster — wer vor dem Fenster steht.
 *
 * Die Reichweite von warehouse14.de, wie Cloudflare sie am Rand sieht. Bewusst
 * eine ANDERE Linse als die Kasse: ein Besucher ist kein Kunde. Die Zahlen hier
 * beantworten „wer schaut herein", nicht „wer hat gekauft".
 *
 * Ehrlichkeit: eindeutige Besucher werden nie über Tage addiert (derselbe Mensch
 * an zwei Tagen ist ein Mensch), darum Schnitt und Spitze statt Summe. Und weil
 * die Zone auch die App-Schnittstelle trägt, wird der Anteil des Ladens getrennt
 * ausgewiesen, statt ihn stillschweigend aufzublähen.
 */

import { useQuery } from '@tanstack/react-query';
import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

type Traffic =
  | { configured: false }
  | { configured: true; available: false }
  | {
      configured: true;
      available: true;
      windowDays: number;
      since: string;
      until: string;
      totals: { pageViews: number; requests: number; bytes: number; threats: number; serverErrors: number; clientErrors: number };
      visitors: { avgPerDay: number; peak: number; peakDate: string | null };
      daily: Array<{ date: string; uniques: number; pageViews: number; requests: number; bytes: number }>;
      topCountries: Array<{ country: string; count: number }>;
      browsers: Array<{ browser: string; count: number }>;
      statuses: Array<{ status: number; count: number }>;
      hosts: Array<{ host: string; requests: number }>;
      hostWindowHours: number;
    };

const de0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const de1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const LAND_DE = new Intl.DisplayNames(['de'], { type: 'region' });

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
function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${de1.format(n / 1_073_741_824)} GB`;
  if (n >= 1_048_576) return `${de0.format(n / 1_048_576)} MB`;
  return `${de0.format(n / 1024)} kB`;
}
const caption: React.CSSProperties = { fontSize: '0.82rem', color: 'var(--w14-ink-faded)', lineHeight: 1.5, margin: 0 };
const eyebrow: React.CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  marginBottom: 12,
};

/** A big engraved figure with its caption. */
function Kennzahl({ value, label, hint }: { value: string; label: string; hint?: string }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: '2rem', fontFamily: 'var(--w14-font-display)', color: 'var(--w14-ink)', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>{label}</div>
      {hint != null && <div style={{ fontSize: '0.7rem', color: 'var(--w14-ink-faded)', opacity: 0.8 }}>{hint}</div>}
    </div>
  );
}

/** A labelled proportional bar row. */
function BarRow({ label, count, total }: { label: string; count: number; total: number }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 200, fontSize: '0.9rem' }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: 'var(--w14-parchment-3)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${total > 0 ? Math.round((count / total) * 100) : 0}%`, height: '100%', background: 'var(--w14-gold)' }} />
      </div>
      <span style={{ width: 72, textAlign: 'right', fontFamily: 'var(--w14-font-mono)', fontSize: '0.9rem' }}>
        {de0.format(count)}
      </span>
    </div>
  );
}

export function Schaufenster(): JSX.Element {
  const client = useApiClient();
  const q = useQuery<Traffic>({
    queryKey: ['storefront', 'traffic'],
    queryFn: () => client.request<Traffic>('GET', '/api/storefront/traffic'),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const d = q.data;

  const shopHost = d?.configured && d.available ? d.hosts.find((h) => h.host === 'warehouse14.de') : undefined;
  const hostTotal = d?.configured && d.available ? d.hosts.reduce((s, h) => s + h.requests, 0) : 0;

  return (
    <div style={{ padding: 20 }}>
      <DiamondRule tone="gold" label="Schaufenster" />
      <p style={{ ...caption, maxWidth: 640, marginTop: 8, marginBottom: 18 }}>
        Wer vor dem Fenster steht. Die Reichweite des Ladens, wie Cloudflare sie am Rand zählt.
        Das ist eine andere Linse als die Kasse: ein Besucher ist noch kein Kunde.
      </p>

      {q.isLoading ? (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920 }}>
          <p style={caption}>Lädt Schaufenster …</p>
        </ParchmentCard>
      ) : !d || !d.configured ? (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920 }}>
          <div style={eyebrow}>Schaufenster · Cloudflare</div>
          <p style={caption}>
            Die Cloudflare-Analyse ist nicht konfiguriert. Sobald der Schlüssel hinterlegt ist,
            erscheinen hier die echten Besucherzahlen.
          </p>
        </ParchmentCard>
      ) : !d.available ? (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920 }}>
          <div style={eyebrow}>Schaufenster · Cloudflare</div>
          <p style={caption}>Cloudflare-Daten derzeit nicht abrufbar.</p>
        </ParchmentCard>
      ) : (
        <>
          {/* Die Kennzahlen */}
          <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, marginBottom: 20 }}>
            <div style={eyebrow}>
              Besucher · letzte {d.windowDays} Tage
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'baseline', marginBottom: 16 }}>
              <Kennzahl
                value={de0.format(d.visitors.avgPerDay)}
                label="Besucher im Schnitt pro Tag"
                {...(d.visitors.peakDate != null
                  ? { hint: `Spitze ${de0.format(d.visitors.peak)} am ${dayLabel(d.visitors.peakDate)}` }
                  : {})}
              />
              <Kennzahl value={de0.format(d.totals.pageViews)} label="Seitenaufrufe gesamt" />
              <Kennzahl value={formatBytes(d.totals.bytes)} label="ausgelieferte Daten" />
              <Kennzahl value={de0.format(d.totals.threats)} label="abgewehrte Bedrohungen" />
            </div>

            {/* Besucher pro Tag — engraved bars */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 92 }}>
              {d.daily.map((day) => {
                const max = Math.max(1, ...d.daily.map((x) => x.uniques));
                const h = day.uniques === 0 ? 2 : Math.max(5, Math.round((day.uniques / max) * 72));
                return (
                  <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: '0.7rem', fontFamily: 'var(--w14-font-mono)', color: 'var(--w14-ink)' }}>
                      {de0.format(day.uniques)}
                    </span>
                    <div style={{ width: '100%', height: h, borderRadius: 3, background: 'var(--w14-gold)' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--w14-ink-faded)', whiteSpace: 'nowrap' }}>
                      {dayLabel(day.date)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p style={{ ...caption, marginTop: 12 }}>
              Eindeutige Besucher werden pro Tag gezählt und bewusst nicht addiert: derselbe Mensch an
              zwei Tagen bleibt ein Mensch.
            </p>
          </ParchmentCard>

          {/* Woher sie kommen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, maxWidth: 920 }}>
            <ParchmentCard tone="parchment" padding="md">
              <div style={eyebrow}>Woher sie kommen</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.topCountries.map((c) => (
                  <BarRow key={c.country} label={landName(c.country)} count={c.count} total={d.totals.requests} />
                ))}
              </div>
            </ParchmentCard>

            <ParchmentCard tone="parchment" padding="md">
              <div style={eyebrow}>Womit sie schauen</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.browsers.map((b) => (
                  <BarRow key={b.browser} label={b.browser === 'Unknown' ? 'Unbekannt' : b.browser} count={b.count} total={d.totals.pageViews} />
                ))}
              </div>
              {d.browsers.length === 0 && <p style={caption}>Noch keine Seitenaufrufe im Zeitraum.</p>}
            </ParchmentCard>

            {/* Der Anteil des Ladens — the honest split */}
            <ParchmentCard tone="parchment" padding="md">
              <div style={eyebrow}>Anteil des Ladens · letzte {d.hostWindowHours} h</div>
              {d.hosts.length === 0 ? (
                <p style={caption}>Aufteilung derzeit nicht abrufbar.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {d.hosts.map((h) => (
                      <BarRow
                        key={h.host}
                        label={h.host === 'api.warehouse14.de' ? 'Schnittstelle der App' : h.host === 'warehouse14.de' ? 'Der Laden' : h.host}
                        count={h.requests}
                        total={hostTotal}
                      />
                    ))}
                  </div>
                  <p style={{ ...caption, marginTop: 10 }}>
                    Die Zone trägt Laden und App gemeinsam. {shopHost != null
                      ? `Vom Rand gehen ${de0.format(shopHost.requests)} Anfragen an den Laden selbst.`
                      : 'Der Laden hatte in diesem Fenster keine eigenen Anfragen.'}
                  </p>
                </>
              )}
            </ParchmentCard>

            {/* Gesundheit */}
            <ParchmentCard tone="parchment" padding="md">
              <div style={eyebrow}>Hat der Laden sauber geantwortet?</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'baseline', marginBottom: 12 }}>
                <Kennzahl value={de0.format(d.totals.serverErrors)} label="Serverfehler (5xx)" />
                <Kennzahl value={de0.format(d.totals.clientErrors)} label="Nicht gefunden u. Ä. (4xx)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.statuses.map((s) => (
                  <BarRow key={s.status} label={`Status ${s.status}`} count={s.count} total={d.totals.requests} />
                ))}
              </div>
              <p style={{ ...caption, marginTop: 10 }}>
                {d.totals.serverErrors === 0
                  ? 'Kein Serverfehler im Zeitraum. Das Fenster war stets offen.'
                  : 'Serverfehler bedeuten: ein Besucher stand vor einer kaputten Seite.'}
              </p>
            </ParchmentCard>
          </div>
        </>
      )}
    </div>
  );
}
