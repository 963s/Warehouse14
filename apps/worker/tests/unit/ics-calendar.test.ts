import { describe, expect, it } from 'vitest';

import { buildAppointmentIcs } from '../../src/lib/ics-calendar.js';

describe('buildAppointmentIcs (ics package)', () => {
  const ics = buildAppointmentIcs({
    id: 'abc-123',
    appointmentType: 'VIEWING',
    startsAt: new Date('2026-05-29T12:00:00Z'),
    endsAt: new Date('2026-05-29T12:30:00Z'),
  });

  it('emits a single VEVENT with the appointment fields', () => {
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('UID:appt-abc-123@warehouse14.de');
    expect(ics).toContain('SUMMARY:Warehouse14 - VIEWING appointment');
    expect(ics).toContain('Weil am Rhein');
  });

  it('encodes the start as a UTC instant (DTSTART …Z)', () => {
    expect(ics).toMatch(/DTSTART:20260529T120000Z/);
  });
});
