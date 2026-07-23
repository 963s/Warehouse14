/**
 * push-outbox-sender — trägt die eingereihten Benachrichtigungen aus.
 *
 * Gegenstelle ist der Expo-Push-Dienst, per schlichtem HTTPS-Aufruf statt über
 * ein weiteres Paket: die Schnittstelle ist ein einziger POST, und eine
 * Abhängigkeit weniger ist eine Bruchstelle weniger.
 *
 * EHRLICHKEIT, dieselbe wie beim Postausgang
 *   • Nichts zu tun heisst `{ sent: 0 }`, nicht Schweigen.
 *   • Ein Fehlschlag bleibt SICHTBAR: die Zeile geht auf FAILED mit dem
 *     Klartext des Fehlers, statt still zu verschwinden.
 *   • Meldet der Dienst „DeviceNotRegistered", wird die Marke WIDERRUFEN.
 *     Eine tote Marke, die ewig weiter angeschrieben wird, erzeugt jeden Lauf
 *     denselben Fehler und verdeckt die echten.
 *   • Es wird NIE behauptet, etwas sei zugestellt, weil der Dienst die
 *     Annahme bestätigt hat. Angenommen heisst angenommen, nicht angekommen.
 */

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Wie viele Nachrichten ein Lauf austrägt. Expo nimmt bis zu 100 je Aufruf. */
const BATCH_SIZE = 100;

interface PendingPush {
  id: string;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export function pushOutboxSenderJob(): JobDefinition {
  return {
    name: 'push_outbox_sender',
    // Jede Minute. Eine Bestellung, von der das Personal erst in einer
    // Viertelstunde erfährt, ist eine Viertelstunde Wartezeit für einen
    // Menschen, der eine Antwort erwartet.
    schedule: '* * * * *',
    timeoutMs: 30_000,
    run: async (ctx: JobContext) => {
      const batch = (await ctx.sql`
        SELECT id::text AS id, token, title, body, data, attempts
          FROM push_outbox
         WHERE status = 'PENDING'
         ORDER BY created_at
         LIMIT ${BATCH_SIZE}`) as unknown as PendingPush[];

      if (batch.length === 0) return { sent: 0 };

      let sent = 0;
      let failed = 0;
      let revoked = 0;

      // Expo nimmt die ganze Stapelmenge in EINEM Aufruf und antwortet mit
      // einem Beleg je Nachricht, in derselben Reihenfolge.
      let tickets: ExpoTicket[] = [];
      try {
        const res = await fetch(EXPO_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(
            batch.map((p) => ({
              to: p.token,
              title: p.title,
              body: p.body,
              data: p.data,
              sound: 'default',
              priority: 'high',
            })),
          ),
          signal: ctx.signal,
        });
        if (!res.ok) {
          throw new Error(`Expo antwortete ${res.status} ${res.statusText}`);
        }
        const parsed = (await res.json()) as { data?: ExpoTicket[] };
        tickets = parsed.data ?? [];
      } catch (err) {
        // Der ganze Aufruf ist gescheitert. KEINE Zeile wird auf SENT gesetzt.
        // Der Versuchszähler steigt, damit ein dauerhaft gestörter Dienst am
        // Zähler ablesbar ist und nicht nur an ausbleibenden Nachrichten.
        const text = err instanceof Error ? err.message : String(err);
        for (const p of batch) {
          await ctx.sql`
            UPDATE push_outbox
               SET attempts = attempts + 1, last_error = ${text}
             WHERE id = ${p.id}::uuid`;
        }
        ctx.log.warn('Push-Ausgang: der Dienst war nicht erreichbar, nichts gesendet', {
          pending: batch.length,
          error: text,
        });
        return { sent: 0, failed: 0, unreachable: batch.length };
      }

      for (let i = 0; i < batch.length; i += 1) {
        const p = batch[i]!;
        const t = tickets[i];

        if (t?.status === 'ok') {
          await ctx.sql`
            UPDATE push_outbox
               SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL
             WHERE id = ${p.id}::uuid`;
          sent += 1;
          continue;
        }

        const reason = t?.message ?? 'Der Dienst hat keinen Beleg zu dieser Nachricht geliefert';
        await ctx.sql`
          UPDATE push_outbox
             SET status = 'FAILED', attempts = attempts + 1, last_error = ${reason}
           WHERE id = ${p.id}::uuid`;
        failed += 1;

        // Eine abgemeldete Marke gehört widerrufen, sonst scheitert sie ewig.
        if (t?.details?.error === 'DeviceNotRegistered') {
          await ctx.sql`
            UPDATE device_push_tokens SET revoked_at = now()
             WHERE token = ${p.token} AND revoked_at IS NULL`;
          revoked += 1;
        }
      }

      if (failed > 0 || revoked > 0) {
        ctx.log.warn('Push-Ausgang: nicht alles ging hinaus', { sent, failed, revoked });
      }
      return { sent, failed, revoked };
    },
  };
}
