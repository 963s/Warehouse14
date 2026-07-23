/**
 * Benachrichtigungen auf das Gerät — Verfassen und Einreihen (0103).
 *
 * WARUM ES DAS GIBT
 * Bis zum 23.07.2026 erfuhr niemand, dass eine Bestellung eingetroffen ist.
 * Der Abholablauf war vollständig gebaut und trotzdem unsichtbar: wer nicht
 * zufällig in die Warteschlange sah, sah nichts. Basels Satz dazu war der
 * richtige Befund, nicht ein Wunsch.
 *
 * DIE GESTALT IST BEWUSST DIE VON `email_outbox`
 * Eingereiht, sichtbar, mit Versuchszähler und ehrlichem Fehlertext. Eine
 * Benachrichtigung, die nicht hinausging, bleibt LIEGEN und ist auffindbar,
 * statt in einem verschluckten catch zu verschwinden. Ein stiller Fehlschlag
 * ist hier schlimmer als gar kein Versand, weil niemand ihn vermisst.
 *
 * WAS DIESE DATEI NICHT TUT
 * Sie sendet nicht. Der Versand liegt im worker, wie bei der Post auch, damit
 * eine langsame oder gestörte Gegenstelle nie eine Kundenanfrage aufhält.
 */

import { sql as drizzleSql } from 'drizzle-orm';

/**
 * Ein Ausführer, der rohes SQL kann. Dieselbe schmale Gestalt wie im
 * Postausgang: `unknown` statt eines eigenen Typparameters, weil Drizzles
 * `execute` je nach Aufrufer verschieden typisiert ist und ein eigener
 * Parameter dort nicht zuweisbar wäre.
 */
type SqlExecutor = { execute: (q: ReturnType<typeof drizzleSql>) => Promise<unknown> };

/** Was auf dem Gerät erscheint, plus die Fracht für den Sprung in die App. */
export interface PushMessage {
  title: string;
  body: string;
  /** Wohin die App springen soll, wenn jemand tippt. */
  data: Record<string, string>;
}

/**
 * Eine neue Bestellung. Der einzige Anlass, der das Personal SOFORT erreichen
 * muss: solange niemand sie annimmt, wartet ein Mensch auf Antwort und die
 * Frist läuft.
 */
export function pushNewOrder(orderNumber: string, contactName: string | null, itemCount: number): PushMessage {
  const wer = contactName?.trim() ? contactName.trim() : 'Ein Gast';
  const stueck = itemCount === 1 ? 'ein Stück' : `${itemCount} Stücke`;
  return {
    title: 'Neue Bestellung',
    body: `${wer} hat ${stueck} reserviert. ${orderNumber}`,
    data: { kind: 'order', orderNumber },
  };
}

/**
 * Die Empfänger einer Personal-Benachrichtigung: jedes nicht widerrufene Gerät
 * eines Menschen mit Rolle ADMIN oder CASHIER.
 *
 * Gibt es KEIN Gerät, ist das kein Fehler, sondern eine Tatsache: dann hat
 * schlicht niemand die App mit Benachrichtigungen eingerichtet. Der Aufrufer
 * bekommt eine leere Liste und meldet ehrlich `0`, statt so zu tun, als sei
 * etwas hinausgegangen.
 */
export async function staffDeviceTokens(
  tx: SqlExecutor,
): Promise<Array<{ token: string; user_id: string }>> {
  return (await tx.execute(drizzleSql`
    SELECT d.token, d.user_id::text AS user_id
      FROM device_push_tokens d
      JOIN users u ON u.id = d.user_id
     WHERE d.revoked_at IS NULL
       AND u.role IN ('ADMIN', 'CASHIER')`)) as unknown as Array<{
    token: string;
    user_id: string;
  }>;
}

/**
 * Eine Nachricht an mehrere Geräte einreihen. Gibt die Zahl der EINGEREIHTEN
 * Zeilen zurück, nicht die der gesendeten: gesendet wird im worker, und diese
 * Funktion darf über etwas, das sie nicht getan hat, nichts behaupten.
 */
export async function enqueuePush(
  tx: SqlExecutor,
  recipients: Array<{ token: string; user_id: string }>,
  message: PushMessage,
): Promise<number> {
  let queued = 0;
  for (const r of recipients) {
    await tx.execute(drizzleSql`
      INSERT INTO push_outbox (token, user_id, title, body, data)
      VALUES (${r.token}, ${r.user_id}::uuid, ${message.title}, ${message.body},
              ${JSON.stringify(message.data)}::jsonb)`);
    queued += 1;
  }
  return queued;
}
