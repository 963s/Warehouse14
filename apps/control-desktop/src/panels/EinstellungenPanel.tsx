/**
 * EinstellungenPanel — the Einstellungen surface (digit 8). Owner read-only
 * view on `GET /api/settings`: the system_settings tunables (step-up threshold,
 * anomaly sigma, eBay/duress config …) and the paired device fleet with cert
 * headroom. Editing tunables / revoking devices is a follow-up.
 */

import type { CSSProperties } from 'react';

import { useQuery } from '@tanstack/react-query';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

interface SettingItem {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string;
}

interface DeviceItem {
  id: string;
  deviceClass: string;
  status: string;
  certExpiresAt: string;
  lastSeenAt: string | null;
}

interface SettingsResponse {
  settings: SettingItem[];
  devices: DeviceItem[];
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

/** Days until a device cert expires → status tone. */
function certTone(certExpiresAt: string): StatusTone {
  const days = (new Date(certExpiresAt).getTime() - Date.now()) / 86_400_000;
  if (days < 7) return 'alert';
  if (days < 30) return 'watch';
  return 'ok';
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

export function EinstellungenPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();

  const query = useQuery<SettingsResponse>({
    queryKey: ['settings', baseUrl],
    queryFn: () => client.request<SettingsResponse>('GET', '/api/settings'),
    staleTime: 60_000,
  });

  const settings = query.data?.settings ?? [];
  const devices = query.data?.devices ?? [];

  return (
    <>
      <DiamondRule tone="gold" label="Einstellungen" />
      <p style={{ ...caption, marginTop: 8, marginBottom: 20 }}>
        Systemparameter und gekoppelte Geräte (nur Ansicht in V1).
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={caption}>Lädt Einstellungen …</p>
        </ParchmentCard>
      ) : (
        <div style={{ display: 'grid', gap: 24, maxWidth: 920 }}>
          {/* System settings */}
          <div>
            <DiamondRule tone="faded" label="Parameter" />
            <ParchmentCard tone="parchment" padding="md" style={{ overflowX: 'auto' }}>
              {settings.length === 0 ? (
                <p style={caption}>Keine Parameter hinterlegt.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={th}>Schlüssel</th>
                      <th style={th}>Wert</th>
                      <th style={th}>Beschreibung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.map((s) => (
                      <tr key={s.key}>
                        <td
                          style={{ ...td, fontFamily: 'var(--w14-font-mono)', fontSize: '0.82rem' }}
                        >
                          {s.key}
                        </td>
                        <td
                          style={{ ...td, fontFamily: 'var(--w14-font-mono)', fontSize: '0.82rem' }}
                        >
                          {s.value}
                        </td>
                        <td style={{ ...td, fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
                          {s.description ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ParchmentCard>
          </div>

          {/* Devices */}
          <div>
            <DiamondRule tone="faded" label="Geräte" />
            <ParchmentCard tone="parchment" padding="md" style={{ overflowX: 'auto' }}>
              {devices.length === 0 ? (
                <p style={caption}>Keine Geräte gekoppelt.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={th}>Klasse</th>
                      <th style={th}>Status</th>
                      <th style={th}>Zertifikat bis</th>
                      <th style={th}>Zuletzt gesehen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => (
                      <tr key={d.id}>
                        <td style={{ ...td, fontSize: '0.85rem' }}>{d.deviceClass}</td>
                        <td style={{ ...td, fontSize: '0.85rem' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <StatusDot tone={d.status === 'active' ? 'ok' : 'alert'} size={9} />
                            {d.status}
                          </span>
                        </td>
                        <td style={td}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <StatusDot tone={certTone(d.certExpiresAt)} size={9} />
                            <span style={{ fontSize: '0.85rem' }}>
                              {formatDate(d.certExpiresAt)}
                            </span>
                          </span>
                        </td>
                        <td style={{ ...td, fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
                          {d.lastSeenAt ? formatDate(d.lastSeenAt) : 'nie'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ParchmentCard>
          </div>
        </div>
      )}
    </>
  );
}
