/**
 * Appointment .ics generation via the `ics` package (ADR-0020 §10).
 *
 * Times are emitted as UTC instants (startInputType/OutputType = 'utc'), which
 * every calendar client renders in the viewer's local zone — correct for an
 * absolute appointment time (the shop is Europe/Berlin; the instant is exact).
 */

import { type EventAttributes, createEvent } from 'ics';

export interface IcsAppointmentInput {
  id: string;
  appointmentType: string;
  startsAt: Date;
  endsAt: Date;
  description?: string;
}

/** UTC [year, month(1-12), day, hour, minute] for the `ics` DateArray. */
function toUtcDateArray(d: Date): [number, number, number, number, number] {
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ];
}

/** Build a VCALENDAR string for one appointment. Throws on generation error. */
export function buildAppointmentIcs(input: IcsAppointmentInput): string {
  const durationMinutes = Math.max(
    1,
    Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000),
  );

  const attributes: EventAttributes = {
    uid: `appt-${input.id}@warehouse14.de`,
    start: toUtcDateArray(input.startsAt),
    startInputType: 'utc',
    startOutputType: 'utc',
    duration: { minutes: durationMinutes },
    title: `Warehouse14 - ${input.appointmentType} appointment`,
    location: 'Warehouse14, Weil am Rhein',
    description: input.description ?? 'Ihr Termin bei Warehouse14. Wir freuen uns auf Sie.',
    productId: 'warehouse14/ics',
    status: 'CONFIRMED',
  };

  const { error, value } = createEvent(attributes);
  if (error || !value) {
    throw error ?? new Error('ics: createEvent returned no value');
  }
  return value;
}
