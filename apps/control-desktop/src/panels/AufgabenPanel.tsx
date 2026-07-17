/**
 * AufgabenPanel — the Aufgaben (tasks) surface. Lists open work, lets the owner
 * add a task and mark one done. Reads `tasksApi.list`, writes via
 * `tasksApi.create` / `tasksApi.transition`. Mirrors the FinanzenPanel chrome.
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  ApiError,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
  tasksApi,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  ParchmentCard,
  ToastContainer,
  type ToastShape,
} from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';
import { isStepUpCancelled } from '../state/step-up-store.js';

const PRIORITY_DE: Record<TaskPriority, string> = {
  LOW: 'Niedrig',
  NORMAL: 'Normal',
  HIGH: 'Hoch',
  URGENT: 'Dringend',
};
const STATUS_DE: Record<TaskStatus, string> = {
  OPEN: 'Offen',
  IN_PROGRESS: 'In Arbeit',
  BLOCKED: 'Blockiert',
  DONE: 'Erledigt',
  CANCELLED: 'Abgebrochen',
};
const PRIORITY_TONE: Record<TaskPriority, StatusTone> = {
  LOW: 'info',
  NORMAL: 'info',
  HIGH: 'watch',
  URGENT: 'alert',
};

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
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

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function AufgabenPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [toasts, setToasts] = useState<ToastShape[]>([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [busy, setBusy] = useState<string | null>(null);

  const pushToast = (tone: ToastShape['tone'], t: string, body?: string): void =>
    setToasts((p) => [
      ...p,
      { id: crypto.randomUUID(), tone, title: t, autoDismissMs: 4000, ...(body ? { body } : {}) },
    ]);
  const dismissToast = (id: string): void => setToasts((p) => p.filter((x) => x.id !== id));

  const query = useQuery({
    queryKey: ['tasks', baseUrl],
    queryFn: () => tasksApi.list(client, { limit: 50 }),
    staleTime: 30_000,
  });

  async function addTask(): Promise<void> {
    if (busy || title.trim().length === 0) return;
    setBusy('create');
    try {
      await tasksApi.create(client, { title: title.trim(), priority });
      setTitle('');
      pushToast('success', 'Aufgabe erstellt');
      await query.refetch();
    } catch (err) {
      pushToast('alert', 'Erstellung fehlgeschlagen', describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function complete(task: TaskRow): Promise<void> {
    setBusy(task.id);
    try {
      await tasksApi.transition(client, task.id, { status: 'DONE' });
      pushToast('success', 'Aufgabe erledigt');
      await query.refetch();
    } catch (err) {
      if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
        pushToast('alert', 'Abgebrochen', 'Die PIN-Bestätigung wurde abgebrochen.');
      } else {
        pushToast('alert', 'Aktion fehlgeschlagen', describeError(err));
      }
    } finally {
      setBusy(null);
    }
  }

  const items = (query.data?.items ?? []).filter(
    (t) => t.status !== 'DONE' && t.status !== 'CANCELLED',
  );

  return (
    <>
      <DiamondRule tone="gold" label="Aufgaben" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 640 }}>
        Offene Aufgaben im Blick, neue anlegen und Erledigtes abhaken.
      </p>

      <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 720, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Titel</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Was ist zu tun?"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Priorität</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              style={inputStyle}
            >
              <option value="LOW">Niedrig</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">Hoch</option>
              <option value="URGENT">Dringend</option>
            </select>
          </label>
          <Button
            variant="primary"
            size="md"
            disabled={busy === 'create' || title.trim().length === 0}
            onClick={() => void addTask()}
          >
            {busy === 'create' ? 'Wird erstellt …' : 'Aufgabe anlegen'}
          </Button>
        </div>
      </ParchmentCard>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Lädt Aufgaben …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot tone="ok" size={11} />
            <p style={captionStyle}>Keine offenen Aufgaben. Alles erledigt.</p>
          </div>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '11px 0',
                  borderBottom: '1px solid var(--w14-parchment-3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <StatusDot tone={PRIORITY_TONE[t.priority]} size={10} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--w14-font-display)',
                        fontSize: '1.02rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {t.title}
                    </div>
                    <div style={{ ...captionStyle, fontSize: '0.78rem' }}>
                      {PRIORITY_DE[t.priority]} · {STATUS_DE[t.status]} · fällig {formatDay(t.dueDate)}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === t.id}
                  onClick={() => void complete(t)}
                  style={{ flex: 'none' }}
                >
                  {busy === t.id ? '…' : 'Erledigt'}
                </Button>
              </div>
            ))}
          </div>
        </ParchmentCard>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
