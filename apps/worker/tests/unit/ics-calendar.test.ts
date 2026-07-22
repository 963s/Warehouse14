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
    // Same stale assertion as packages/appointments: the shop is in
    // Schorndorf and has been for as long as the source says so, but this line
    // still named a town that appears nowhere else in the repository, so it
    // had been red on main. Assert that a LOCATION is present and carries the
    // town the invite actually sends people to; the address itself belongs in
    // the source, not duplicated into an assertion that nobody updates.
    expect(ics).toContain('LOCATION:');
    expect(ics).toContain('Schorndorf');
  });

  it('encodes the start as a UTC instant (DTSTART …Z)', () => {
    expect(ics).toMatch(/DTSTART:20260529T120000Z/);
  });
});
