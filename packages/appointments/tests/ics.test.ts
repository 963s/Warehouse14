import { describe, expect, it } from 'vitest';

import { buildIcsEvent, escapeIcsText, formatIcsTimestamp } from '../src/index.js';

describe('formatIcsTimestamp', () => {
  it('emits a UTC iCalendar timestamp', () => {
    expect(formatIcsTimestamp(new Date('2026-05-29T14:05:09.000Z'))).toBe('20260529T140509Z');
  });
});

describe('escapeIcsText', () => {
  it('escapes RFC-5545 special characters', () => {
    expect(escapeIcsText('Gold, Silber; Uhren\nund mehr')).toBe(
      'Gold\\, Silber\\; Uhren\\nund mehr',
    );
    expect(escapeIcsText('back\\slash')).toBe('back\\\\slash');
  });
});

describe('buildIcsEvent', () => {
  const ics = buildIcsEvent(
    {
      id: 'abc-123',
      appointmentType: 'VIEWING',
      startsAt: new Date('2026-05-29T12:00:00Z'),
      endsAt: new Date('2026-05-29T12:30:00Z'),
    },
    new Date('2026-05-20T09:00:00Z'),
  );

  it('wraps a single VEVENT with the required fields', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('UID:appt-abc-123@warehouse14.de');
    expect(ics).toContain('DTSTAMP:20260520T090000Z');
    expect(ics).toContain('DTSTART:20260529T120000Z');
    expect(ics).toContain('DTEND:20260529T123000Z');
    expect(ics).toContain('SUMMARY:Warehouse14 - VIEWING appointment');
    expect(ics).toContain('LOCATION:Warehouse14\\, Weil am Rhein');
  });

  it('uses CRLF line terminators', () => {
    expect(ics.includes('\r\n')).toBe(true);
    // No bare LF that isn't part of a CRLF.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });
});
