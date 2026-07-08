/**
 * EinstellungenPanel — the Einstellungen surface (digit 8).
 *
 * Reads `GET /api/settings` (system_settings tunables + paired device fleet).
 * The operator-tunable knobs — headlined by the Anomalie-Z-Wert-Schwelle —
 * are editable inline via `PATCH /api/settings/:key` (Owner + step-up, server
 * allow-list + range check). Everything else is shown read-only: the remaining
 * worker-/system-owned parameters and the device fleet (mTLS cert revocation is
 * a security-sensitive operation without an endpoint, so devices stay glance-only).
 */

import { type CSSProperties, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, authPin } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';
import { clearSessionToken } from '../lib/session-token.js';
import { useSessionStore } from '../state/session-store.js';
import { isStepUpCancelled } from '../state/step-up-store.js';
import { describeError } from '@warehouse14/i18n-de';

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

/**
 * The operator-tunable settings the Owner may edit here. Must stay in lockstep
 * with the server allow-list in `apps/api-cloud/src/routes/settings.ts`.
 */
interface EditableSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Unit suffix shown next to the input (e.g. "%", "EUR", "Tage"). */
  unit?: string;
}
const EDITABLE: Record<string, EditableSpec> = {
  'anomaly.sigma_threshold': {
    label: 'Z-Wert-Schwelle für Anomalie-Alarm',
    min: 2.0,
    max: 4.0,
    step: 0.1,
    unit: 'σ',
  },
  'ai_budget.daily_eur.total': {
    label: 'KI-Tagesbudget',
    min: 0,
    max: 100_000,
    step: 1,
    unit: 'EUR',
  },
  'ai_budget.alert_threshold_pct': {
    label: 'KI-Warnschwelle',
    min: 1,
    max: 100,
    step: 1,
    unit: '%',
  },
  'ai_budget.hard_stop_threshold_pct': {
    label: 'KI-Stoppschwelle',
    min: 50,
    max: 300,
    step: 5,
    unit: '%',
  },
  'appointment.no_show_grace_minutes': {
    label: 'Kulanz bis No-Show',
    min: 0,
    max: 240,
    step: 5,
    unit: 'Min.',
  },
  'smurfing.ankauf_count_window_days': {
    label: 'Smurfing-Beobachtungsfenster',
    min: 1,
    max: 90,
    step: 1,
    unit: 'Tage',
  },
  'smurfing.ankauf_count_threshold': {
    label: 'Smurfing-Schwellenanzahl',
    min: 1,
    max: 20,
    step: 1,
  },
  'cash_drawer.variance_alert_threshold_eur': {
    label: 'Kassendifferenz-Alarm',
    min: 0,
    max: 1_000,
    step: 1,
    unit: 'EUR',
  },
};

/**
 * Free-text shop identity printed on the receipt header (migration 0044). Must
 * stay in lockstep with the `shop.*` text keys in the server allow-list.
 */
interface TextSpec {
  label: string;
  maxLen: number;
}
const TEXT_EDITABLE: Record<string, TextSpec> = {
  'shop.name': { label: 'Geschäftsname', maxLen: 80 },
  'shop.tagline': { label: 'Slogan', maxLen: 80 },
  'shop.address_line1': { label: 'Adresse, Zeile 1 (Straße)', maxLen: 100 },
  'shop.address_line2': { label: 'Adresse, Zeile 2 (PLZ Ort)', maxLen: 100 },
  'shop.vat_id': { label: 'USt-IdNr.', maxLen: 20 },
  'shop.phone': { label: 'Telefon', maxLen: 32 },
};
const SHOP_ORDER = [
  'shop.name',
  'shop.tagline',
  'shop.address_line1',
  'shop.address_line2',
  'shop.vat_id',
  'shop.phone',
];

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

/** Strip the JSON-string quotes money values carry ("5.00" → 5). */
function parseSettingValue(raw: string): number {
  const unquoted = raw.replace(/^"|"$/g, '');
  return Number.parseFloat(unquoted);
}

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

function germanError(err: unknown): string {
  // A cancelled PIN modal rejects with a plain StepUpCancelledError (not an
  // ApiError) — catch it here so a deliberate cancel is not misreported as a
  // "Verbindung gestört" network failure.
  if (isStepUpCancelled(err)) return 'PIN-Bestätigung wurde abgebrochen.';
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'STEP_UP_REQUIRED':
        return 'PIN-Bestätigung wurde abgebrochen.';
      case 'DEVICE_NOT_AUTHORIZED':
        return 'Diese Änderung erfordert ein gekoppeltes Gerät (mTLS).';
      case 'FORBIDDEN':
        return 'Keine Berechtigung (ADMIN erforderlich).';
      default:
        return describeError(err);
    }
  }
  return 'Verbindung gestört. Bitte erneut versuchen.';
}

/** One editable tunable: number input + Speichern, with inline feedback. */
function EditableSettingRow({
  setting,
  spec,
}: { setting: SettingItem; spec: EditableSpec }): JSX.Element {
  const { client } = useApiClient();
  const qc = useQueryClient();
  const current = parseSettingValue(setting.value);
  const [draft, setDraft] = useState<string>(String(current));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(false);

  const mutation = useMutation({
    mutationFn: (value: number) =>
      client.request('PATCH', `/api/settings/${encodeURIComponent(setting.key)}`, { value }),
    onSuccess: async () => {
      setSaved(true);
      setError(null);
      await qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setSaved(false);
      setError(germanError(err));
    },
  });

  const parsed = Number.parseFloat(draft);
  const inRange = Number.isFinite(parsed) && parsed >= spec.min && parsed <= spec.max;
  const dirty = inRange && parsed !== current;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 16,
        alignItems: 'center',
        padding: '12px 4px',
        borderBottom: '1px solid var(--w14-parchment-3)',
      }}
    >
      <div>
        <div style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1rem' }}>{spec.label}</div>
        <div style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', marginTop: 2 }}>
          {setting.description ?? setting.key} · zulässig {spec.min} bis {spec.max}
          {spec.unit ? ` ${spec.unit}` : ''}
        </div>
        {error && (
          <div
            role="alert"
            style={{ color: 'var(--w14-wax-red)', fontSize: '0.8rem', marginTop: 4 }}
          >
            {error}
          </div>
        )}
        {saved && !dirty && !error && (
          <div style={{ color: 'var(--w14-verdigris)', fontSize: '0.8rem', marginTop: 4 }}>
            Gespeichert.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          className="w14cd-focusable"
          type="number"
          inputMode="decimal"
          value={draft}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          style={{
            width: 96,
            padding: '7px 10px',
            textAlign: 'right',
            border: `1px solid ${inRange ? 'var(--w14-ink-faded)' : 'var(--w14-wax-red)'}`,
            borderRadius: 'var(--w14-radius-button)',
            background: 'var(--w14-parchment)',
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-mono)',
          }}
        />
        {spec.unit && (
          <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem', minWidth: 28 }}>
            {spec.unit}
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={() => mutation.mutate(parsed)}
          disabled={!dirty || mutation.isPending}
        >
          {mutation.isPending ? 'Speichert…' : 'Speichern'}
        </Button>
      </div>
    </div>
  );
}

/** One editable free-text setting: text input + Speichern, inline feedback. */
function TextSettingRow({ setting, spec }: { setting: SettingItem; spec: TextSpec }): JSX.Element {
  const { client } = useApiClient();
  const qc = useQueryClient();
  const current = setting.value.replace(/^"|"$/g, '');
  const [draft, setDraft] = useState<string>(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(false);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      client.request('PATCH', `/api/settings/${encodeURIComponent(setting.key)}`, { value }),
    onSuccess: async () => {
      setSaved(true);
      setError(null);
      await qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setSaved(false);
      setError(germanError(err));
    },
  });

  const trimmed = draft.trim();
  const valid = trimmed.length > 0 && trimmed.length <= spec.maxLen;
  const dirty = valid && trimmed !== current;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr) auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 4px',
        borderBottom: '1px solid var(--w14-parchment-3)',
      }}
    >
      <div>
        <div style={{ fontFamily: 'var(--w14-font-display)', fontSize: '0.95rem' }}>
          {spec.label}
        </div>
        {error && (
          <div
            role="alert"
            style={{ color: 'var(--w14-wax-red)', fontSize: '0.78rem', marginTop: 2 }}
          >
            {error}
          </div>
        )}
        {saved && !dirty && !error && (
          <div style={{ color: 'var(--w14-verdigris)', fontSize: '0.78rem', marginTop: 2 }}>
            Gespeichert.
          </div>
        )}
      </div>
      <input
        className="w14cd-focusable"
        type="text"
        value={draft}
        maxLength={spec.maxLen}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        style={{
          padding: '7px 10px',
          border: `1px solid ${valid ? 'var(--w14-ink-faded)' : 'var(--w14-wax-red)'}`,
          borderRadius: 'var(--w14-radius-button)',
          background: 'var(--w14-parchment)',
          color: 'var(--w14-ink)',
          fontFamily: 'var(--w14-font-body)',
        }}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={() => mutation.mutate(trimmed)}
        disabled={!dirty || mutation.isPending}
      >
        {mutation.isPending ? 'Speichert…' : 'Speichern'}
      </Button>
    </div>
  );
}

/** Sign out of the governance session — the exit from the authenticated boundary. */
function AbmeldenSection(): JSX.Element {
  const { client } = useApiClient();
  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);
  const [busy, setBusy] = useState<boolean>(false);

  const signOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await authPin.signOut(client);
    } catch {
      // Best-effort: even if the server call fails, clear locally so the operator
      // is never stranded inside an authenticated shell.
    } finally {
      clearSessionToken();
      setUnauthenticated();
    }
  };

  return (
    <div>
      <DiamondRule tone="faded" label="Sitzung" />
      <ParchmentCard tone="parchment" padding="md">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <p style={{ ...caption, margin: 0 }}>
            Nach dem Abmelden ist wieder eine PIN-Eingabe erforderlich.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut()}
            disabled={busy}
            style={{ color: 'var(--w14-wax-red)' }}
          >
            {busy ? 'Meldet ab…' : 'Abmelden'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
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
  const editable = settings.filter((s) => EDITABLE[s.key]);
  const shopSettings = SHOP_ORDER.map((key) => settings.find((s) => s.key === key)).filter(
    (s): s is SettingItem => s !== undefined,
  );
  const readOnly = settings.filter((s) => !EDITABLE[s.key] && !TEXT_EDITABLE[s.key]);

  return (
    <>
      <DiamondRule tone="gold" label="Einstellungen" />
      <p style={{ ...caption, marginTop: 8, marginBottom: 20 }}>
        Schwellenwerte und Alarme bearbeiten, weitere Parameter und gekoppelte Geräte einsehen.
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={caption}>Lädt Einstellungen …</p>
        </ParchmentCard>
      ) : (
        <div style={{ display: 'grid', gap: 24, maxWidth: 920 }}>
          {/* Shop identity (receipt header) */}
          <div>
            <DiamondRule tone="faded" label="Geschäftsdaten (Beleg)" />
            <ParchmentCard tone="parchment" padding="md">
              {shopSettings.length === 0 ? (
                <p style={caption}>Keine Geschäftsdaten hinterlegt.</p>
              ) : (
                shopSettings.map((s) => (
                  <TextSettingRow key={s.key} setting={s} spec={TEXT_EDITABLE[s.key] as TextSpec} />
                ))
              )}
              <p style={{ ...caption, fontSize: '0.78rem', marginTop: 12 }}>
                Erscheint im Belegkopf. USt-IdNr. und Telefon sind vorläufig. Bitte durch die
                echten Werte ersetzen. Jede Änderung verlangt eine PIN-Bestätigung.
              </p>
            </ParchmentCard>
          </div>

          {/* Editable thresholds + alarms */}
          <div>
            <DiamondRule tone="faded" label="Schwellenwerte & Alarme" />
            <ParchmentCard tone="parchment" padding="md">
              {editable.length === 0 ? (
                <p style={caption}>Keine bearbeitbaren Schwellenwerte gefunden.</p>
              ) : (
                editable.map((s) => (
                  <EditableSettingRow
                    key={s.key}
                    setting={s}
                    spec={EDITABLE[s.key] as EditableSpec}
                  />
                ))
              )}
              <p style={{ ...caption, fontSize: '0.78rem', marginTop: 12 }}>
                Jede Änderung verlangt eine frische PIN-Bestätigung und wird im Protokoll erfasst.
              </p>
            </ParchmentCard>
          </div>

          {/* Read-only system/worker parameters */}
          <div>
            <DiamondRule tone="faded" label="Weitere Parameter" />
            <ParchmentCard tone="parchment" padding="md" style={{ overflowX: 'auto' }}>
              {readOnly.length === 0 ? (
                <p style={caption}>Keine weiteren Parameter hinterlegt.</p>
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
                    {readOnly.map((s) => (
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
                          {s.description ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ParchmentCard>
          </div>

          {/* Devices — read-only fleet */}
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

          {/* Session — the exit from the authenticated boundary */}
          <AbmeldenSection />
        </div>
      )}
    </>
  );
}
