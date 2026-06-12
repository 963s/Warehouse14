/**
 * TerminDialog — anlegen / bearbeiten / löschen eines Geschäftstermins.
 *
 * Routes through the existing POS api client (Bearer auth, same base URL):
 *   POST   /api/calendar/events       body {summary, description?, location?, start, end?, allDay?}
 *   PATCH  /api/calendar/events/:id    same body
 *   DELETE /api/calendar/events/:id    → 204
 *
 * The form fields (Titel · Datum · Von/Bis · Ganztägig · Ort · Notiz) are
 * assembled into ISO `start`/`end` instants before sending:
 *   • timed   → local `YYYY-MM-DD` + `HH:MM` → `Date` → `.toISOString()`
 *   • all-day → the bare `YYYY-MM-DD` date string (the server treats date-only
 *     starts as all-day, per the CalendarEvent contract).
 *
 * House style throughout (ink / parchment / gold-hairline), German only,
 * ≥44px controls, honest German error + loading states. Built on the shared
 * ModalShell (focus-trap, ESC, scroll-lock) like every other dialog.
 */

import { useMemo, useState } from 'react';

import { ApiError } from '@warehouse14/api-client';
import {
  Button,
  Checkbox,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  ModalShell,
  Textarea,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

import type { CalendarEvent } from './GoogleKalenderCard.js';

export interface TerminDialogProps {
  mode: 'create' | 'edit';
  /** The event being edited (mode === 'edit'). */
  event?: CalendarEvent;
  onClose: () => void;
  onSaved: () => void;
}

/** Local `YYYY-MM-DD` for a Date (NOT UTC — uses the operator's timezone). */
function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local `HH:MM` for a Date. */
function toTimeInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

interface FormValues {
  summary: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  allDay: boolean;
  location: string;
  description: string;
}

/** Build the initial form values — from the event when editing, else sensible defaults. */
function initialValues(event: CalendarEvent | undefined): FormValues {
  if (!event) {
    const now = new Date();
    // Default new appointments to the next full hour, 30 min long.
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return {
      summary: '',
      date: toDateInput(start),
      start: toTimeInput(start),
      end: toTimeInput(end),
      allDay: false,
      location: '',
      description: '',
    };
  }
  const startDate = new Date(event.start);
  const endDate = event.end ? new Date(event.end) : null;
  return {
    summary: event.summary ?? '',
    date: toDateInput(startDate),
    start: event.allDay ? '09:00' : toTimeInput(startDate),
    end: event.allDay
      ? '10:00'
      : endDate && !Number.isNaN(endDate.getTime())
        ? toTimeInput(endDate)
        : toTimeInput(new Date(startDate.getTime() + 30 * 60 * 1000)),
    allDay: event.allDay,
    location: event.location ?? '',
    description: event.description ?? '',
  };
}

/** Combine a `YYYY-MM-DD` + `HH:MM` into a LOCAL-time Date. */
function combineLocal(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, 0, 0);
}

interface CalendarEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end?: string;
  allDay?: boolean;
}

export function TerminDialog({ mode, event, onClose, onSaved }: TerminDialogProps): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  const [values, setValues] = useState<FormValues>(() => initialValues(event));
  const [busy, setBusy] = useState<false | 'save' | 'delete'>(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const summaryError = useMemo(
    () => (values.summary.trim().length === 0 ? 'Bitte einen Titel angeben.' : null),
    [values.summary],
  );
  const dateError = useMemo(
    () => (values.date.trim().length === 0 ? 'Bitte ein Datum wählen.' : null),
    [values.date],
  );
  const timeError = useMemo(() => {
    if (values.allDay) return null;
    if (!values.start) return 'Bitte eine Startzeit angeben.';
    if (values.end) {
      const start = combineLocal(values.date, values.start);
      const end = combineLocal(values.date, values.end);
      if (end.getTime() <= start.getTime()) return 'Das Ende muss nach dem Beginn liegen.';
    }
    return null;
  }, [values.allDay, values.start, values.end, values.date]);

  const canSave = !summaryError && !dateError && !timeError && busy === false;

  /** Assemble the request body from the current form values. */
  function buildBody(): CalendarEventBody {
    // Date-only start → the server treats this as an all-day event.
    const start = values.allDay
      ? values.date
      : combineLocal(values.date, values.start).toISOString();
    const body: CalendarEventBody = {
      summary: values.summary.trim(),
      allDay: values.allDay,
      start,
    };
    const location = values.location.trim();
    const description = values.description.trim();
    if (location) body.location = location;
    if (description) body.description = description;
    if (!values.allDay && values.end) {
      body.end = combineLocal(values.date, values.end).toISOString();
    }
    return body;
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy('save');
    setError(null);
    try {
      const body = buildBody();
      if (mode === 'edit' && event) {
        await api.request<CalendarEvent>(
          'PATCH',
          `/api/calendar/events/${encodeURIComponent(event.id)}`,
          body,
        );
        addToast({ tone: 'success', title: 'Termin gespeichert', body: body.summary });
      } else {
        await api.request<CalendarEvent>('POST', '/api/calendar/events', body);
        addToast({ tone: 'success', title: 'Termin angelegt', body: body.summary });
      }
      onSaved();
    } catch (err) {
      setError(toGermanError(err, 'Der Termin konnte nicht gespeichert werden.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!event || busy !== false) return;
    setBusy('delete');
    setError(null);
    try {
      await api.request('DELETE', `/api/calendar/events/${encodeURIComponent(event.id)}`);
      addToast({ tone: 'alert', title: 'Termin gelöscht', body: event.summary });
      onSaved();
    } catch (err) {
      setError(toGermanError(err, 'Der Termin konnte nicht gelöscht werden.'));
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'edit' ? 'Termin bearbeiten' : 'Neuer Termin';

  return (
    <ModalShell
      open
      onClose={() => {
        if (busy === false) onClose();
      }}
      variant="center"
      size="md"
      title={title}
      closeOnBackdrop={busy === false}
      closeOnEsc={busy === false}
    >
      <DialogBody>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Field label="Titel" required error={summaryError && values.summary ? summaryError : null}>
            <Input
              value={values.summary}
              onChange={(e) => set('summary', e.target.value)}
              placeholder="z. B. Ankauf-Termin Herr Müller"
              autoFocus
              maxLength={200}
            />
          </Field>

          <Field label="Datum" required error={dateError && values.date === '' ? dateError : null}>
            <Input type="date" value={values.date} onChange={(e) => set('date', e.target.value)} />
          </Field>

          <Checkbox
            label="Ganztägig"
            checked={values.allDay}
            onChange={(e) => set('allDay', e.target.checked)}
          />

          {!values.allDay && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <Field label="Von">
                <Input
                  type="time"
                  value={values.start}
                  onChange={(e) => set('start', e.target.value)}
                />
              </Field>
              <Field label="Bis" error={timeError}>
                <Input
                  type="time"
                  value={values.end}
                  onChange={(e) => set('end', e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field label="Ort">
            <Input
              value={values.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="z. B. Ladengeschäft Schorndorf"
              maxLength={200}
            />
          </Field>

          <Field label="Notiz">
            <Textarea
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="Optionale Anmerkungen zum Termin"
              maxLength={1000}
            />
          </Field>

          {error && (
            <p
              role="alert"
              style={{
                margin: 0,
                color: 'var(--w14-wax-red)',
                fontSize: '0.9rem',
              }}
            >
              {error}
            </p>
          )}
        </div>
      </DialogBody>

      <DialogFooter style={{ justifyContent: 'space-between' }}>
        {/* Reverse-Fitts: the destructive Löschen sits LEFT, away from the safe
            primary action on the right. Only present when editing. */}
        <span style={{ display: 'inline-flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          {mode === 'edit' &&
            (confirmingDelete ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void remove()}
                  disabled={busy !== false}
                >
                  {busy === 'delete' ? 'Wird gelöscht…' : 'Wirklich löschen'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy !== false}
                >
                  Behalten
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy !== false}
                style={{ color: 'var(--w14-wax-red)' }}
              >
                Löschen
              </Button>
            ))}
        </span>

        <span style={{ display: 'inline-flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy !== false}>
            Abbrechen
          </Button>
          <Button variant="primary" size="md" onClick={() => void save()} disabled={!canSave}>
            {busy === 'save' ? 'Speichert…' : mode === 'edit' ? 'Speichern' : 'Termin anlegen'}
          </Button>
        </span>
      </DialogFooter>
    </ModalShell>
  );
}

/** Map any error to a calm German sentence. */
function toGermanError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'STEP_UP_REQUIRED':
        return 'PIN-Bestätigung wurde abgebrochen.';
      case 'NOT_FOUND':
        return 'Dieser Termin existiert nicht mehr.';
      case 'VALIDATION_ERROR':
        return `Eingabe ungültig — ${err.message}`;
      case 'EXTERNAL_SERVICE_FAILED':
        return 'Der Kalender ist gerade nicht erreichbar — bitte gleich erneut versuchen.';
      default:
        return `${fallback} (${err.message})`;
    }
  }
  return 'Keine Verbindung — bitte erneut versuchen.';
}
