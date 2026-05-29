/**
 * AppointmentsWorkspace — Control Desktop calendar (ADR-0020).
 *
 *   • left/center — interactive scheduling grid via @fullcalendar/react
 *     (timeGrid week/day, Europe/Berlin), driven by the live appointment list;
 *   • right — booking drawer (slot-verified POST /api/appointments).
 *
 * The visible range drives the appointments query (datesSet), and clicking an
 * empty slot pre-fills the booking drawer's start time. All times render in
 * Europe/Berlin (FullCalendar `timeZone`).
 */

import type { DateSelectArg, DatesSetArg, EventClickArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useMemo, useState } from 'react';

import type { AppointmentType } from '@warehouse14/api-client';

import { useAppointments, useBookAppointment } from '../../hooks/useAppointments.js';

const APPOINTMENT_TYPES: AppointmentType[] = ['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION', 'PICKUP'];

const BERLIN_TZ = 'Europe/Berlin';

interface BookingDraft {
  type: AppointmentType;
  staffUserId: string;
  startsAtLocal: string;
  durationMinutes: string;
  customerNotes: string;
}

function emptyDraft(): BookingDraft {
  return {
    type: 'VIEWING',
    staffUserId: '',
    startsAtLocal: '',
    durationMinutes: '',
    customerNotes: '',
  };
}

/** ISO instant → value for a <input type="datetime-local"> (local wall clock). */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function AppointmentsWorkspace(): JSX.Element {
  // Visible calendar range — seeded to the current week, updated by datesSet.
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  });
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const book = useBookAppointment();

  const { data, isError } = useAppointments(range.from, range.to);

  const events = useMemo<EventInput[]>(
    () =>
      data.map((appt) => ({
        id: appt.id,
        title: `${appt.appointment_type} · ${appt.status}`,
        start: appt.starts_at,
        end: appt.ends_at,
      })),
    [data],
  );

  const setField =
    (key: keyof BookingDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value }));

  const canBook = draft.staffUserId.trim().length > 0 && draft.startsAtLocal.length > 0;

  const submitBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canBook) return;
    book.mutate(
      {
        type: draft.type,
        staffUserId: draft.staffUserId,
        startsAt: new Date(draft.startsAtLocal).toISOString(),
        bookedVia: 'control_desktop',
        ...(draft.durationMinutes ? { durationMinutes: Number(draft.durationMinutes) } : {}),
        ...(draft.customerNotes ? { customerNotes: draft.customerNotes } : {}),
      },
      { onSuccess: () => setDraft(emptyDraft()) },
    );
  };

  const onDatesSet = (arg: DatesSetArg) => {
    setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() });
  };

  // Selecting an empty slot pre-fills the booking drawer's start time.
  const onSelect = (arg: DateSelectArg) => {
    setDraft((d) => ({ ...d, startsAtLocal: toDatetimeLocal(arg.start) }));
  };

  const onEventClick = (arg: EventClickArg) => {
    const start = arg.event.start;
    if (start) setDraft((d) => ({ ...d, startsAtLocal: toDatetimeLocal(start) }));
  };

  return (
    <div
      className="appointments-workspace"
      style={{ display: 'flex', gap: '16px', height: '100%' }}
    >
      {/* Center — interactive scheduling grid */}
      <main
        className="appt-calendar"
        aria-label="Terminkalender"
        style={{ flexGrow: 1, minWidth: 0 }}
      >
        {isError ? <p role="alert">Termine konnten nicht geladen werden.</p> : null}
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          timeZone={BERLIN_TZ}
          locale="de"
          firstDay={1}
          nowIndicator
          selectable
          slotMinTime="07:00:00"
          slotMaxTime="20:00:00"
          height="100%"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridWeek,timeGridDay,dayGridMonth',
          }}
          events={events}
          datesSet={onDatesSet}
          select={onSelect}
          eventClick={onEventClick}
        />
      </main>

      {/* Right — booking drawer */}
      <aside
        className="appt-booking-drawer"
        aria-label="Termin buchen"
        style={{ width: 300, flexShrink: 0 }}
      >
        <h3>Neuer Termin</h3>
        <form onSubmit={submitBooking}>
          <label>
            Typ
            <select value={draft.type} onChange={setField('type')}>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mitarbeiter (User-ID)
            <input value={draft.staffUserId} onChange={setField('staffUserId')} />
          </label>
          <label>
            Beginn
            <input
              type="datetime-local"
              value={draft.startsAtLocal}
              onChange={setField('startsAtLocal')}
            />
          </label>
          <label>
            Dauer (min, optional)
            <input
              value={draft.durationMinutes}
              onChange={setField('durationMinutes')}
              inputMode="numeric"
            />
          </label>
          <label>
            Notiz
            <textarea value={draft.customerNotes} onChange={setField('customerNotes')} />
          </label>
          <button type="submit" disabled={!canBook || book.isPending}>
            {book.isPending ? 'Buche…' : 'Termin buchen'}
          </button>
          {book.isError ? <span role="alert">Buchung fehlgeschlagen (Slot belegt?).</span> : null}
          {book.isSuccess ? <span>Termin gebucht.</span> : null}
        </form>
      </aside>
    </div>
  );
}
