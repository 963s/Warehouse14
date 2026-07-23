/**
 * fcm-transport — der direkte Draht zu Googles Zustelldienst (FCM v1).
 *
 * WARUM DIREKT UND NICHT ÜBER EXPO
 * Der Ausgang sprach bisher mit `exp.host`. Das ist bequem, hat aber einen
 * Haken, der genau hier zählt: Expo kann eine Android-Nachricht nur ausliefern,
 * wenn IHM die Firebase-Zugangsdaten des Ladens hinterlegt sind — und das
 * Hinterlegen geht nur von Hand über eine Frage-und-Antwort-Sitzung. Solange
 * das nicht geschehen ist, nimmt Expo die Nachricht an, bestätigt sie, und
 * niemand bekommt einen Ton. Ein bestätigter Beleg für eine Nachricht, die nie
 * ankommt, ist genau die Sorte Lüge, die dieses System nicht führen darf.
 *
 * Der direkte Weg braucht nur einen Dienstkonto-Schlüssel in der Umgebung des
 * Servers. Damit gehört die Zustellung dem Laden selbst, ohne einen Dritten
 * dazwischen, der die halbe Wahrheit meldet.
 *
 * KEIN ERFUNDENER ERFOLG
 * Fehlt der Schlüssel, meldet dieses Modul das offen (`configured: false`).
 * Es tut NICHT so, als sei etwas hinausgegangen. Der Ausgang lässt die Zeilen
 * dann unangetastet stehen, statt sie mit Fehlversuchen zu verbrennen, die
 * niemandes Schuld sind.
 *
 * Ohne fremdes Paket: die Anmeldung ist ein selbst signiertes JWT, das Google
 * gegen eine kurzlebige Zugriffsmarke tauscht. Das ist ein Dutzend Zeilen
 * `node:crypto` gegen eine weitere Abhängigkeit im Betrieb.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Was Google für einen Dienstkonto-Schlüssel ausgibt. Nur die Felder, die zählen. */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export type FcmResult =
  | { ok: true }
  /**
   * `unregistered` heisst: DIESE Marke ist tot (App entfernt, Daten gelöscht,
   * Marke erneuert). Sie gehört widerrufen, sonst scheitert sie in jedem
   * künftigen Lauf erneut und verdeckt die echten Störungen.
   */
  | { ok: false; reason: string; unregistered: boolean };

let geladen: ServiceAccount | null | undefined;

/**
 * Den Schlüssel aus der Umgebung holen — entweder als Pfad zu einer Datei
 * (`FCM_SERVICE_ACCOUNT_FILE`) oder als Inhalt (`FCM_SERVICE_ACCOUNT_JSON`).
 * Beides ist üblich; der Pfad ist im Docker-Betrieb sauberer, weil ein
 * mehrzeiliger privater Schlüssel in einer `.env` schnell zerbricht.
 *
 * `undefined` heisst „noch nicht nachgesehen", `null` heisst „nachgesehen und
 * nicht da". Der Unterschied verhindert, dass bei jedem Lauf erneut eine Datei
 * gesucht wird, die es nicht gibt.
 */
function serviceAccount(): ServiceAccount | null {
  if (geladen !== undefined) return geladen;
  const datei = process.env.FCM_SERVICE_ACCOUNT_FILE;
  const roh = process.env.FCM_SERVICE_ACCOUNT_JSON;
  try {
    const text = datei ? readFileSync(datei, 'utf8') : roh;
    if (!text) {
      geladen = null;
      return null;
    }
    const k = JSON.parse(text) as ServiceAccount;
    if (!k.project_id || !k.client_email || !k.private_key) {
      geladen = null;
      return null;
    }
    geladen = k;
    return k;
  } catch {
    // Ein unlesbarer Schlüssel ist dasselbe wie kein Schlüssel: nicht
    // konfiguriert. Er darf den Ausgang nicht zum Absturz bringen.
    geladen = null;
    return null;
  }
}

/** Ist die Zustellung überhaupt eingerichtet? Der Ausgang fragt das ZUERST. */
export function fcmConfigured(): boolean {
  return serviceAccount() !== null;
}

/** Das Projekt, in das zugestellt wird — nur zur ehrlichen Protokollzeile. */
export function fcmProjectId(): string | null {
  return serviceAccount()?.project_id ?? null;
}

/**
 * Die Zugriffsmarke lebt eine Stunde. Sie wird zwischengespeichert und eine
 * Minute vor Ablauf erneuert: eine Marke, die zwischen Prüfung und Aufruf
 * verfällt, erzeugt einen 401, der wie eine echte Störung aussieht.
 */
let marke: { wert: string; laeuftAbUm: number } | null = null;

async function accessToken(signal?: AbortSignal | null): Promise<string> {
  const k = serviceAccount();
  if (!k) throw new Error('Kein Dienstkonto-Schlüssel hinterlegt');
  const jetzt = Math.floor(Date.now() / 1000);
  if (marke && marke.laeuftAbUm > jetzt + 60) return marke.wert;

  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const kopf = b64({ alg: 'RS256', typ: 'JWT' });
  const anspruch = b64({
    iss: k.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: jetzt,
    exp: jetzt + 3600,
  });
  const signer = createSign('RSA-SHA256');
  signer.update(`${kopf}.${anspruch}`);
  const signatur = signer.sign(k.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${kopf}.${anspruch}.${signatur}`,
    }),
    ...(signal ? { signal } : {}),
  });
  const d = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!d.access_token) {
    throw new Error(`Anmeldung bei Google scheiterte: ${d.error ?? res.status}`);
  }
  marke = { wert: d.access_token, laeuftAbUm: jetzt + (d.expires_in ?? 3600) };
  return d.access_token;
}

/**
 * Eine Nachricht an EIN Gerät.
 *
 * FCM v1 kennt keinen Stapelversand mehr — der alte `send:batch` ist seit 2024
 * abgeschaltet. Ein Aufruf je Nachricht ist also nicht Nachlässigkeit, sondern
 * die einzige Form, die es noch gibt.
 *
 * `channelId` muss zu dem Kanal passen, den die App beim Start anlegt, sonst
 * zeigt Android die Nachricht stumm und ohne Rang.
 */
export async function fcmSend(
  args: {
    token: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    channelId?: string;
  },
  signal?: AbortSignal | null,
): Promise<FcmResult> {
  const k = serviceAccount();
  if (!k) return { ok: false, reason: 'Die Zustellung ist nicht eingerichtet', unregistered: false };

  let at: string;
  try {
    at = await accessToken(signal);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      unregistered: false,
    };
  }

  // FCM nimmt nur Zeichenketten im Datenteil. Alles andere wird höflich
  // umgewandelt, statt den Aufruf mit einem 400 sterben zu lassen.
  const daten: Record<string, string> = {};
  for (const [feld, wert] of Object.entries(args.data ?? {})) {
    daten[feld] = typeof wert === 'string' ? wert : JSON.stringify(wert);
  }

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${k.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: args.token,
        notification: { title: args.title, body: args.body },
        data: daten,
        android: {
          priority: 'HIGH',
          notification: {
            channel_id: args.channelId ?? 'bestellungen',
            default_sound: true,
          },
        },
      },
    }),
    ...(signal ? { signal } : {}),
  });

  if (res.ok) return { ok: true };

  const d = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
  };
  const status = d.error?.status ?? String(res.status);
  const code = d.error?.details?.find((x) => x.errorCode)?.errorCode;
  // UNREGISTERED: die App ist weg. Ein 404 heisst dasselbe. Eine ungültige
  // Marke (INVALID_ARGUMENT auf dem Feld `token`) ist ebenfalls endgültig —
  // sie wird durch Warten nicht gültig.
  const unregistered =
    code === 'UNREGISTERED' ||
    res.status === 404 ||
    (status === 'INVALID_ARGUMENT' && /registration token/i.test(d.error?.message ?? ''));

  return {
    ok: false,
    reason: `${status}: ${d.error?.message ?? 'ohne Begründung'}`,
    unregistered,
  };
}
