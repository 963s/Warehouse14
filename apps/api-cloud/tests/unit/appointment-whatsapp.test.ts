/**
 * appointment-whatsapp lib — token gating (configured vs not), booking-intent
 * detection and the German auto-reply/confirmation builders.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PUBLIC_BASE_URL,
  WhatsAppNotConfiguredError,
  buildAppointmentMessage,
  buildBookingLinkReply,
  detectBookingIntent,
  formatBusinessHoursDe,
  sendAppointmentMessage,
} from '../../src/lib/appointment-whatsapp.js';

const APPOINTMENT = {
  appointmentType: 'VIEWING',
  // 14:00 Europe/Berlin (CEST) on Fri 2026-06-12.
  startsAt: new Date('2026-06-12T12:00:00.000Z'),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectBookingIntent', () => {
  it('matches the booking keywords (case-insensitive)', () => {
    expect(detectBookingIntent('Hätten Sie morgen einen Termin frei?')).toBe(true);
    expect(detectBookingIntent('ich möchte gerne BUCHEN')).toBe(true);
    expect(detectBookingIntent('Wann habt ihr offen?')).toBe(true);
    expect(detectBookingIntent('Zu welcher Uhrzeit kann ich kommen?')).toBe(true);
    expect(detectBookingIntent('I need an appointment')).toBe(true);
    expect(detectBookingIntent('Ich plane einen Besuch bei Ihnen')).toBe(true);
  });

  it('does not match unrelated messages', () => {
    expect(detectBookingIntent('Was kostet Gold heute?')).toBe(false);
    expect(detectBookingIntent('Hallo, verkauft ihr Münzen?')).toBe(false);
  });
});

describe('formatBusinessHoursDe', () => {
  it('formats the contract default into German opening hours', () => {
    expect(
      formatBusinessHoursDe({ 'mo-fr': ['10:00', '18:00'], sa: ['10:00', '14:00'], so: null }),
    ).toBe('Mo.–Fr. 10:00–18:00 Uhr · Sa. 10:00–14:00 Uhr · So. geschlossen');
  });

  it('falls back to the default hours on garbage input', () => {
    expect(formatBusinessHoursDe('kaputt')).toContain('Mo.–Fr. 10:00–18:00 Uhr');
    expect(formatBusinessHoursDe(null)).toContain('Sa. 10:00–14:00 Uhr');
  });
});

describe('buildBookingLinkReply', () => {
  it('is ONE German message with the booking link, hours and address', () => {
    const reply = buildBookingLinkReply(
      `${DEFAULT_PUBLIC_BASE_URL}/termin`,
      'Mo.–Fr. 10:00–18:00 Uhr',
    );
    expect(reply).toContain('http://79.76.116.239/termin');
    expect(reply).toContain('Öffnungszeiten');
    expect(reply).toContain('73614 Schorndorf');
    expect(reply).toContain('online buchen');
  });
});

describe('buildAppointmentMessage', () => {
  it('includes German type label, Berlin date/time and the shop address', () => {
    const msg = buildAppointmentMessage('booking_confirmation', APPOINTMENT);
    expect(msg).toContain('Besichtigung');
    expect(msg).toContain('12.06.2026');
    expect(msg).toContain('14:00');
    expect(msg).toContain('Rosenstraße 40, 73614 Schorndorf');
  });
});

describe('sendAppointmentMessage — token gating', () => {
  it('throws the typed NotConfigured error when env keys are absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      sendAppointmentMessage('reminder_24h', APPOINTMENT, '+491701234567', {
        phoneNumberId: '',
        accessToken: '',
      }),
    ).rejects.toBeInstanceOf(WhatsAppNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends via the Meta Graph API when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.api.1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendAppointmentMessage('reminder_2h', APPOINTMENT, '+491701234567', {
      phoneNumberId: '555000',
      accessToken: 'EAAx',
    });
    expect(res.messageId).toBe('wamid.api.1');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://graph.facebook.com/v20.0/555000/messages');
  });
});
