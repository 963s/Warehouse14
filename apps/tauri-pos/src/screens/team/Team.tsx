/**
 * Team & Rollen — staff administration (Track A3). The Owner adds a staff member
 * (their Google e-mail then unlocks the app), sets the role, and can deactivate
 * one. Reads `/api/admin/staff`; create + deactivate are Owner + PIN step-up
 * server-side (the global step-up modal opens + replays transparently).
 *
 * Ported into tauri-pos as a pure ADDITION; uses the app's global toast store
 * and step-up cancel helper. `Dot` stands in for the control-desktop StatusDot.
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { useToastStore } from '../../state/toast-store.js';

type StaffRole = 'ADMIN' | 'CASHIER' | 'READONLY';

interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  isOwner: boolean;
  createdAt: string;
}
interface ListResponse {
  items: StaffRow[];
}

const ROLE_DE: Record<StaffRole, string> = {
  ADMIN: 'Administrator',
  CASHIER: 'Kasse',
  READONLY: 'Nur Lesen',
};

function Dot({ tone, size = 9 }: { tone: 'ok' | 'info'; size?: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: tone === 'ok' ? '#5aa469' : 'var(--w14-ink-faded)',
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

export function Team(): JSX.Element {
  const client = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('CASHIER');
  const [busy, setBusy] = useState<string | null>(null);

  const query = useQuery<ListResponse>({
    queryKey: ['staff'],
    queryFn: () => client.request<ListResponse>('GET', '/api/admin/staff'),
    staleTime: 30_000,
  });

  function handleStepUp(err: unknown, failTitle: string): void {
    if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
      addToast({ tone: 'alert', title: 'Abgebrochen', body: 'Die PIN-Bestätigung wurde abgebrochen.' });
    } else {
      addToast({ tone: 'alert', title: failTitle, body: describeError(err) });
    }
  }

  async function addStaff(): Promise<void> {
    if (busy || email.trim().length === 0 || name.trim().length === 0) return;
    setBusy('create');
    try {
      await client.request('POST', '/api/admin/staff', {
        email: email.trim(),
        name: name.trim(),
        role,
      });
      setEmail('');
      setName('');
      addToast({
        tone: 'success',
        title: 'Mitarbeiter freigeschaltet',
        body: 'Anmeldung ist nun mit diesem Google-Konto möglich.',
      });
      await query.refetch();
    } catch (err) {
      handleStepUp(err, 'Freischaltung fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(row: StaffRow): Promise<void> {
    setBusy(row.id);
    try {
      await client.request('POST', `/api/admin/staff/${encodeURIComponent(row.id)}/deactivate`, {});
      addToast({ tone: 'success', title: 'Zugang deaktiviert', body: `${row.name} kann sich nicht mehr anmelden.` });
      await query.refetch();
    } catch (err) {
      handleStepUp(err, 'Deaktivierung fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  const items = query.data?.items ?? [];

  return (
    <div style={{ padding: 20 }}>
      <DiamondRule tone="gold" label="Team & Rollen" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 640 }}>
        Wer sich anmelden darf und mit welcher Rolle. Ein neuer Mitarbeiter wird über seine
        Google-E-Mail freigeschaltet, danach kann er sich anmelden.
      </p>

      <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 760, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Google-E-Mail</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              placeholder="name@warehouse14.de"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Vor- und Nachname"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Rolle</span>
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} style={inputStyle}>
              <option value="READONLY">Nur Lesen</option>
              <option value="CASHIER">Kasse</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </label>
          <Button
            variant="primary"
            size="md"
            disabled={busy === 'create' || email.trim().length === 0 || name.trim().length === 0}
            onClick={() => void addStaff()}
          >
            {busy === 'create' ? 'Wird freigeschaltet …' : 'Freischalten'}
          </Button>
        </div>
      </ParchmentCard>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Lädt Team …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Noch keine Mitarbeiter.</p>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>E-Mail</th>
                <th style={thStyle}>Rolle</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--w14-font-display)' }}>{s.name}</td>
                  <td style={{ ...tdStyle, wordBreak: 'break-all' }}>{s.email}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Dot tone={s.isOwner ? 'ok' : 'info'} size={9} />
                      {s.isOwner ? 'Inhaber' : ROLE_DE[s.role]}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {s.isOwner ? (
                      <span style={captionStyle}>-</span>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={busy === s.id} onClick={() => void deactivate(s)}>
                        {busy === s.id ? '…' : 'Deaktivieren'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ParchmentCard>
      )}
    </div>
  );
}
