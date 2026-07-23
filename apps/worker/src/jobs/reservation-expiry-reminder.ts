/**
 * reservation_expiry_reminder — der Brief, bevor eine Reservierung verfällt.
 *
 * Eine Web-Reservierung hält die Ware drei Tage. Danach gibt der Kehrer sie
 * frei und der Beleg wird ABANDONED. Bis zum 23.07.2026 geschah das ohne ein
 * einziges Wort: der Mensch glaubte, er habe noch Zeit, und fand sein Stück
 * beim nächsten Besuch im Regal. Ein Kunde, der nie gewarnt wurde, hat nichts
 * versäumt, und das Haus hat einen Verkauf verloren, den ein Satz gerettet
 * hätte.
 *
 * WARUM DIESER JOB IM WORKER LEBT UND TROTZDEM DEN RICHTIGEN BRIEF SCHREIBT
 * Der Verfasser lag früher in api-cloud, das der worker nicht einbinden kann.
 * Seit dem gemeinsamen Paket `@warehouse14/email` verfassen beide Seiten
 * denselben Brief aus derselben Wortliste, statt zwei Fassungen zu pflegen,
 * die auseinanderlaufen.
 *
 * EHRLICHKEIT
 *   • Ohne PII-Schlüssel wird NICHT geraten und NICHT geschrieben: der Lauf
 *     meldet `skipped`, damit ein fehlender Schlüssel wie ein fehlender
 *     Schlüssel aussieht und nicht wie „nichts zu tun".
 *   • Die Frist kommt aus `products.reservation_expires_at`, also aus dem
 *     Halt selbst. Es wird kein Datum gerechnet, das nirgends steht.
 *   • `expiry_reminder_sent_at` wird im SELBEN Vorgang gesetzt wie der Brief
 *     eingereiht wird. Entweder beides oder keines; ein zweiter Brief an
 *     denselben Menschen ist ausgeschlossen.
 *   • Wer keine E-Mail hinterlassen hat (Gast mit Telefonnummer), wird
 *     übersprungen und im Ergebnis GEZÄHLT, nicht verschwiegen.
 */

import { composeExpiryReminder } from '@warehouse14/email';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

/**
 * Wie lange vor Ablauf erinnert wird. Ein Tag ist die ehrliche Wahl: früh
 * genug, um den Weg ins Geschäft zu planen, spät genug, dass die Erinnerung
 * nicht in Vergessenheit gerät, bevor die Frist überhaupt naht.
 */
const REMIND_WITHIN_HOURS = 24;

/** Wie viele Briefe ein Lauf höchstens schreibt. Hält einen Rückstau ruhig. */
const BATCH_SIZE = 50;

interface DueRow {
  cart_id: string;
  order_number: string | null;
  customer_id: string;
  full_name: string | null;
  email: string | null;
  preferred_language: string | null;
  expires_at: string;
}

export function reservationExpiryReminderJob(opts: { piiKey: string }): JobDefinition {
  let warnedUnconfigured = false;

  return {
    name: 'reservation_expiry_reminder',
    // Alle fünfzehn Minuten. Ein Brief, der eine Frist ankündigt, muss nicht
    // auf die Sekunde genau sein, aber er darf auch nicht erst nach dem
    // Verfall eintreffen.
    schedule: '*/15 * * * *',
    timeoutMs: 60_000,
    run: async (ctx: JobContext) => {
      if (!opts.piiKey) {
        if (!warnedUnconfigured) {
          ctx.log.warn(
            'Erinnerung vor Fristablauf: WAREHOUSE14_PII_KEY fehlt, ohne Schlüssel ist keine Anschrift lesbar. Es wird nichts geschrieben.',
          );
          warnedUnconfigured = true;
        }
        return { skipped: 'pii_key_missing' };
      }

      let reminded = 0;
      let withoutEmail = 0;

      await ctx.sql.begin(async (s) => {
        await s`SELECT set_config('warehouse14.pii_key', ${opts.piiKey}, true)`;

        // Fällige Reservierungen: noch laufend, Abholung, noch nicht erinnert,
        // und ihr frühester Halt läuft innerhalb des Fensters ab. Die Frist
        // stammt aus dem Halt, nicht aus einer Rechnung auf reserved_at.
        const due = await s<DueRow[]>`
          SELECT c.id::text                             AS cart_id,
                 c.order_number,
                 cu.id::text                            AS customer_id,
                 decrypt_pii(cu.full_name_encrypted)    AS full_name,
                 decrypt_pii(cu.email_encrypted)        AS email,
                 s2.preferred_language,
                 to_char(x.expires_at AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at
            FROM carts c
            JOIN shoppers  s2 ON s2.id = c.shopper_id
            JOIN customers cu ON cu.id = s2.customer_id
            JOIN LATERAL (
                   SELECT MIN(p.reservation_expires_at) AS expires_at
                     FROM products p
                    WHERE p.reserved_by_session_id = c.reservation_session_id
                      AND p.status = 'RESERVED'
                 ) x ON TRUE
           WHERE c.status                  = 'RESERVED'
             AND c.fulfilment_method       = 'PICKUP'
             AND c.expiry_reminder_sent_at IS NULL
             AND x.expires_at IS NOT NULL
             AND x.expires_at >  now()
             AND x.expires_at <= now() + ${`${REMIND_WITHIN_HOURS} hours`}::interval
           ORDER BY x.expires_at
           LIMIT ${BATCH_SIZE}`;

        for (const row of due) {
          if (ctx.signal.aborted) break;

          // Ohne Anschrift kein Brief. Das ist kein Fehler, sondern ein Gast,
          // der eine Telefonnummer hinterlassen hat. Der Merker wird trotzdem
          // gesetzt, sonst prüft der Job denselben Beleg alle fünfzehn Minuten
          // bis zum Verfall erneut.
          if (!row.email) {
            withoutEmail += 1;
            await s`UPDATE carts SET expiry_reminder_sent_at = now() WHERE id = ${row.cart_id}::uuid`;
            continue;
          }

          const mail = composeExpiryReminder(
            row.full_name,
            row.order_number ?? '',
            new Date(row.expires_at),
            row.preferred_language,
          );

          await s`
            INSERT INTO email_outbox (recipient_encrypted, template, subject, body_text, body_html,
                                      locale, customer_id)
            VALUES (encrypt_pii(${row.email}), ${mail.template}, ${mail.subject}, ${mail.text},
                    ${mail.html}, ${mail.locale}, ${row.customer_id}::uuid)`;

          await s`UPDATE carts SET expiry_reminder_sent_at = now() WHERE id = ${row.cart_id}::uuid`;
          reminded += 1;
        }
      });

      if (reminded > 0 || withoutEmail > 0) {
        ctx.log.info('Erinnerung vor Fristablauf: Briefe eingereiht', {
          reminded,
          withoutEmail,
        });
      }
      return { reminded, withoutEmail };
    },
  };
}
