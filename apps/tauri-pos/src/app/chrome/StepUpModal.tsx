/**
 * StepUpModal — die Nachbestätigung vor einer empfindlichen Handlung.
 *
 * SIE VERLANGT DEN GERÄTECODE, also GENAU dieselbe Bildschirmsperre, die die
 * Person am Tresen beim Öffnen der App eingibt. Keine zweite Zahl, kein
 * zweites Schloss.
 *
 * WARUM SIE UMGEBAUT WURDE (Basels Befund, 23.07.2026)
 * Die vierstellige Kassen-PIN ist am 21.07. abgeschafft worden — die Anmeldung
 * ist Google, das Gerät hat seinen eigenen Sperrcode. Trotzdem fragte dieser
 * Dialog weiter nach der abgeschafften Zahl, bei jedem DATEV-Export, jedem
 * Storno, jedem Z-Bon, jeder Löschung. Man wurde nach etwas gefragt, das es
 * nicht mehr geben soll, und ein neu angelegter Mitarbeiter ohne alten
 * PIN-Abdruck hätte diese Handlungen NIE ausführen können.
 *
 * WO GEPRÜFT WIRD
 * Der Code wird HIER geprüft, mit `verifyLocalPin` — derselben Funktion wie am
 * Sperrschirm, also mit PBKDF2, eskalierender Sperre und Löschung nach zehn
 * Fehlversuchen. Er verlässt das Gerät nicht. Erst nach bestandener Prüfung
 * meldet `stepUpDevice` dem Server, dass bestätigt wurde, damit er sein
 * Zehn-Minuten-Fenster stempelt.
 *
 * Ist auf diesem Gerät noch gar kein Code gesetzt, sagt der Dialog das und
 * schickt zum Sperrschirm, statt eine Bestätigung vorzutäuschen.
 *
 * Esc oder ein Klick daneben bricht ab; der ursprüngliche Aufruf bekommt dann
 * seinen `STEP_UP_REQUIRED` zurück und die Fläche meldet „abgebrochen".
 */

import { useEffect, useMemo, useState } from 'react';

import { ApiError, authPin } from '@warehouse14/api-client';
import { describeError } from '@warehouse14/i18n-de';
import { Dialog, DiamondRule, PinPad, RomanIndex, Seal } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import {
  WIPE_AFTER,
  clearAttempts,
  hasLocalPin,
  readAttempts,
  recordFailedAttempt,
  verifyLocalPin,
} from '../../lib/local-lock.js';
import { useSessionStore } from '../../state/session-store.js';
import { useStepUpStore } from '../../state/step-up-store.js';

export function StepUpModal(): JSX.Element | null {
  const active = useStepUpStore((s) => s.active);
  const complete = useStepUpStore((s) => s.complete);
  const cancel = useStepUpStore((s) => s.cancel);

  const api = useApiClient();
  const recordStepUp = useSessionStore((s) => s.recordStepUp);

  const [pin, setPin] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  /** Ob auf DIESEM Gerät überhaupt ein Sperrcode gesetzt ist. */
  const [codeGesetzt, setCodeGesetzt] = useState<boolean>(true);

  // Beim Öffnen: den ECHTEN Stand vom Gerät lesen, nicht bei null anfangen.
  // Wer schon dreimal danebengelegen hat, darf das nicht durch Schliessen und
  // erneutes Öffnen des Dialogs zurücksetzen — der Zähler liegt dauerhaft im
  // Gerät, und genau darauf beruht der Schutz.
  useEffect(() => {
    if (!active) return;
    setPin('');
    setErrorMsg(null);
    setCodeGesetzt(hasLocalPin());
    const a = readAttempts();
    setFailedAttempts(a.fails);
    setLockedUntilIso(a.lockedUntil > Date.now() ? new Date(a.lockedUntil).toISOString() : null);
  }, [active]);

  // Lockout countdown tick.
  useEffect(() => {
    if (!lockedUntilIso) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [lockedUntilIso]);

  const lockoutSecondsLeft = useMemo(() => {
    if (!lockedUntilIso) return 0;
    return Math.max(0, Math.ceil((new Date(lockedUntilIso).getTime() - now) / 1_000));
  }, [lockedUntilIso, now]);
  const locked = lockoutSecondsLeft > 0;
  useEffect(() => {
    if (lockedUntilIso && lockoutSecondsLeft === 0) {
      setLockedUntilIso(null);
      setErrorMsg(null);
    }
  }, [lockedUntilIso, lockoutSecondsLeft]);

  // Esc + backdrop cancel are now handled by the shared <Dialog/> core.

  async function handleSubmit(): Promise<void> {
    if (locked || submitting || pin.length !== 4) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      // ERST lokal prüfen. Der Code geht nicht ans Netz.
      const stimmt = await verifyLocalPin(pin);
      if (!stimmt) {
        const f = recordFailedAttempt();
        setFailedAttempts(f.fails);
        if (f.wiped) {
          // Zehn Fehlversuche: der Gerätecode ist jetzt gelöscht. Das muss
          // deutlich dastehen, sonst rätselt die Person, warum plötzlich
          // nichts mehr geht.
          setCodeGesetzt(false);
          setErrorMsg(
            `Nach ${WIPE_AFTER} Fehlversuchen wurde der Gerätecode gelöscht. ` +
              'Bitte über den Sperrschirm einen neuen setzen.',
          );
        } else {
          setLockedUntilIso(
            f.lockedUntil > Date.now() ? new Date(f.lockedUntil).toISOString() : null,
          );
          setErrorMsg('Falscher Gerätecode.');
        }
        setPin('');
        return;
      }

      // Bestanden: den Zähler zurücksetzen und dem Server das Fenster stempeln
      // lassen. Erst wenn DAS gelingt, gilt die Bestätigung — sonst liefe der
      // wiederholte Aufruf gleich wieder in dieselbe Nachfrage.
      clearAttempts();
      setFailedAttempts(0);
      const res = await authPin.stepUpDevice(api);
      recordStepUp(res.lastPinStepUpAt);
      complete();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(describeError(err));
      } else {
        setErrorMsg('Verbindung gestört. Netzwerk prüfen.');
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  const lockoutLabel = useMemo(() => {
    if (!locked) return null;
    const m = Math.floor(lockoutSecondsLeft / 60);
    const s = lockoutSecondsLeft % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [locked, lockoutSecondsLeft]);

  return (
    <Dialog open={active} onClose={cancel} ariaLabel="Bestätigung mit dem Gerätecode" size="sm" showClose={false}>
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Seal size="md" tone="gold" label="🔒" />
        </div>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            margin: '14px 0 2px',
          }}
        >
          Gerätecode bestätigen
        </h2>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.92rem',
          }}
        >
          {codeGesetzt
            ? 'Derselbe Code wie beim Entsperren der Kasse.'
            : 'Auf diesem Gerät ist noch kein Code gesetzt. Bitte die Kasse einmal sperren und einen setzen.'}
        </p>
        <DiamondRule />

        <PinPad
          value={pin}
          onChange={setPin}
          onSubmit={() => void handleSubmit()}
          disabled={locked || submitting}
          bindKeyboard
        />

        {errorMsg && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontSize: '0.92rem',
            }}
          >
            {errorMsg}
          </p>
        )}

        {failedAttempts > 0 && !locked && (
          <p style={{ margin: '12px 0 0', color: 'var(--w14-wax-red-soft)' }}>
            <RomanIndex value={failedAttempts} variant="lower" tone="wax-red" />
            &nbsp;
            <span style={{ fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
              Fehlversuch{failedAttempts === 1 ? '' : 'e'}
            </span>
          </p>
        )}

        {locked && lockoutLabel && (
          <p
            style={{
              color: 'var(--w14-wax-red)',
              margin: '12px 0 0',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '1.1rem',
            }}
          >
            ⌛ {lockoutLabel}
          </p>
        )}

        <button
          type="button"
          onClick={cancel}
          style={{
            marginTop: 16,
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Abbrechen (Esc)
        </button>
      </div>
    </Dialog>
  );
}
