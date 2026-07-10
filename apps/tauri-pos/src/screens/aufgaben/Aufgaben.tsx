/**
 * Aufgaben — Tier-1 surface #5 (Phase 2 Day 8). The day's open posts.
 *
 * Two-column split:
 *   Left  : filters (status chips + priority chips + "Nur meine") +
 *           scrollable task list (priority dot + title + due date) +
 *           quick-add ("Neue Aufgabe…  ↵") at the top
 *   Right : detail panel for the selected task with status-transition
 *           buttons drawn from `ALLOWED_TASK_TRANSITIONS` + inline edit
 *
 * The list URL carries `?id=` so refreshes and toasts can deep-link.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  ALLOWED_TASK_TRANSITIONS,
  ApiError,
  type ListTasksQuery,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
  tasksApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

import { ShippingLabelButton } from './ShippingLabelButton.js';
import { describeError } from '@warehouse14/i18n-de';

// ────────────────────────────────────────────────────────────────────────
// Filter chips
// ────────────────────────────────────────────────────────────────────────

const STATUS_CHIPS: Array<{ value: TaskStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Alle' },
  { value: 'OPEN', label: 'Offen' },
  { value: 'IN_PROGRESS', label: 'In Arbeit' },
  { value: 'BLOCKED', label: 'Blockiert' },
  { value: 'DONE', label: 'Erledigt' },
];

const PRIORITY_CHIPS: Array<{ value: TaskPriority | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Alle' },
  { value: 'URGENT', label: 'Dringend' },
  { value: 'HIGH', label: 'Hoch' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Niedrig' },
];

const PRIORITY_DOT_COLOR: Record<TaskPriority, string> = {
  URGENT: 'var(--w14-wax-red)',
  HIGH: 'var(--w14-gold)',
  NORMAL: 'var(--w14-ink-faded)',
  LOW: 'var(--w14-rule)',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Offen',
  IN_PROGRESS: 'In Arbeit',
  BLOCKED: 'Blockiert',
  DONE: 'Erledigt',
  CANCELLED: 'Abgebrochen',
};

const TRANSITION_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Wieder öffnen',
  IN_PROGRESS: 'Starten',
  BLOCKED: 'Blockieren',
  DONE: 'Als erledigt markieren',
  CANCELLED: 'Abbrechen',
};

// ────────────────────────────────────────────────────────────────────────
// Query keys
// ────────────────────────────────────────────────────────────────────────

export const tasksQueryKey = (args: ListTasksQuery): readonly unknown[] => ['tasks', 'list', args];
export const taskDetailQueryKey = (id: string): readonly unknown[] => ['tasks', 'detail', id];

// ────────────────────────────────────────────────────────────────────────
// Screen entry
// ────────────────────────────────────────────────────────────────────────

export function Aufgaben(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'ALL'>('OPEN');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'ALL'>('ALL');
  const [mineOnly, setMineOnly] = useState<boolean>(false);

  const onSelect = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id === null) next.delete('id');
      else next.set('id', id);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(360px, 1fr) minmax(0, 2fr)',
        height: '100%',
        minHeight: 0,
        flex: 1,
      }}
    >
      <TaskListPanel
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        mineOnly={mineOnly}
        onStatusChange={setStatusFilter}
        onPriorityChange={setPriorityFilter}
        onMineOnlyChange={setMineOnly}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <TaskDetailPanel taskId={selectedId} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Left column — filters + quick-add + list
// ════════════════════════════════════════════════════════════════════════

interface TaskListPanelProps {
  statusFilter: TaskStatus | 'ALL';
  priorityFilter: TaskPriority | 'ALL';
  mineOnly: boolean;
  onStatusChange: (s: TaskStatus | 'ALL') => void;
  onPriorityChange: (p: TaskPriority | 'ALL') => void;
  onMineOnlyChange: (b: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function TaskListPanel({
  statusFilter,
  priorityFilter,
  mineOnly,
  onStatusChange,
  onPriorityChange,
  onMineOnlyChange,
  selectedId,
  onSelect,
}: TaskListPanelProps): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [draft, setDraft] = useState<string>('');

  const queryArgs: ListTasksQuery = {
    limit: 100,
    ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
    ...(priorityFilter !== 'ALL' ? { priority: priorityFilter } : {}),
    ...(mineOnly ? { mineOnly: true } : {}),
  };

  const listQ = useQuery({
    queryKey: tasksQueryKey(queryArgs),
    queryFn: () => tasksApi.list(api, queryArgs),
    staleTime: 15_000,
  });

  const createTask = useMutation({
    mutationFn: (title: string) => tasksApi.create(api, { title }),
    onSuccess: async (row) => {
      addToast({ tone: 'success', title: 'Aufgabe erfasst', body: row.title });
      setDraft('');
      await qc.invalidateQueries({ queryKey: ['tasks', 'list'] });
      onSelect(row.id);
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Konnte Aufgabe nicht anlegen',
        body: err instanceof ApiError ? describeError(err) : 'Netzwerkfehler.',
      });
    },
  });

  const items = listQ.data?.items ?? [];

  return (
    <section
      aria-label="Aufgabenliste"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 16,
        gap: 12,
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
          }}
        >
          Aufgaben
        </h2>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
        >
          {listQ.isFetching ? 'lädt…' : `${items.length}`}
        </span>
      </header>

      {/* Quick-add */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (t.length === 0 || createTask.isPending) return;
          createTask.mutate(t);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          backgroundColor: 'var(--w14-parchment-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <span aria-hidden style={{ color: 'var(--w14-gold)', fontSize: '1rem' }}>
          ✦
        </span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Neue Aufgabe…  ↵"
          spellCheck={false}
          maxLength={200}
          disabled={createTask.isPending}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.95rem',
            color: 'var(--w14-ink)',
          }}
        />
      </form>

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <FilterChipRow>
          {STATUS_CHIPS.map((c) => (
            <FilterChip
              key={c.value}
              label={c.label}
              active={statusFilter === c.value}
              onClick={() => onStatusChange(c.value)}
            />
          ))}
        </FilterChipRow>
        <FilterChipRow>
          {PRIORITY_CHIPS.map((c) => (
            <FilterChip
              key={c.value}
              label={c.label}
              active={priorityFilter === c.value}
              onClick={() => onPriorityChange(c.value)}
            />
          ))}
          <FilterChip
            label="Nur meine"
            active={mineOnly}
            onClick={() => onMineOnlyChange(!mineOnly)}
          />
        </FilterChipRow>
      </div>

      {/* Results */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {listQ.isLoading ? (
          <ListSkeleton />
        ) : listQ.isError ? (
          <ErrorBanner />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((task) => (
            <TaskRowCard
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              onClick={() => onSelect(task.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TaskRowCard({
  task,
  selected,
  onClick,
}: {
  task: TaskRow;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="sm"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        border: selected ? '1px solid var(--w14-gold)' : '1px solid transparent',
        background: selected ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
        opacity: task.status === 'CANCELLED' || task.status === 'DONE' ? 0.65 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PriorityDot priority={task.priority} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '0.96rem',
              textDecoration: task.status === 'DONE' ? 'line-through' : 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {task.title}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.72rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            <span className="w14-smallcaps" style={{ letterSpacing: '0.06em' }}>
              {STATUS_LABEL[task.status]}
            </span>
            {task.dueDate && (
              <span className="w14-tabular">
                · fällig {new Date(task.dueDate).toLocaleDateString('de-DE')}
              </span>
            )}
          </div>
        </div>
      </div>
    </ParchmentCard>
  );
}

function PriorityDot({ priority }: { priority: TaskPriority }): JSX.Element {
  return (
    <span
      aria-hidden
      title={priority}
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 999,
        background: PRIORITY_DOT_COLOR[priority],
        flexShrink: 0,
      }}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════
// Right column — detail + transitions + inline edit
// ════════════════════════════════════════════════════════════════════════

function TaskDetailPanel({ taskId }: { taskId: string | null }): JSX.Element {
  if (!taskId) return <EmptyDetail />;
  return <TaskDetail taskId={taskId} />;
}

function TaskDetail({ taskId }: { taskId: string }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const q = useQuery({
    queryKey: taskDetailQueryKey(taskId),
    queryFn: () => tasksApi.get(api, taskId),
    staleTime: 5_000,
  });

  const transition = useMutation({
    mutationFn: ({ status, reason }: { status: TaskStatus; reason?: string }) =>
      tasksApi.transition(api, taskId, {
        status,
        ...(reason ? { cancellationReason: reason } : {}),
      }),
    onSuccess: async (row) => {
      addToast({
        tone: 'success',
        title: 'Status geändert',
        body: `${row.title} → ${STATUS_LABEL[row.status]}`,
      });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Übergang abgelehnt',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const updateMeta = useMutation({
    mutationFn: (body: {
      title?: string;
      description?: string | null;
      priority?: TaskPriority;
      dueDate?: string | null;
    }) => tasksApi.update(api, taskId, body),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Aufgabe aktualisiert' });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Konnte nicht speichern',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  if (q.isLoading) {
    return <DetailLoading />;
  }
  if (q.isError || !q.data) {
    return <DetailError />;
  }

  const task = q.data;
  const allowed = ALLOWED_TASK_TRANSITIONS[task.status];

  return (
    <section
      aria-label="Aufgaben-Detail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 24,
        gap: 16,
        overflowY: 'auto',
      }}
    >
      <ParchmentCard padding="lg">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <PriorityDot priority={task.priority} />
              <span
                className="w14-smallcaps"
                style={{
                  color: 'var(--w14-ink-faded)',
                  letterSpacing: '0.08em',
                  fontSize: '0.78rem',
                }}
              >
                {STATUS_LABEL[task.status]} · {task.priority}
              </span>
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: '1.6rem',
              }}
            >
              {task.title}
            </h1>
            <p
              className="w14-tabular"
              style={{
                margin: '6px 0 0',
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              erstellt {new Date(task.createdAt).toLocaleString('de-DE')}
              {task.dueDate && ` · fällig ${new Date(task.dueDate).toLocaleDateString('de-DE')}`}
            </p>
          </div>
        </div>

        <DiamondRule />

        {task.description && (
          <p
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--w14-font-body)',
              fontSize: '0.95rem',
              color: 'var(--w14-ink-aged)',
            }}
          >
            {task.description}
          </p>
        )}

        {task.relatedEntityTable === 'transactions' && task.relatedEntityId && (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <ShippingLabelButton transactionId={task.relatedEntityId} />
          </div>
        )}

        {task.cancellationReason && (
          <p
            role="note"
            style={{
              margin: '12px 0 0',
              fontStyle: 'italic',
              color: 'var(--w14-wax-red)',
              fontSize: '0.9rem',
            }}
          >
            Abbruch-Grund: {task.cancellationReason}
          </p>
        )}
      </ParchmentCard>

      {/* Inline edit */}
      <TaskInlineEdit
        task={task}
        busy={updateMeta.isPending}
        onSave={(patch) => updateMeta.mutate(patch)}
      />

      {/* Transitions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <DiamondRule label="Übergänge" />
        {allowed.length === 0 ? (
          <p
            style={{
              margin: 0,
              fontStyle: 'italic',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: '0.9rem',
            }}
          >
            Endzustand erreicht. Keine Übergänge mehr möglich.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {allowed.map((next) => (
              <Button
                key={next}
                variant={next === 'DONE' ? 'primary' : 'ghost'}
                onClick={() => {
                  if (next === 'CANCELLED') {
                    const reason = window.prompt('Bitte Abbruch-Grund eingeben (≥ 4 Zeichen):');
                    if (!reason || reason.trim().length < 4) return;
                    transition.mutate({ status: next, reason: reason.trim() });
                  } else {
                    transition.mutate({ status: next });
                  }
                }}
                disabled={transition.isPending}
              >
                {TRANSITION_LABEL[next]}
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TaskInlineEdit({
  task,
  busy,
  onSave,
}: {
  task: TaskRow;
  busy: boolean;
  onSave: (patch: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    dueDate?: string | null;
  }) => void;
}): JSX.Element {
  const [title, setTitle] = useState<string>(task.title);
  const [description, setDescription] = useState<string>(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  // Der Server nimmt ein reines Datum (JJJJ-MM-TT); genau das liefert das Feld.
  const [dueDate, setDueDate] = useState<string>(taskDueDateInput(task.dueDate));

  const dirty =
    title.trim() !== task.title ||
    description !== (task.description ?? '') ||
    priority !== task.priority ||
    dueDate !== taskDueDateInput(task.dueDate);

  return (
    <ParchmentCard padding="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titel"
          maxLength={200}
          style={inputStyle}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Beschreibung (optional)"
          maxLength={5000}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-aged)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
          >
            Fällig am
          </span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={{ ...inputStyle, width: 'auto' }}
          />
          {dueDate !== '' && (
            <Button variant="ghost" size="sm" onClick={() => setDueDate('')} disabled={busy}>
              Frist entfernen
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-aged)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
          >
            Priorität
          </span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            style={{ ...inputStyle, width: 'auto' }}
          >
            <option value="LOW">Niedrig</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">Hoch</option>
            <option value="URGENT">Dringend</option>
          </select>
          <div style={{ marginLeft: 'auto' }}>
            <Button
              variant="primary"
              disabled={!dirty || busy || title.trim().length === 0}
              onClick={() =>
                onSave({
                  ...(title.trim() !== task.title ? { title: title.trim() } : {}),
                  ...(description !== (task.description ?? '')
                    ? { description: description.length > 0 ? description : null }
                    : {}),
                  ...(priority !== task.priority ? { priority } : {}),
                  ...(dueDate !== taskDueDateInput(task.dueDate)
                    ? { dueDate: dueDate.length > 0 ? dueDate : null }
                    : {}),
                })
              }
            >
              {busy ? 'Speichert…' : 'Speichern'}
            </Button>
          </div>
        </div>
      </div>
    </ParchmentCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Small visual building blocks
// ────────────────────────────────────────────────────────────────────────

function FilterChipRow({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>;
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w14-smallcaps"
      style={{
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.74rem',
        letterSpacing: '0.08em',
        padding: '4px 10px',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function ListSkeleton(): JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 56,
            borderRadius: 'var(--w14-radius-card)',
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            opacity: 1 - i * 0.12,
          }}
        />
      ))}
      <style>{`@keyframes w14-skel { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }`}</style>
    </>
  );
}

function EmptyState(): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <DiamondRule />
      <p
        style={{
          margin: '8px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.92rem',
        }}
      >
        Noch keine Aufgaben.{'\n'}Tippen Sie eine ein.
      </p>
    </ParchmentCard>
  );
}

function ErrorBanner(): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
      <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
        Aufgabenliste konnte nicht geladen werden.
      </p>
    </ParchmentCard>
  );
}

function EmptyDetail(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}>
      <ParchmentCard padding="lg" style={{ textAlign: 'center', maxWidth: 420 }}>
        <DiamondRule label="Aufgaben-Detail" />
        <p
          style={{
            margin: '12px 0 0',
            fontStyle: 'italic',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          Wählen Sie links eine Aufgabe aus,{'\n'}um Details und Übergänge zu sehen.
        </p>
      </ParchmentCard>
    </div>
  );
}

function DetailLoading(): JSX.Element {
  return (
    <section style={{ padding: 24 }}>
      <div
        aria-hidden
        style={{
          height: 180,
          borderRadius: 'var(--w14-radius-card)',
          background:
            'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
          backgroundSize: '200% 100%',
          animation: 'w14-skel 1.6s ease-in-out infinite',
        }}
      />
    </section>
  );
}

function DetailError(): JSX.Element {
  return (
    <section style={{ padding: 24 }}>
      <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
        <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
          Aufgabe konnte nicht geladen werden.
        </p>
      </ParchmentCard>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment-1, var(--w14-parchment))',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.92rem',
  color: 'var(--w14-ink)',
  outline: 'none',
};

/**
 * Das Datumsfeld erwartet JJJJ-MM-TT. Der Server liefert entweder genau das
 * oder einen vollen Zeitstempel; beides wird auf den Tag gekürzt. Kein Datum
 * ist ein leeres Feld, keine erfundene Frist.
 */
function taskDueDateInput(dueDate: string | null): string {
  if (!dueDate) return '';
  return dueDate.slice(0, 10);
}
