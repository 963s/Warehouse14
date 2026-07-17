/**
 * GoogleLogin — the primary cold-start sign-in (Track A1).
 *
 * Identity is established through Google (the staff OAuth client is
 * org-restricted; the server also 403s any email that is not a provisioned
 * staff member).
 *
 * Primary flow — IN-APP window: "Mit Google anmelden" opens the Google account
 * picker as a window INSIDE the app (Rust `start_google_login`). The server
 * callback redirects to a loopback the window intercepts, handing the session
 * token straight back — no external browser, no polling. We then fetch the
 * actor + profile with that token and we are in.
 *
 * Fallback — SYSTEM browser: if the in-app window ever fails (some Google
 * accounts refuse an embedded webview), "Im Browser anmelden" runs the older
 * device-handoff flow (open the OS browser, poll `/claim`). Kept so a sign-in
 * is always possible.
 *
 * PIN sign-in stays available via "Mit PIN anmelden" for the second admin who
 * cannot use the org-restricted Google.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { authPin } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { API_BASE_URL } from '../lib/api-base.js';
import { useApiClient } from '../lib/api-context.js';
import {
  buildStartUrl,
  claimOnce,
  generateNonce,
  openExternal,
  signInWithGoogleWindow,
} from '../lib/google-login.js';
import { setSessionToken } from '../lib/session-token.js';
import { useSessionStore } from '../state/session-store.js';

type Phase = 'idle' | 'window' | 'browser' | 'error';

const POLL_MS = 1_500;
const TIMEOUT_MS = 3 * 60 * 1_000; // three minutes to sign in

function messageForError(code: string | null): string {
  if (code === 'FORBIDDEN') return 'Dieses Konto ist nicht freigeschaltet.';
  return 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.';
}

/** The official four-colour Google „G", on a white tile so it reads on the dark
 *  ink button (Google brand guidance: the mark always sits on white). */
function GoogleGlyph({ size = 22 }: { size?: number }): JSX.Element {
  const inner = Math.round(size * 0.66);
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 5,
        background: '#fff',
        flex: '0 0 auto',
        boxShadow: '0 1px 1px rgba(0,0,0,0.18)',
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 48 48">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    </span>
  );
}

export function GoogleLogin({ onUsePin }: { onUsePin?: () => void }): JSX.Element {
  const client = useApiClient();
  const setFromLogin = useSessionStore((s) => s.setFromLogin);
  const setFromProbe = useSessionStore((s) => s.setFromProbe);

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const cancelRef = useRef<boolean>(false);

  useEffect(
    () => () => {
      cancelRef.current = true;
    },
    [],
  );

  // PRIMARY — in-app Google window (no external browser, no polling).
  const begin = useCallback(async (): Promise<void> => {
    setErrorMsg(null);
    setPhase('window');
    try {
      const res = await signInWithGoogleWindow(API_BASE_URL);
      if (res.ok) {
        setSessionToken(res.token);
        // The loopback carries only the token; fetch actor + profile with it.
        const session = await authPin.sessionSafe(client);
        setFromProbe(session);
        return; // authenticated → App.tsx swaps to the shell
      }
      if (res.error === null) {
        setPhase('idle'); // operator closed the sign-in window
        return;
      }
      setPhase('error');
      setErrorMsg(messageForError(res.error));
    } catch {
      setPhase('error');
      setErrorMsg('Anmeldung fehlgeschlagen. Bitte erneut versuchen.');
    }
  }, [client, setFromProbe]);

  // FALLBACK — system browser + device handoff.
  const beginBrowser = useCallback(async (): Promise<void> => {
    cancelRef.current = false;
    setErrorMsg(null);
    const nonce = generateNonce();
    const url = buildStartUrl(API_BASE_URL, nonce);
    setStartUrl(url);
    setPhase('browser');
    openExternal(url);

    const deadline = Date.now() + TIMEOUT_MS;
    while (!cancelRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelRef.current) return;
      try {
        const res = await claimOnce(client, nonce);
        if (res) {
          setSessionToken(res.token);
          setFromLogin(res);
          return;
        }
      } catch {
        // Transient network hiccup while polling — keep trying until the deadline.
      }
    }
    if (!cancelRef.current) {
      setPhase('error');
      setErrorMsg('Zeit abgelaufen. Bitte erneut anmelden.');
    }
  }, [client, setFromLogin]);

  const cancel = useCallback((): void => {
    cancelRef.current = true;
    setPhase('idle');
    setStartUrl(null);
    setErrorMsg(null);
  }, []);

  const idle = phase === 'idle' || phase === 'error';

  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--w14-parchment)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(440px, 100%)', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Seal size="lg" tone="gold" />
        </div>
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            letterSpacing: '0.12em',
            fontSize: '1.5rem',
            margin: '14px 0 2px',
          }}
        >
          WAREHOUSE 14
        </h1>
        <p
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            margin: 0,
            color: 'var(--w14-ink-faded)',
          }}
        >
          Handelshaus &amp; Kasse
        </p>
        <DiamondRule label="Anmelden" />

        {idle && (
          <>
            <p
              style={{
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                lineHeight: 1.5,
                margin: '0 0 18px',
              }}
            >
              Melden Sie sich mit Ihrem Warehouse14&#8209;Google&#8209;Konto an. Nur freigeschaltete
              Konten erhalten Zugang.
            </p>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              iconLeft={<GoogleGlyph />}
              onClick={() => void begin()}
              style={{ gap: 12 }}
            >
              Mit Google anmelden
            </Button>
          </>
        )}

        {phase === 'window' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <GoogleGlyph size={30} />
            <p
              style={{
                color: 'var(--w14-ink)',
                fontFamily: 'var(--w14-font-display)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Bitte wählen Sie Ihr Google&#8209;Konto im Anmeldefenster. Schließen Sie das Fenster,
              um abzubrechen.
            </p>
          </div>
        )}

        {phase === 'browser' && (
          <>
            <p
              style={{
                color: 'var(--w14-ink)',
                fontFamily: 'var(--w14-font-display)',
                lineHeight: 1.5,
                margin: '0 0 6px',
              }}
            >
              Anmeldung im Browser läuft…
            </p>
            <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.9rem', margin: '0 0 18px' }}>
              Schließen Sie das Browser&#8209;Fenster nach der Anmeldung. Das Programm öffnet sich
              dann automatisch.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button variant="ghost" size="md" onClick={() => startUrl && openExternal(startUrl)}>
                Browser erneut öffnen
              </Button>
              <Button variant="ghost" size="md" onClick={cancel}>
                Abbrechen
              </Button>
            </div>
          </>
        )}

        {errorMsg && (
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.92rem' }}>
            {errorMsg}
          </p>
        )}

        {idle && (
          <>
            <DiamondRule />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => void beginBrowser()}
                style={linkBtn}
              >
                Stattdessen im Browser anmelden
              </button>
              {onUsePin && (
                <button type="button" onClick={onUsePin} style={linkBtn}>
                  Mit PIN anmelden
                </button>
              )}
            </div>
          </>
        )}
      </ParchmentCard>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--w14-ink-faded)',
  fontFamily: 'var(--w14-font-display)',
  fontStyle: 'italic',
  cursor: 'pointer',
  fontSize: '0.85rem',
};
