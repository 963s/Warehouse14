/**
 * appointment_no_show_detector — 1-min cron (ADR-0020 §8).
 *
 * Marks appointments NO_SHOW once the grace window (system_settings
 * appointment.no_show_grace_minutes, default 30) has elapsed without a
 * check-in, RELEASES their soft viewing-holds, and queues a follow-up. The
 * orchestration lives in lib/no-show-detector.ts (unit-tested); this job wires
 * the SQL via ctx.db.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import { DEFAULT_NO_SHOW_GRACE_MINUTES } from '@warehouse14/appointments';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';
import {
  type ExpiredAppointment,
  type NoShowDeps,
  detectNoShows,
} from '../lib/no-show-detector.js';

async function readGraceMinutes(db: JobContext['db']): Promise<number> {
  const rows = (await db.execute<{ grace: number }>(drizzleSql`
    SELECT COALESCE((value::text)::int, ${DEFAULT_NO_SHOW_GRACE_MINUTES}) AS grace
    FROM system_settings WHERE key = 'appointment.no_show_grace_minutes'
  `)) as unknown as Array<{ grace: number }>;
  return rows[0]?.grace ?? DEFAULT_NO_SHOW_GRACE_MINUTES;
}

function buildDeps(db: JobContext['db']): NoShowDeps {
  return {
    async listExpired(graceMinutes) {
      const rows = (await db.execute<{ id: string; customer_id: string | null }>(drizzleSql`
        SELECT a.id::text AS id, a.customer_id::text AS customer_id
        FROM appointments a
        WHERE a.status IN ('SCHEDULED', 'CONFIRMED')
          AND now() > a.starts_at + make_interval(mins => ${graceMinutes})
        ORDER BY a.starts_at ASC
        LIMIT 200
      `)) as unknown as Array<{ id: string; customer_id: string | null }>;
      return rows.map(
        (r): ExpiredAppointment => ({
          id: r.id,
          customerId: r.customer_id,
          // The dispatcher resolves customer_id → contact at send time.
          recipient: r.customer_id,
        }),
      );
    },
    async markNoShow(appointmentId) {
      await db.execute(drizzleSql`
        UPDATE appointments
        SET status = 'NO_SHOW', no_show_marked_at = now()
        WHERE id = ${appointmentId}::uuid AND status IN ('SCHEDULED', 'CONFIRMED')
      `);
    },
    async releaseHolds(appointmentId, reason) {
      const rows = (await db.execute<{ id: string }>(drizzleSql`
        UPDATE product_viewing_holds
        SET released_at = now(), released_reason = ${reason}
        WHERE appointment_id = ${appointmentId}::uuid AND released_at IS NULL
        RETURNING id::text AS id
      `)) as unknown as Array<{ id: string }>;
      return rows.length;
    },
    async queueFollowUp(appt) {
      if (!appt.recipient) return;
      await db.execute(drizzleSql`
        INSERT INTO appointment_notifications
          (appointment_id, notification_type, channel, recipient, scheduled_for)
        VALUES (${appt.id}::uuid, 'no_show_followup', 'whatsapp', ${appt.recipient}, now())
      `);
    },
  };
}

export const appointmentNoShowDetectorJob: JobDefinition = {
  name: 'appointment_no_show_detector',
  schedule: '* * * * *', // every minute
  timeoutMs: 60_000,
  async run({ db, log }) {
    const graceMinutes = await readGraceMinutes(db);
    const result = await detectNoShows(buildDeps(db), {
      graceMinutes,
      log: { warn: (m, e) => log.warn(m, { err: String(e) }) },
    });
    if (result.markedNoShow.length > 0) {
      log.info('appointment no-shows processed', {
        marked: result.markedNoShow.length,
        holdsReleased: result.holdsReleased,
        followUpsQueued: result.followUpsQueued,
      });
    }
    return {
      marked: result.markedNoShow.length,
      holdsReleased: result.holdsReleased,
      followUpsQueued: result.followUpsQueued,
    };
  },
};
