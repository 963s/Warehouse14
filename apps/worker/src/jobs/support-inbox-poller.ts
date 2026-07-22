/**
 * Support inbox poller (0097) — the half of the conversation that was missing.
 *
 * Until now mail was outbound only. A customer who replied to a reservation
 * letter was writing into nothing: no record, no ticket, nobody notified. This
 * job reads the shop mailbox once a minute and files what it finds against a
 * ticket, so a question asked at nine in the evening is on the counter screen
 * rather than in an inbox nobody has opened for a month.
 *
 * Matching a message to a ticket, in order of how much we trust it:
 *   1. `TIC-2026-000001` in the subject — survives forwarding and quoting.
 *   2. The Gmail thread id — right whenever the customer used Reply.
 *   3. Neither: this is a new conversation, so open a ticket.
 *
 * Dedupe is the UNIQUE on `support_messages.gmail_message_id`. The poller may
 * legitimately see the same message twice (a crash between filing and marking
 * read, a restart mid-batch), and the second insert simply loses. That is
 * deliberately cheaper than trying to make the two writes atomic across an
 * API we do not control.
 */

import type { JobContext, JobDefinition } from '../lib/job-runner.js';
import { GmailClient, addressOf, displayNameOf } from '../lib/gmail.js';

export interface SupportInboxOptions {
  serviceAccountB64?: string | undefined;
  /** Real mailbox to read. An alias cannot be impersonated. */
  mailbox?: string | undefined;
  piiKey?: string | undefined;
  /** Our own addresses, so a letter we sent is never filed as a customer one. */
  ownAddresses: string[];
}

const BATCH = 25;
/** `TIC-2026-000001`, anywhere in a subject line, however it was quoted. */
const TICKET_RE = /\bTIC-\d{4}-\d{6}\b/i;

export function supportInboxPollerJob(opts: SupportInboxOptions): JobDefinition {
  const configured = Boolean(opts.serviceAccountB64 && opts.mailbox && opts.piiKey);
  const client = configured
    ? new GmailClient(opts.serviceAccountB64 as string, opts.mailbox as string)
    : null;
  const own = new Set(opts.ownAddresses.map((a) => a.toLowerCase()));
  let warnedUnconfigured = false;

  return {
    name: 'support-inbox-poller',
    schedule: '* * * * *',
    run: async (ctx: JobContext) => {
      if (!configured || !client) {
        if (!warnedUnconfigured) {
          ctx.log.warn(
            'support inbox: not configured (need GOOGLE_SERVICE_ACCOUNT_B64, SUPPORT_MAILBOX, WAREHOUSE14_PII_KEY) — customer replies are NOT being collected',
          );
          warnedUnconfigured = true;
        }
        return { skipped: 'not_configured' };
      }

      const now = Date.now();
      const ids = await client.listIds('is:unread -in:chats', BATCH, now);
      if (ids.length === 0) return { filed: 0 };

      let filed = 0;
      let skipped = 0;
      let failed = 0;

      for (const id of ids) {
        if (ctx.signal.aborted) break;
        try {
          const msg = await client.get(id, now);
          const from = addressOf(msg.header('from'));

          // Our own outbound mail can land here (a bounce, a copy, a loop).
          // Filing it would answer the customer with their own words.
          if (!from || own.has(from)) {
            await client.markRead(id, now);
            skipped += 1;
            continue;
          }

          const subject = (msg.header('subject') ?? '(ohne Betreff)').slice(0, 500);
          const toAddress = addressOf(msg.header('to')) ?? opts.mailbox!;
          const ticketRef = subject.match(TICKET_RE)?.[0]?.toUpperCase() ?? null;
          const senderName = displayNameOf(msg.header('from'));

          await ctx.sql.begin(async (s) => {
            await s`SELECT set_config('warehouse14.pii_key', ${opts.piiKey as string}, true)`;

            // Who is this, if we know them at all? A stranger writing in for
            // the first time is still worth a ticket; the link is what may be
            // missing, not the conversation.
            const known = await s<{ id: string }[]>`
              SELECT id FROM customers
               WHERE email_blind_index = blind_index(${from})
                 AND soft_deleted_at IS NULL
               LIMIT 1`;
            const customerId = known[0]?.id ?? null;

            const existing = await s<{ id: string }[]>`
              SELECT id FROM support_tickets
               WHERE (${ticketRef}::text IS NOT NULL AND ticket_number = ${ticketRef})
                  OR (${ticketRef}::text IS NULL AND gmail_thread_id = ${msg.threadId})
               ORDER BY created_at DESC
               LIMIT 1`;

            let ticketId = existing[0]?.id ?? null;
            if (!ticketId) {
              const [created] = await s<{ id: string }[]>`
                INSERT INTO support_tickets (customer_id, subject, gmail_thread_id, last_inbound_at)
                VALUES (${customerId}, ${subject}, ${msg.threadId}, now())
                RETURNING id`;
              ticketId = created!.id;
            } else {
              // A reply reopens: a closed ticket the customer is still writing
              // to is not closed, whatever the last person to touch it thought.
              await s`
                UPDATE support_tickets
                   SET status = CASE WHEN status = 'GESCHLOSSEN' THEN 'OFFEN' ELSE status END,
                       customer_id = COALESCE(customer_id, ${customerId}),
                       gmail_thread_id = COALESCE(gmail_thread_id, ${msg.threadId}),
                       last_inbound_at = now(),
                       updated_at = now()
                 WHERE id = ${ticketId}`;
            }

            // ON CONFLICT is the dedupe. Seeing a message twice is expected.
            await s`
              INSERT INTO support_messages
                     (ticket_id, direction, from_encrypted, to_encrypted, body_encrypted, gmail_message_id)
              VALUES (${ticketId}, 'INBOUND',
                      encrypt_pii(${senderName ? `${senderName} <${from}>` : from}),
                      encrypt_pii(${toAddress}),
                      encrypt_pii(${msg.body || '(leere Nachricht)'}),
                      ${msg.id})
              ON CONFLICT (gmail_message_id) DO NOTHING`;
          });

          // Only after the transaction commits. Marking read first would lose
          // the message permanently if the write then failed.
          await client.markRead(id, now);
          filed += 1;
        } catch (err) {
          failed += 1;
          ctx.log.warn('support inbox: could not file message', {
            id,
            message: err instanceof Error ? err.message : 'unknown',
          });
        }
      }

      return { filed, skipped, failed };
    },
  };
}
