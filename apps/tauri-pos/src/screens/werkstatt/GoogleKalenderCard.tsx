/**
 * GoogleKalenderCard — the shop's Google Calendar, rendered NATIVELY in the
 * house style (ink / parchment / gold-hairline) and fully controllable from
 * the POS: list · anlegen · bearbeiten · löschen.
 *
 * The calendar is wired SERVER-SIDE (Service-Account) — the POS no longer
 * talks to Google directly and needs no API key. Everything routes through the
 * existing POS api client (Bearer auth, same base URL every screen uses):
 *
 *   GET    /api/calendar/status            → { configured }
 *   GET    /api/calendar/events?days=28    → CalendarEvent[]
 *   POST   /api/calendar/events            → CalendarEvent
 *   PATCH  /api/calendar/events/:id        → CalendarEvent
 *   DELETE /api/calendar/events/:id        → 204
 *
 * Used twice (same component, two fits):
 *   • Werkstatt left column — `variant="card"` (compact, fills the rail).
 *   • /kalender secondary surface — `variant="full"` (full-page).
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '@warehouse14/api-client';
import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

import { TerminDialog } from './TerminDialog.js';
import { describeError } from '@warehouse14/i18n-de';

/** The server's calendar-event shape (mirrors the api route). */
export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  /** ISO start (dateTime, or `YYYY-MM-DD` for all-day). */
  start: string;
  /** ISO end, or null. */
  end: string | null;
  allDay: boolean;
  htmlLink: string | null;
}

/** A single event, reduced to what we render. */
interface CalEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  /** Start as a Date (timed) — for all-day events this is local midnight. */
  start: Date;
  /** End as a Date — for all-day events the exclusive end midnight. */
  end: Date | null;
  allDay: boolean;
  /** Keep the raw server shape so the edit dialog can reload exact fields. */
  raw: CalendarEvent;
}

type StatusState =
  | { kind: 'checking' }
  | { kind: 'configured' }
  | { kind: 'not-configured' }
  | { kind: 'status-error' };

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; events: CalEvent[] }
  | { kind: 'error'; message: string };

const HOW_FAR_AHEAD_DAYS = 28;

/** The German calendar.google.com manage URL — opened in the system browser. */
const MANAGE_URL = 'https://calendar.google.com/calendar/u/0/r';

const dayHeaderFmt = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayKeyFmt = new Intl.DateTimeFormat('de-DE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Map a server CalendarEvent into our reduced shape; null = unrenderable. */
function toCalEvent(raw: CalendarEvent): CalEvent | null {
  if (!raw.start) return null;
  const start = new Date(raw.start);
  if (Number.isNaN(start.getTime())) return null;
  const end = raw.end ? new Date(raw.end) : null;
  return {
    id: raw.id,
    summary: raw.summary.trim() || 'Ohne Titel',
    description: raw.description?.trim() ? raw.description.trim() : null,
    location: raw.location?.trim() ? raw.location.trim() : null,
    start,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
    allDay: raw.allDay,
    raw,
  };
}

export interface GoogleKalenderCardProps {
  /**
   * `card`  — compact panel for the Werkstatt left column (default).
   * `full`  — full-page fit for the /kalender secondary surface.
   */
  variant?: 'card' | 'full';
}

/** What the create/edit dialog is currently doing — null = closed. */
type DialogState =
  | null
  | { mode: 'create' }
  | { mode: 'edit'; event: CalendarEvent };

export function GoogleKalenderCard({ variant = 'card' }: GoogleKalenderCardProps): JSX.Element {
  const api = useApiClient();
  const full = variant === 'full';

  const [status, setStatus] = useState<StatusState>({ kind: 'checking' });
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [dialog, setDialog] = useState<DialogState>(null);
  const abortRef = useRef<AbortController | null>(null);

  const checkStatus = useCallback(async (): Promise<boolean> => {
    setStatus({ kind: 'checking' });
    try {
      const res = await api.request<{ configured: boolean }>('GET', '/api/calendar/status');
      const configured = res?.configured === true;
      setStatus({ kind: configured ? 'configured' : 'not-configured' });
      return configured;
    } catch {
      setStatus({ kind: 'status-error' });
      return false;
    }
  }, [api]);

  const load = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ kind: 'loading' });
    try {
      const items = await api.request<CalendarEvent[]>(
        'GET',
        `/api/calendar/events?days=${HOW_FAR_AHEAD_DAYS}`,
        undefined,
        { signal: ctrl.signal },
      );
      const events = (items ?? [])
        .map(toCalEvent)
        .filter((e): e is CalEvent => e !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      setState({ kind: 'ready', events });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message =
        err instanceof ApiError
          ? `Termine konnten nicht geladen werden — ${describeError(err)}`
          : 'Keine Verbindung — bitte erneut versuchen.';
      setState({ kind: 'error', message });
    }
  }, [api]);

  // On mount (and on manual refresh): check status, then load if configured.
  const refresh = useCallback(async (): Promise<void> => {
    const configured = await checkStatus();
    if (configured) await load();
  }, [checkStatus, load]);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  const openInBrowser = useCallback((): void => {
    try {
      window.open(MANAGE_URL, '_blank', 'noopener');
    } catch {
      /* nothing else we can do */
    }
  }, []);

  const configured = status.kind === 'configured';

  return (
    <section
      aria-label="Geschäftskalender"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <DiamondRule label="Kalender" />
        <p
          style={{
            margin: '-8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            textAlign: 'center',
          }}
        >
          {configured ? 'Termine des Geschäfts · nächste 4 Wochen' : 'Geschäftskalender'}
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-3)',
          }}
        >
          {configured && (
            <ToolbarButton
              onClick={() => setDialog({ mode: 'create' })}
              title="Neuen Termin anlegen"
              emphasis
            >
              ＋ Neuer Termin
            </ToolbarButton>
          )}
          {configured && (
            <ToolbarButton
              onClick={() => void load()}
              disabled={state.kind === 'loading'}
              title="Termine neu laden"
            >
              {state.kind === 'loading' ? 'Aktualisiert…' : 'Aktualisieren'}
            </ToolbarButton>
          )}
          <ToolbarButton onClick={openInBrowser} title="Kalender im Browser öffnen">
            Im Browser öffnen ↗
          </ToolbarButton>
        </div>
      </div>

      {status.kind === 'checking' ? (
        <CardBox full={full}>
          <Skeleton />
        </CardBox>
      ) : !configured ? (
        <NotConfiguredExplainer
          errored={status.kind === 'status-error'}
          onRetry={() => void refresh()}
        />
      ) : (
        <CardBox full={full}>
          <CalendarBody
            state={state}
            onRetry={() => void load()}
            onSelect={(ev) => setDialog({ mode: 'edit', event: ev.raw })}
          />
        </CardBox>
      )}

      {dialog !== null &&
        (dialog.mode === 'edit' ? (
          <TerminDialog
            mode="edit"
            event={dialog.event}
            onClose={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              void load();
            }}
          />
        ) : (
          <TerminDialog
            mode="create"
            onClose={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              void load();
            }}
          />
        ))}
    </section>
  );
}

/** The scrollable parchment frame the event list / states live in. */
function CardBox({ full, children }: { full: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        minHeight: full ? 0 : 260,
        overflowY: 'auto',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        boxShadow: 'var(--w14-shadow-card)',
        padding: 'var(--space-3)',
      }}
    >
      {children}
    </div>
  );
}

/** Small secondary toolbar button in the house style. */
function ToolbarButton({
  onClick,
  disabled,
  title,
  emphasis,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  emphasis?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        padding: '8px 16px',
        fontSize: '0.85rem',
        fontWeight: 600,
        color: emphasis ? 'var(--w14-parchment)' : 'var(--w14-ink)',
        background: emphasis ? 'var(--w14-gold)' : 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-gold)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** The inner content: loading / error / empty-list / grouped events. */
function CalendarBody({
  state,
  onRetry,
  onSelect,
}: {
  state: LoadState;
  onRetry: () => void;
  onSelect: (event: CalEvent) => void;
}): JSX.Element {
  const grouped = useMemo(() => {
    if (state.kind !== 'ready') return [];
    return groupByDay(state.events);
  }, [state]);

  if (state.kind === 'loading' || state.kind === 'idle') {
    return <Skeleton />;
  }

  if (state.kind === 'error') {
    return (
      <div
        role="status"
        style={{
          display: 'grid',
          gap: 'var(--space-3)',
          placeItems: 'center',
          textAlign: 'center',
          padding: 'var(--space-5) var(--space-3)',
          color: 'var(--w14-ink-aged)',
        }}
      >
        <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: '0.95rem' }}>
          {state.message}
        </span>
        <ToolbarButton onClick={onRetry} title="Erneut versuchen">
          Erneut versuchen
        </ToolbarButton>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <p
        role="status"
        style={{
          margin: 0,
          padding: 'var(--space-5) var(--space-3)',
          textAlign: 'center',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.95rem',
        }}
      >
        Keine Termine in den nächsten 4 Wochen.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {grouped.map((day) => (
        <DayBlock key={day.key} label={day.label} events={day.events} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface DayGroup {
  key: string;
  label: string;
  events: CalEvent[];
}

function groupByDay(events: CalEvent[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const ev of events) {
    const key = dayKeyFmt.format(ev.start);
    let group = map.get(key);
    if (!group) {
      group = { key, label: dayHeaderFmt.format(ev.start), events: [] };
      map.set(key, group);
    }
    group.events.push(ev);
  }
  return [...map.values()];
}

function DayBlock({
  label,
  events,
  onSelect,
}: {
  label: string;
  events: CalEvent[];
  onSelect: (event: CalEvent) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <h3
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontSize: '0.82rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--w14-ink-aged)',
        }}
      >
        {label}
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
        {events.map((ev) => (
          <EventRow key={ev.id} event={ev} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

function formatRange(ev: CalEvent): string {
  if (ev.allDay) return 'Ganztägig';
  const start = timeFmt.format(ev.start);
  if (!ev.end) return start;
  return `${start}–${timeFmt.format(ev.end)}`;
}

function EventRow({
  event,
  onSelect,
}: {
  event: CalEvent;
  onSelect: (event: CalEvent) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(event)}
        title="Termin bearbeiten"
        style={{
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
          minHeight: 44,
          padding: '8px 12px',
          background: 'var(--w14-parchment-1)',
          border: '1px solid var(--w14-gold-soft)',
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            minWidth: 92,
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.8rem',
            fontWeight: 600,
            color: 'var(--w14-gold)',
            paddingTop: 1,
          }}
        >
          {formatRange(event)}
        </span>
        <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span
            style={{
              color: 'var(--w14-ink)',
              fontSize: '0.92rem',
              fontWeight: 600,
              lineHeight: 1.25,
            }}
          >
            {event.summary}
          </span>
          {event.location && (
            <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.8rem' }}>
              {event.location}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** Calm shimmer-free skeleton while the events load. */
function Skeleton(): JSX.Element {
  const rows = [0, 1, 2, 3];
  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {rows.map((r) => (
        <div key={r} style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div
            style={{
              width: '40%',
              height: 12,
              borderRadius: 6,
              background: 'var(--w14-rule)',
              opacity: 0.6,
            }}
          />
          <div
            style={{
              height: 44,
              borderRadius: 'var(--w14-radius-button)',
              background: 'var(--w14-parchment-1)',
              border: '1px solid var(--w14-rule)',
              opacity: 0.7,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Calm state shown when the calendar is not yet wired server-side. No inputs —
 * the Service-Account is configured on the server, not here.
 */
function NotConfiguredExplainer({
  errored,
  onRetry,
}: {
  errored: boolean;
  onRetry: () => void;
}): JSX.Element {
  return (
    <ParchmentCard padding="md">
      <p
        style={{
          margin: '0 0 var(--space-3)',
          color: 'var(--w14-ink)',
          fontFamily: 'var(--w14-font-display)',
          fontSize: '1.05rem',
          fontWeight: 600,
        }}
      >
        {errored ? 'Kalender vorübergehend nicht erreichbar' : 'Kalender noch nicht eingerichtet'}
      </p>
      <p
        style={{
          margin: '0 0 var(--space-4)',
          color: 'var(--w14-ink-faded)',
          fontSize: '0.88rem',
          lineHeight: 1.5,
        }}
      >
        {errored
          ? 'Der Geschäftskalender konnte gerade nicht geladen werden. Bitte gleich erneut versuchen.'
          : 'Der Geschäftskalender wird serverseitig über ein Service-Konto angebunden. Sobald er eingerichtet ist, erscheinen die Termine hier automatisch.'}
      </p>
      <ToolbarButton onClick={onRetry} title="Erneut prüfen">
        Erneut prüfen
      </ToolbarButton>
    </ParchmentCard>
  );
}
