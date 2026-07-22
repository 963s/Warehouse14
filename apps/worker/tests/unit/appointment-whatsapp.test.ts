/**
 * Token-gating tests for the appointment WhatsApp sender + the sweep's
 * whatsapp dispatch path (configured vs not — the eBay inert pattern).
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchWhatsAppRow } from '../../src/jobs/appointment-notifications.js';
import {
  WhatsAppNotConfiguredError,
  WhatsAppSendError,
  buildAppointmentMessage,
  sendAppointmentMessage,
  toMessageKind,
} from '../../src/jobs/appointment-whatsapp.js';

const dialect = new PgDialect();
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const APPOINTMENT = {
  appointmentType: 'BUYBACK_EVAL',
  // 14:00 Europe/Berlin (CEST, UTC+2) on Fri 2026-06-12.
  startsAt: new Date('2026-06-12T12:00:00.000Z'),
};

const CONFIGURED = { phoneNumberId: '1234567890', accessToken: 'EAAtoken' };
const NOT_CONFIGURED = { phoneNumberId: '', accessToken: '' };

function okFetch(messageId = 'wamid.test.1') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ messages: [{ id: messageId }] }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('buildAppointmentMessage — German template', () => {
  it('includes type, Berlin date/time and the Schorndorf shop address', () => {
    const msg = buildAppointmentMessage('booking_confirmation', APPOINTMENT);
    expect(msg).toContain('Ankauf-Bewertung');
    expect(msg).toContain('12.06.2026');
    expect(msg).toContain('14:00');
    expect(msg).toContain('Rosenstraße 40');
    expect(msg).toContain('73614 Schorndorf');
    expect(msg).toContain('bestätigt');
  });

  it('renders distinct reminder texts for 24h and 2h', () => {
    expect(buildAppointmentMessage('reminder_24h', APPOINTMENT)).toContain('morgen');
    expect(buildAppointmentMessage('reminder_2h', APPOINTMENT)).toContain('heute um 14:00 Uhr');
  });
});

describe('toMessageKind', () => {
  it('maps only the three sendable kinds', () => {
    expect(toMessageKind('booking_confirmation')).toBe('booking_confirmation');
    expect(toMessageKind('reminder_24h')).toBe('reminder_24h');
    expect(toMessageKind('reminder_2h')).toBe('reminder_2h');
    expect(toMessageKind('cancelled')).toBeNull();
    expect(toMessageKind('reminder_30min')).toBeNull();
  });
});

describe('sendAppointmentMessage — token gating', () => {
  it('throws the typed NotConfigured error without touching the network', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      sendAppointmentMessage('reminder_24h', APPOINTMENT, '+491701234567', NOT_CONFIGURED),
    ).rejects.toBeInstanceOf(WhatsAppNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends via the Meta Graph API when configured', async () => {
    const fetchMock = okFetch('wamid.sent.42');
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendAppointmentMessage(
      'booking_confirmation',
      APPOINTMENT,
      '+491701234567',
      CONFIGURED,
    );
    expect(res.messageId).toBe('wamid.sent.42');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v20.0/1234567890/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer EAAtoken');
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe('+491701234567');
    expect(body.text.body).toContain('73614 Schorndorf');
  });

  it('wraps provider rejections in WhatsAppSendError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { code: 190, message: 'bad token' } }),
      }),
    );
    await expect(
      sendAppointmentMessage('reminder_2h', APPOINTMENT, '+491701234567', CONFIGURED),
    ).rejects.toBeInstanceOf(WhatsAppSendError);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Sweep dispatch path — configured vs not
// ────────────────────────────────────────────────────────────────────────

const DUE_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  appointment_id: '22222222-2222-2222-2222-222222222222',
  notification_type: 'booking_confirmation',
  channel: 'whatsapp',
  recipient: '+491701234567',
  template_id: 'booking_confirmation_v1',
  appointment_type: 'VIEWING' as const,
  starts_at: '2026-06-12 14:00:00+02',
  ends_at: '2026-06-12 14:30:00+02',
};

/** Fake db: call #1 = lastInbound SELECT, call #2 = markSent UPDATE. */
function makeDb() {
  const execute = vi.fn();
  execute.mockResolvedValue([]);
  return { db: { execute } as never, execute };
}

function decodedCall(execute: ReturnType<typeof vi.fn>, index: number) {
  const sqlObj = execute.mock.calls[index]?.[0];
  return dialect.sqlToQuery(sqlObj);
}

describe('dispatchWhatsAppRow — gating', () => {
  it('NOT configured → logs + marks the row queued, never calls fetch', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { db, execute } = makeDb();

    const outcome = await dispatchWhatsAppRow({ db, log }, DUE_ROW, NOT_CONFIGURED);

    expect(outcome).toBe('queued');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      'whatsapp not configured — notification queued',
      expect.objectContaining({ id: DUE_ROW.id }),
    );
    // call #0 = lastInbound SELECT, call #1 = markSent UPDATE.
    const update = decodedCall(execute, 1);
    expect(update.sql).toContain('UPDATE appointment_notifications');
    expect(update.params[0]).toBe('queued');
  });

  it('configured → sends and marks the row sent with the Meta message id', async () => {
    const fetchMock = okFetch('wamid.live.7');
    vi.stubGlobal('fetch', fetchMock);
    const { db, execute } = makeDb();

    const outcome = await dispatchWhatsAppRow({ db, log }, DUE_ROW, CONFIGURED);

    expect(outcome).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const update = decodedCall(execute, 1);
    expect(update.params[0]).toBe('sent');
    expect(update.params[1]).toBe('wamid.live.7');
  });

  it('provider failure → marks the row failed (job keeps running)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { code: 131000, message: 'meta down' } }),
      }),
    );
    const { db, execute } = makeDb();

    const outcome = await dispatchWhatsAppRow({ db, log }, DUE_ROW, CONFIGURED);

    expect(outcome).toBe('failed');
    const update = decodedCall(execute, 1);
    expect(update.params[0]).toBe('failed');
  });

  it('unsupported notification type → queued without a send attempt', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { db, execute } = makeDb();

    const outcome = await dispatchWhatsAppRow(
      { db, log },
      { ...DUE_ROW, notification_type: 'cancelled' },
      CONFIGURED,
    );

    expect(outcome).toBe('queued');
    expect(fetchMock).not.toHaveBeenCalled();
    const update = decodedCall(execute, 1);
    expect(update.params[0]).toBe('queued');
  });
});
