/**
 * Ist ein SMTP-Fehler VORUEBERGEHEND oder ENDGUELTIG?
 *
 * WARUM DAS ZAEHLT (Basels Befund am 23.07.2026)
 * Der Postausgang gab einen Brief nach fuenf Versuchen als FAILED verloren.
 * Der Fehler war „response=421-4.7.0 Try again later" — das ist Googles
 * Relay, das ausdruecklich sagt „gleich nochmal", ein Ratenlimit. Fuenf
 * Versuche in einer kurzen Staufenster-Minute reichten nicht, und danach war
 * der Brief tot, obwohl er zehn Minuten spaeter anstandslos durchgegangen
 * waere.
 *
 * Ein 421 oder ein Verbindungsabbruch ist NICHT dasselbe wie ein 550
 * „Postfach gibt es nicht". Das eine loest sich von selbst, das andere nie.
 * Sie gleich zu behandeln heisst, entweder eine tote Adresse zwanzigmal
 * anzuklopfen oder einen guten Brief wegen eines Schluckaufs wegzuwerfen.
 *
 * Reines Modul, kein Netz, kein Zustand — damit die Entscheidung ohne SMTP
 * pruefbar bleibt.
 */

export type MailErrorKind = 'transient' | 'permanent';

/**
 * Muster, an denen ein VORUEBERGEHENDER Fehler erkennbar ist:
 * SMTP-4xx (Greylisting, Ratenlimit), Verbindungsstoerungen, Zeitueberschreitung.
 * Alles andere gilt als endgueltig — ein 5xx heilt nicht durch Warten.
 */
const TRANSIENT = [
  // SMTP 4yz sind per RFC 5321 „transient negative" — spaeter erneut versuchen.
  /\b4\d\d[\s-]/,
  /\b4\.\d\.\d\b/,
  // Googles und andere Relays im Klartext.
  /try again/i,
  /temporar(il)?y/i,
  /rate limit|too many|quota|throttl/i,
  /greylist/i,
  // Netz- und Verbindungsfehler des Node-Sockets.
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ESOCKET|EHOSTUNREACH|ENETUNREACH| EAI_AGAIN/i,
  /timed? ?out|timeout/i,
  /connection (closed|terminated|reset|refused|lost)/i,
  /socket|network/i,
]

/**
 * Ein NULL-Empfaenger ist kein SMTP-Fehler, sondern ein defekter Datensatz —
 * endgueltig, sofort. Er darf niemals in die geduldige Wiederholung geraten.
 */
export function classifyMailError(message: string): MailErrorKind {
  const m = message || ''
  if (/recipient decryption returned null/i.test(m)) return 'permanent'
  for (const p of TRANSIENT) {
    if (p.test(m)) return 'transient'
  }
  return 'permanent'
}

/**
 * Wird der Brief nach DIESEM Fehlversuch endgueltig zu FAILED?
 *
 *   • Endgueltiger Fehler → sofort FAILED (einmal reicht, es heilt nicht).
 *   • Voruebergehender Fehler → bleibt PENDING bis zu einer grosszuegigen
 *     Grenze. Der worker taktet die Wiederholung von selbst; ein Ratenlimit
 *     ist bis dahin laengst vorbei.
 *
 * `attempts` ist der Zaehler VOR diesem Versuch.
 */
export function shouldParkAsFailed(
  message: string,
  attempts: number,
  limits: { permanentAfter: number; transientAfter: number },
): boolean {
  const kind = classifyMailError(message)
  const cap = kind === 'permanent' ? limits.permanentAfter : limits.transientAfter
  return attempts + 1 >= cap
}
