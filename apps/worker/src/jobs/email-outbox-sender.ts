/**
 * email-outbox-sender — delivers queued transactional mail (migration 0088).
 *
 * The API composes emails at the business moment (welcome, reservation
 * confirmation, cancellation) and queues them in `email_outbox` with the
 * recipient encrypted. This job decrypts INSIDE a pii-keyed transaction and
 * hands the letter to SMTP.
 *
 * Honest degradation: without the SMTP env (SMTP_HOST/PORT/USER/PASS +
 * MAIL_FROM) the job logs its unconfigured state once per boot and leaves
 * everything PENDING — composed, visible, nothing silently dropped. Paste
 * the credentials, restart the worker, the backlog drains.
 *
 * Concurrency: the job runner's advisory lock guarantees a single instance,
 * so a plain batch pick needs no row locking. A letter failing 5 times is
 * parked as FAILED with the last error for inspection.
 */

import nodemailer from 'nodemailer';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;

export interface EmailOutboxSenderOpts {
  /** Reply-To header. Empty falls back to the From address. */
  mailReplyTo?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  mailFrom: string;
  piiKey: string;
}

interface PendingLetter {
  id: string;
  recipient: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  attempts: number;
}

export function emailOutboxSenderJob(
  opts: { [K in keyof EmailOutboxSenderOpts]?: EmailOutboxSenderOpts[K] | undefined },
): JobDefinition {
  const configured = Boolean(
    opts.smtpHost && opts.smtpPort && opts.smtpUser && opts.smtpPass && opts.mailFrom && opts.piiKey,
  );
  const transporter = configured
    ? nodemailer.createTransport({
        host: opts.smtpHost,
        port: opts.smtpPort,
        secure: opts.smtpPort === 465,
        auth: { user: opts.smtpUser, pass: opts.smtpPass },
      })
    : null;
  let warnedUnconfigured = false;

  return {
    name: 'email-outbox-sender',
    schedule: '* * * * *', // every minute — transactional mail should feel immediate
    run: async (ctx: JobContext) => {
      if (!configured || !transporter) {
        if (!warnedUnconfigured) {
          ctx.log.warn('email outbox: SMTP not configured (SMTP_HOST/PORT/USER/PASS + MAIL_FROM + WAREHOUSE14_PII_KEY) — letters stay PENDING');
          warnedUnconfigured = true;
        }
        return { skipped: 'smtp_unconfigured' };
      }

      // Decrypt the batch inside a pii-keyed transaction; send outside it.
      const batch = await ctx.sql.begin(async (s) => {
        await s`SELECT set_config('warehouse14.pii_key', ${opts.piiKey as string}, true)`;
        return await s<PendingLetter[]>`
          SELECT id,
                 decrypt_pii(recipient_encrypted) AS recipient,
                 subject, body_text, body_html, attempts
            FROM email_outbox
           WHERE status = 'PENDING'
           ORDER BY created_at
           LIMIT ${BATCH_SIZE}`;
      });
      if (batch.length === 0) return { sent: 0 };

      let sent = 0;
      let failed = 0;
      for (const letter of batch) {
        if (ctx.signal.aborted) break;
        try {
          if (!letter.recipient) throw new Error('recipient decryption returned null');
          await transporter.sendMail({
            from: opts.mailFrom,
            // A reply must reach a person. Without this the customer's answer
            // goes to whatever address the relay authenticated with, which is
            // not necessarily one anybody reads.
            replyTo: opts.mailReplyTo || opts.mailFrom,
            to: letter.recipient,
            subject: letter.subject,
            text: letter.body_text,
            ...(letter.body_html ? { html: letter.body_html } : {}),
          });
          await ctx.sql`
            UPDATE email_outbox
               SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL
             WHERE id = ${letter.id}`;
          sent += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown send failure';
          const isFinal = letter.attempts + 1 >= MAX_ATTEMPTS;
          await ctx.sql`
            UPDATE email_outbox
               SET status = ${isFinal ? 'FAILED' : 'PENDING'},
                   attempts = attempts + 1,
                   last_error = ${message}
             WHERE id = ${letter.id}`;
          failed += 1;
          ctx.log.warn('email outbox: send failed', { id: letter.id, isFinal, message });
        }
      }
      return { sent, failed };
    },
  };
}
