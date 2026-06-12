/**
 * GoogleKalenderCard — renders the shop's Google Calendar NATIVELY in the
 * house style (ink / parchment / gold-hairline), driven by the Google Calendar
 * API instead of an iframe embed.
 *
 * The owner pastes an API-Schlüssel + Kalender-ID in Einstellungen → Social &
 * Nachrichten. We then fetch the upcoming events client-side via the public
 * Calendar v3 REST endpoint and paint them ourselves — grouped by day, calm,
 * touch-friendly. This sidesteps the Tauri-webview third-party-cookie problem
 * that left the old iframe blank for private calendars.
 *
 * Used twice (same component, two fits):
 *   • Werkstatt left column — `variant="card"` (compact, fills the rail).
 *   • /kalender secondary surface — `variant="full"` (full-page).
 *
 * CSP: `connect-src https://www.googleapis.com` is allowed in tauri.conf.json.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useIntegrationSettings } from '../../state/integration-settings-store.js';

/** A single calendar event, reduced to what we render. */
interface CalEvent {
  id: string;
  summary: string;
  location: string | null;
  /** Start as a Date (timed) — for all-day events this is local midnight. */
  start: Date;
  /** End as a Date — for all-day events the exclusive end midnight. */
  end: Date | null;
  allDay: boolean;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; events: CalEvent[] }
  | { kind: 'error'; message: string };

const HOW_FAR_AHEAD_DAYS = 28;
const MAX_RESULTS = 50;

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

interface RawEvent {
  id?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/** Map a Google API event into our reduced shape; null = unrenderable. */
function toCalEvent(raw: RawEvent): CalEvent | null {
  const startRaw = raw.start;
  if (!startRaw) return null;
  const allDay = typeof startRaw.date === 'string';
  const startIso = startRaw.dateTime ?? startRaw.date;
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;

  const endIso = raw.end?.dateTime ?? raw.end?.date ?? null;
  const end = endIso ? new Date(endIso) : null;

  return {
    id: raw.id ?? `${startIso}-${raw.summary ?? ''}`,
    summary: (raw.summary ?? '').trim() || 'Ohne Titel',
    location: raw.location?.trim() ? raw.location.trim() : null,
    start,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
    allDay,
  };
}

export interface GoogleKalenderCardProps {
  /**
   * `card`  — compact panel for the Werkstatt left column (default).
   * `full`  — full-page fit for the /kalender secondary surface.
   */
  variant?: 'card' | 'full';
}

export function GoogleKalenderCard({ variant = 'card' }: GoogleKalenderCardProps): JSX.Element {
  const apiKey = useIntegrationSettings((s) => s.settings.googleCalendar.apiKey);
  const calendarId = useIntegrationSettings((s) => s.settings.googleCalendar.calendarId);
  const full = variant === 'full';

  const configured = apiKey.trim().length > 0 && calendarId.trim().length > 0;

  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const key = apiKey.trim();
    const id = calendarId.trim();
    if (key.length === 0 || id.length === 0) {
      setState({ kind: 'idle' });
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ kind: 'loading' });

    const now = new Date();
    const until = new Date(now.getTime() + HOW_FAR_AHEAD_DAYS * 24 * 60 * 60 * 1000);
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events` +
      `?key=${encodeURIComponent(key)}` +
      `&singleEvents=true&orderBy=startTime` +
      `&timeMin=${encodeURIComponent(now.toISOString())}` +
      `&timeMax=${encodeURIComponent(until.toISOString())}` +
      `&maxResults=${MAX_RESULTS}`;

    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setState({
            kind: 'error',
            message: 'Zugriff verweigert — Schlüssel oder Freigabe prüfen.',
          });
        } else if (res.status === 404) {
          setState({
            kind: 'error',
            message: 'Kalender nicht gefunden — Kalender-ID prüfen.',
          });
        } else {
          setState({ kind: 'error', message: `Kalender konnte nicht geladen werden (${res.status}).` });
        }
        return;
      }
      const json = (await res.json()) as { items?: RawEvent[] };
      const events = (json.items ?? [])
        .map(toCalEvent)
        .filter((e): e is CalEvent => e !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      setState({ kind: 'ready', events });
    } catch {
      if (ctrl.signal.aborted) return;
      setState({ kind: 'error', message: 'Keine Verbindung — bitte erneut versuchen.' });
    }
  }, [apiKey, calendarId]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const openInBrowser = useCallback((): void => {
    try {
      window.open(MANAGE_URL, '_blank', 'noopener');
    } catch {
      /* nothing else we can do */
    }
  }, []);

  return (
    <section
      aria-label="Google Kalender"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <DiamondRule label="Google Kalender" />
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
          {configured ? 'Termine des Geschäfts · nächste 4 Wochen' : 'Noch nicht verbunden'}
        </p>
        {configured && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-2)',
            }}
          >
            <ToolbarButton
              onClick={() => void load()}
              disabled={state.kind === 'loading'}
              title="Termine neu laden"
            >
              {state.kind === 'loading' ? 'Aktualisiert…' : 'Aktualisieren'}
            </ToolbarButton>
            <ToolbarButton onClick={openInBrowser} title="Kalender im Browser verwalten">
              Im Browser öffnen ↗
            </ToolbarButton>
          </div>
        )}
      </div>

      {!configured ? (
        <EmptyExplainer />
      ) : (
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
          <CalendarBody state={state} onRetry={() => void load()} />
        </div>
      )}
    </section>
  );
}

/** Small secondary toolbar button in the house style. */
function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
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
        minHeight: 36,
        padding: '6px 14px',
        fontSize: '0.8rem',
        fontWeight: 600,
        color: 'var(--w14-ink)',
        background: 'var(--w14-parchment-2)',
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
}: {
  state: LoadState;
  onRetry: () => void;
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
        <DayBlock key={day.key} label={day.label} events={day.events} />
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

function DayBlock({ label, events }: { label: string; events: CalEvent[] }): JSX.Element {
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
          <EventRow key={ev.id} event={ev} />
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

function EventRow({ event }: { event: CalEvent }): JSX.Element {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        minHeight: 44,
        padding: '8px 12px',
        background: 'var(--w14-parchment-1)',
        border: '1px solid var(--w14-gold-soft)',
        borderRadius: 'var(--w14-radius-button)',
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

/** Calm 3-step explainer shown until an API key + calendar ID are configured. */
function EmptyExplainer(): JSX.Element {
  const steps: ReadonlyArray<{ title: string; body: string }> = [
    {
      title: 'Calendar API aktivieren',
      body: 'In der Google Cloud Console ein Projekt wählen und die „Google Calendar API“ aktivieren.',
    },
    {
      title: 'API-Schlüssel erstellen',
      body: 'Unter „APIs & Dienste → Anmeldedaten“ einen API-Schlüssel anlegen — er liest die Termine nur.',
    },
    {
      title: 'Kalender freigeben & hinterlegen',
      body: 'Den Kalender auf „öffentlich“ stellen oder freigeben, dann Schlüssel + Kalender-ID unter Einstellungen → Social & Nachrichten eintragen. Die Termine erscheinen dann hier automatisch.',
    },
  ];

  return (
    <ParchmentCard padding="md">
      <p
        style={{
          margin: '0 0 var(--space-4)',
          color: 'var(--w14-ink-aged)',
          fontFamily: 'var(--w14-font-display)',
          fontSize: '0.95rem',
        }}
      >
        Hier erscheinen die Termine des Google Kalenders — in drei Schritten:
      </p>
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 'var(--space-3)',
        }}
      >
        {steps.map((step, i) => (
          <li key={step.title} style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <span
              aria-hidden="true"
              style={{
                flex: '0 0 auto',
                width: 24,
                height: 24,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                border: '1px solid var(--w14-rule)',
                color: 'var(--w14-gold)',
                fontFamily: 'var(--w14-font-display)',
                fontSize: '0.8rem',
              }}
            >
              {i + 1}
            </span>
            <span style={{ display: 'grid', gap: 2 }}>
              <span style={{ color: 'var(--w14-ink)', fontSize: '0.88rem', fontWeight: 600 }}>
                {step.title}
              </span>
              <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem' }}>
                {step.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </ParchmentCard>
  );
}
