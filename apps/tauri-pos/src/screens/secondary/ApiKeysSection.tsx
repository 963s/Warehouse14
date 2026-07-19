/**
 * ApiKeysSection — mint / list / revoke programmatic API keys (Track E), living
 * inside Einstellungen. A manager gives an agent, LLM, or service a scoped key.
 * The plaintext secret is shown EXACTLY ONCE on creation (only its hash is
 * stored); everything else is metadata. Create + revoke are ADMIN + PIN step-up
 * server-side (the global step-up modal opens + replays transparently).
 *
 * Ported into tauri-pos as a pure ADDITION: uses the app's global toast store;
 * `Dot` stands in for the control-desktop StatusDot. Talks to `/api/api-keys`.
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { useToastStore } from '../../state/toast-store.js';

type KeyRole = 'ADMIN' | 'CASHIER' | 'READONLY';

interface ApiKeyRow {
  id: string;
  label: string;
  tokenPrefix: string;
  role: KeyRole;
  readOnly: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface ListResponse {
  items: ApiKeyRow[];
}
interface CreateResponse {
  ok: true;
  id: string;
  token: string;
  tokenPrefix: string;
}

const ROLE_DE: Record<KeyRole, string> = {
  ADMIN: 'Administrator',
  CASHIER: 'Kasse',
  READONLY: 'Nur Lesen',
};

function Dot({ tone, size = 9 }: { tone: 'ok' | 'info' | 'alert'; size?: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background:
          tone === 'ok' ? '#5aa469' : tone === 'alert' ? 'var(--w14-wax-red, #b23a2e)' : 'var(--w14-ink-faded)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
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
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-display)',
  fontSize: '0.95rem',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function ApiKeysSection(): JSX.Element {
  const client = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [label, setLabel] = useState('');
  const [role, setRole] = useState<KeyRole>('READONLY');
  const [readOnly, setReadOnly] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<{ token: string; label: string } | null>(null);

  const query = useQuery<ListResponse>({
    queryKey: ['api-keys'],
    queryFn: () => client.request<ListResponse>('GET', '/api/api-keys'),
    staleTime: 30_000,
  });

  function onError(err: unknown, failTitle: string): void {
    if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
      addToast({ tone: 'alert', title: 'Abgebrochen', body: 'Die PIN-Bestätigung wurde abgebrochen.' });
    } else {
      addToast({ tone: 'alert', title: failTitle, body: describeError(err) });
    }
  }

  async function createKey(): Promise<void> {
    if (creating || label.trim().length === 0) return;
    setCreating(true);
    try {
      const res = await client.request<CreateResponse>('POST', '/api/api-keys', {
        label: label.trim(),
        role,
        readOnly,
      });
      setFreshToken({ token: res.token, label: label.trim() });
      setLabel('');
      addToast({ tone: 'success', title: 'Schlüssel erstellt', body: 'Bitte jetzt kopieren, er wird nur einmal gezeigt.' });
      await query.refetch();
    } catch (err) {
      onError(err, 'Erstellung fehlgeschlagen');
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string): Promise<void> {
    setRevoking(id);
    try {
      await client.request('POST', `/api/api-keys/${encodeURIComponent(id)}/revoke`, {});
      addToast({ tone: 'success', title: 'Schlüssel widerrufen', body: 'Der Zugang wurde sofort gesperrt.' });
      await query.refetch();
    } catch (err) {
      onError(err, 'Widerruf fehlgeschlagen');
    } finally {
      setRevoking(null);
    }
  }

  async function copyToken(token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(token);
      addToast({ tone: 'success', title: 'Kopiert', body: 'Der Schlüssel liegt in der Zwischenablage.' });
    } catch {
      addToast({ tone: 'alert', title: 'Kopieren nicht möglich', body: 'Bitte den Schlüssel manuell markieren.' });
    }
  }

  const items = query.data?.items ?? [];

  return (
    <div>
      <DiamondRule tone="gold" label="API-Schlüssel" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 640 }}>
        Programmatische Zugänge für Agenten, KI-Dienste oder eigene Integrationen. Jeder Schlüssel
        trägt eine feste Rolle und kann auf „Nur Lesen“ beschränkt werden. Der Schlüssel wird nur
        einmal angezeigt, gespeichert wird ausschließlich seine Prüfsumme.
      </p>

      {freshToken && (
        <ParchmentCard
          tone="parchment"
          padding="lg"
          style={{ maxWidth: 720, marginBottom: 20, borderColor: 'var(--w14-gold)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Dot tone="ok" size={11} />
            <strong style={{ fontFamily: 'var(--w14-font-display)' }}>Neuer Schlüssel: {freshToken.label}</strong>
          </div>
          <p style={{ ...captionStyle, marginBottom: 10 }}>
            Kopieren Sie ihn jetzt. Aus Sicherheitsgründen kann er später nicht erneut angezeigt werden.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              background: 'var(--w14-parchment-2)',
              padding: '10px 12px',
              borderRadius: 'var(--w14-radius-button)',
            }}
          >
            <code style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.85rem', wordBreak: 'break-all', flex: 1 }}>
              {freshToken.token}
            </code>
            <Button variant="primary" size="sm" onClick={() => void copyToken(freshToken.token)}>
              Kopieren
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFreshToken(null)}>
              Fertig
            </Button>
          </div>
        </ParchmentCard>
      )}

      <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 720, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Bezeichnung</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="z. B. KI-Agent, Zapier"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Rolle</span>
            <select value={role} onChange={(e) => setRole(e.target.value as KeyRole)} style={inputStyle}>
              <option value="READONLY">Nur Lesen</option>
              <option value="CASHIER">Kasse</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
            <span style={{ fontSize: '0.9rem' }}>Nur Lesen erzwingen</span>
          </label>
          <Button variant="primary" size="md" disabled={creating || label.trim().length === 0} onClick={() => void createKey()}>
            {creating ? 'Wird erstellt …' : 'Schlüssel erstellen'}
          </Button>
        </div>
      </ParchmentCard>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Lädt Schlüssel …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Dot tone="info" size={11} />
            <p style={captionStyle}>Noch keine API-Schlüssel angelegt.</p>
          </div>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={thStyle}>Bezeichnung</th>
                <th style={thStyle}>Schlüssel</th>
                <th style={thStyle}>Rolle</th>
                <th style={thStyle}>Zuletzt genutzt</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {items.map((k) => {
                const active = !k.revokedAt;
                return (
                  <tr key={k.id}>
                    <td style={{ ...tdStyle, fontFamily: 'var(--w14-font-display)' }}>{k.label}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--w14-font-mono)', fontSize: '0.82rem' }}>
                      {k.tokenPrefix}…
                    </td>
                    <td style={tdStyle}>
                      {ROLE_DE[k.role]}
                      {k.readOnly ? (
                        <span style={{ ...captionStyle, display: 'block', fontSize: '0.74rem' }}>Nur Lesen</span>
                      ) : null}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--w14-ink-faded)' }}>
                      {formatDateTime(k.lastUsedAt)}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Dot tone={active ? 'ok' : 'alert'} size={9} />
                        <span style={{ fontSize: '0.85rem' }}>{active ? 'Aktiv' : 'Widerrufen'}</span>
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {active ? (
                        <Button variant="ghost" size="sm" disabled={revoking === k.id} onClick={() => void revokeKey(k.id)}>
                          {revoking === k.id ? '…' : 'Widerrufen'}
                        </Button>
                      ) : (
                        <span style={captionStyle}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ParchmentCard>
      )}
    </div>
  );
}
