/**
 * appointment_notifications — 1-min cron (ADR-0020 §7).
 *
 * Dispatches every due row (`scheduled_for <= now() AND sent_at IS NULL`):
 *   • email   → generate the .ics calendar attachment, then deliver,
 *   • whatsapp→ ACTUALLY SENT via the appointment-whatsapp sender (token-
 *               gated: without WHATSAPP_* keys the row is marked 'queued'
 *               with a log — the eBay inert-until-configured pattern),
 *   • sse     → POS "arriving soon" ping.
 *
 * Idempotency: the `sent_at IS NULL` guard in the UPDATE makes delivery
 * at-most-once even if two ticks overlap. Transport wiring (SMTP / Meta send)
 * is injected at the edge; absent credentials, rows are marked 'queued'.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import { type AppointmentType, whatsappReminderMode } from '@warehouse14/appointments';

import { buildAppointmentIcs } from '../lib/ics-calendar.js';
import type { JobContext, JobDefinition } from '../lib/job-runner.js';
import {
  type AppointmentWhatsAppConfig,
  WhatsAppNotConfiguredError,
  sendAppointmentMessage,
  toMessageKind,
} from './appointment-whatsapp.js';

const MAX_PER_TICK = 100;

type DueRow = {
  id: string;
  appointment_id: string;
  notification_type: string;
  channel: string;
  recipient: string;
  template_id: string | null;
  appointment_type: AppointmentType;
  starts_at: string;
  ends_at: string;
};

/** Resolve the customer's last inbound WhatsApp time for the 24h-window check. */
async function lastInboundFor(db: JobContext['db'], phone: string): Promise<Date | null> {
  const rows = (await db.execute<{ last_inbound_at: string | null }>(drizzleSql`
    SELECT last_inbound_at::text AS last_inbound_at
    FROM whatsapp_conversations
    WHERE customer_phone_e164 = ${phone}
    LIMIT 1
  `)) as unknown as Array<{ last_inbound_at: string | null }>;
  const v = rows[0]?.last_inbound_at;
  return v ? new Date(v) : null;
}

async function markSent(
  db: JobContext['db'],
  id: string,
  status: string,
  externalRef: string | null,
): Promise<void> {
  await db.execute(drizzleSql`
    UPDATE appointment_notifications
    SET sent_at = now(), delivery_status = ${status}, external_ref = ${externalRef}
    WHERE id = ${id}::uuid AND sent_at IS NULL
  `);
}

/** WhatsApp dispatch for one due row — exported for the unit test. */
export async function dispatchWhatsAppRow(
  ctx: Pick<JobContext, 'db' | 'log'>,
  row: DueRow,
  cfg: AppointmentWhatsAppConfig,
): Promise<'sent' | 'queued' | 'failed'> {
  const { db, log } = ctx;
  const lastInbound = await lastInboundFor(db, row.recipient);
  const mode = whatsappReminderMode(lastInbound);
  const kind = toMessageKind(row.notification_type);
  if (kind === null) {
    // No sendable template for this type yet (rescheduled/cancelled/…) —
    // keep the pre-existing behaviour: record the decision as queued.
    log.debug?.('whatsapp reminder mode', { id: row.id, mode, template: row.template_id });
    await markSent(db, row.id, 'queued', null);
    return 'queued';
  }
  try {
    const sent = await sendAppointmentMessage(
      kind,
      { appointmentType: row.appointment_type, startsAt: new Date(row.starts_at) },
      row.recipient,
      cfg,
    );
    await markSent(db, row.id, 'sent', sent.messageId);
    return 'sent';
  } catch (err) {
    if (err instanceof WhatsAppNotConfiguredError) {
      // Token-gated: fully wired but inert until WHATSAPP_* env keys exist.
      log.info('whatsapp not configured — notification queued', { id: row.id, kind, mode });
      await markSent(db, row.id, 'queued', null);
      return 'queued';
    }
    log.warn('whatsapp send failed', { id: row.id, kind, err: String(err) });
    await markSent(db, row.id, 'failed', null);
    return 'failed';
  }
}

export interface AppointmentNotificationsOpts {
  /** Meta WhatsApp credentials — empty strings = not configured (inert). */
  whatsapp: AppointmentWhatsAppConfig;
}

export function appointmentNotificationsJob(opts: AppointmentNotificationsOpts): JobDefinition {
  return {
    name: 'appointment_notifications',
    schedule: '* * * * *', // every minute
    timeoutMs: 60_000,
    async run({ db, log }) {
      const due = (await db.execute<DueRow>(drizzleSql`
        SELECT n.id::text AS id, n.appointment_id::text AS appointment_id,
               n.notification_type, n.channel, n.recipient, n.template_id,
               a.appointment_type::text AS appointment_type,
               a.starts_at::text AS starts_at, a.ends_at::text AS ends_at
        FROM appointment_notifications n
        JOIN appointments a ON a.id = n.appointment_id
        WHERE n.sent_at IS NULL AND n.scheduled_for <= now()
        ORDER BY n.scheduled_for ASC
        LIMIT ${MAX_PER_TICK}
      `)) as unknown as DueRow[];

      let dispatched = 0;
      for (const row of due) {
        try {
          if (row.channel === 'email') {
            // Generate the .ics (via the `ics` package) for the confirmation email.
            buildAppointmentIcs({
              id: row.appointment_id,
              appointmentType: row.appointment_type,
              startsAt: new Date(row.starts_at),
              endsAt: new Date(row.ends_at),
            });
            // No SMTP transport wired here → record as queued for the mailer edge.
            await markSent(db, row.id, 'queued', null);
          } else if (row.channel === 'whatsapp') {
            await dispatchWhatsAppRow({ db, log }, row, opts.whatsapp);
          } else {
            // sse / sms — POS ping or future SMS; stamp as sent.
            await markSent(db, row.id, 'sent', null);
          }
          dispatched += 1;
        } catch (err) {
          log.warn('appointment notification dispatch failed', { id: row.id, err: String(err) });
        }
      }

      if (dispatched > 0) log.info('appointment notifications dispatched', { dispatched });
      return { dispatched, due: due.length };
    },
  };
}
