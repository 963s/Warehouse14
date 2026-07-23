/**
 * push-outbox-sender — trägt die eingereihten Benachrichtigungen aus.
 *
 * Gegenstelle ist Googles Zustelldienst FCM, DIREKT — nicht mehr über Expo.
 * Der Grund steht ausführlich in `fcm-transport.ts`: Expo nimmt eine Nachricht
 * auch dann an und bestätigt sie, wenn ihm die Firebase-Zugangsdaten des Ladens
 * fehlen, und dann kommt nie ein Ton an. Ein bestätigter Beleg für eine
 * Nachricht, die niemanden erreicht, ist die schlimmste Sorte Fehler hier.
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
import { fcmConfigured, fcmProjectId, fcmSend } from './fcm-transport.js';

/**
 * Wie viele Nachrichten ein Lauf austrägt.
 *
 * FCM v1 hat den Stapelversand 2024 abgeschafft, also ist es ein Aufruf je
 * Nachricht. Fünfzig in einer Minute ist reichlich für einen Laden und hält
 * einen einzelnen Lauf weit unter der Zeitgrenze.
 */
const BATCH_SIZE = 50;

interface PendingPush {
  id: string;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
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
      // ZUERST fragen, ob überhaupt zugestellt werden KANN. Ohne diese
      // Prüfung würde jeder Lauf auf einem unkonfigurierten Server die
      // Warteschlange mit Fehlversuchen füllen und am Ende jede Nachricht als
      // gescheitert abstempeln — obwohl kein einziges Gerät etwas falsch
      // gemacht hat und alles sofort ginge, sobald der Schlüssel da ist.
      if (!fcmConfigured()) {
        const [{ offen }] = (await ctx.sql`
          SELECT count(*)::int AS offen FROM push_outbox WHERE status = 'PENDING'`) as unknown as [
          { offen: number },
        ];
        if (offen > 0) {
          ctx.log.warn(
            'Push-Ausgang: die Zustellung ist nicht eingerichtet, es wartet etwas',
            { wartend: offen },
          );
        }
        return { sent: 0, unconfigured: true, waiting: offen };
      }

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

      for (const p of batch) {
        const r = await fcmSend(
          { token: p.token, title: p.title, body: p.body, data: p.data },
          ctx.signal,
        );

        if (r.ok) {
          await ctx.sql`
            UPDATE push_outbox
               SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL
             WHERE id = ${p.id}::uuid`;
          sent += 1;
          continue;
        }

        // Eine tote Marke ist endgültig: die Nachricht ist verloren UND die
        // Marke gehört widerrufen. Alles andere (Netz, Google hat Schluckauf)
        // bleibt PENDING und wird beim nächsten Lauf erneut versucht — sonst
        // stirbt eine Bestellmeldung an einer Sekunde schlechter Verbindung.
        if (r.unregistered) {
          await ctx.sql`
            UPDATE push_outbox
               SET status = 'FAILED', attempts = attempts + 1, last_error = ${r.reason}
             WHERE id = ${p.id}::uuid`;
          await ctx.sql`
            UPDATE device_push_tokens SET revoked_at = now()
             WHERE token = ${p.token} AND revoked_at IS NULL`;
          failed += 1;
          revoked += 1;
          continue;
        }

        // Nach zehn vergeblichen Anläufen ist auch die Geduld ehrlich zu Ende.
        // Der Grund bleibt lesbar in der Zeile stehen.
        const naechsterVersuch = p.attempts + 1;
        if (naechsterVersuch >= 10) {
          await ctx.sql`
            UPDATE push_outbox
               SET status = 'FAILED', attempts = ${naechsterVersuch}, last_error = ${r.reason}
             WHERE id = ${p.id}::uuid`;
          failed += 1;
        } else {
          await ctx.sql`
            UPDATE push_outbox
               SET attempts = ${naechsterVersuch}, last_error = ${r.reason}
             WHERE id = ${p.id}::uuid`;
        }
      }

      if (failed > 0 || revoked > 0) {
        ctx.log.warn('Push-Ausgang: nicht alles ging hinaus', {
          sent,
          failed,
          revoked,
          projekt: fcmProjectId(),
        });
      }
      return { sent, failed, revoked };
    },
  };
}
