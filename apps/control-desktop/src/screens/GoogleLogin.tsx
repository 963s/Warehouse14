/**
 * GoogleLogin — the cold-start sign-in for the governance desktop.
 *
 * Replaces the 4-digit PIN pad. Identity is established EXCLUSIVELY through
 * Google (the staff OAuth client is org-restricted, so only warehouse14.de
 * accounts can authorise; the server also 403s any email that is not a
 * provisioned staff member). The flow uses the server device-handoff: open the
 * system browser, poll `/claim`, feed the returned session — the same
 * `PinLoginResponse` shape — into the existing session store. The 4-digit code
 * becomes a LOCAL device quick-unlock later (track A2), never the auth secret.
 *
 * Mirrors PinLogin's brand chrome (ParchmentCard + Seal + DiamondRule).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { buildStartUrl, claimOnce, generateNonce, openExternal } from '../lib/google-login.js';
import { setSessionToken } from '../lib/session-token.js';
import { useSessionStore } from '../state/session-store.js';

type Phase = 'idle' | 'waiting' | 'error';

const POLL_MS = 1_500;
const TIMEOUT_MS = 3 * 60 * 1_000; // give the operator three minutes to sign in

export function GoogleLogin(): JSX.Element {
  const { client, baseUrl } = useApiClient();
  const setFromLogin = useSessionStore((s) => s.setFromLogin);

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const cancelRef = useRef<boolean>(false);

  // Stop any in-flight poll loop if the screen unmounts.
  useEffect(
    () => () => {
      cancelRef.current = true;
    },
    [],
  );

  const begin = useCallback(async (): Promise<void> => {
    cancelRef.current = false;
    setErrorMsg(null);
    const nonce = generateNonce();
    const url = buildStartUrl(baseUrl, nonce);
    setStartUrl(url);
    setPhase('waiting');
    openExternal(url);

    const deadline = Date.now() + TIMEOUT_MS;
    while (!cancelRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelRef.current) return;
      try {
        const res = await claimOnce(client, nonce);
        if (res) {
          // Store the token for the Bearer-header path (the cross-site cookie is
          // dropped by Windows WebView2) before flipping session state → <App/>.
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
  }, [baseUrl, client, setFromLogin]);

  const cancel = useCallback((): void => {
    cancelRef.current = true;
    setPhase('idle');
    setStartUrl(null);
    setErrorMsg(null);
  }, []);

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
          Verwaltung &amp; Aufsicht
        </p>
        <DiamondRule label="Anmelden" />

        {phase !== 'waiting' && (
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
            <Button variant="primary" size="lg" onClick={() => void begin()}>
              Mit Google anmelden
            </Button>
          </>
        )}

        {phase === 'waiting' && (
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
              <Button
                variant="ghost"
                size="md"
                onClick={() => startUrl && openExternal(startUrl)}
              >
                Browser erneut öffnen
              </Button>
              <Button variant="ghost" size="md" onClick={cancel}>
                Abbrechen
              </Button>
            </div>
          </>
        )}

        {errorMsg && (
          <p
            role="alert"
            style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.92rem' }}
          >
            {errorMsg}
          </p>
        )}

        <DiamondRule />
        <p
          style={{
            fontSize: '0.78rem',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            margin: 0,
          }}
        >
          Antiquitäten · Briefmarken · Münzen
        </p>
      </ParchmentCard>
    </div>
  );
}
