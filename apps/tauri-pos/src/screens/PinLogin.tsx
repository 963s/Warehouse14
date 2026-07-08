/**
 * PinLogin — first screen on cold start when no session is alive.
 *
 * Corrected 2026-05-26 (memory.md #76) to match the real server contract:
 * `POST /api/auth/pin-login` with `{ pin }` only. mTLS resolves the user
 * via the device cert; the operator never types an email.
 *
 * Error handling maps the stable `ApiError.code` enum to brand-themed
 * messages (memory.md §10.6 voice). `PIN_LOCKED` carries a `lockedUntil`
 * ISO timestamp in `details`, parsed once and used to drive a live
 * countdown.
 *
 * Visual: Seal + wordmark + italic motto + PinPad + retry counter
 * (Roman numerals in wax-red as wax-seal failure marks).
 */

import { useEffect, useMemo, useState } from 'react';

import { ApiError, authPin } from '@warehouse14/api-client';
import { DiamondRule, ParchmentCard, PinPad, RomanIndex } from '@warehouse14/ui-kit';

import { ThemeToggle } from '../app/chrome/ThemeToggle.js';
import { useApiClient } from '../lib/api-context.js';
import { setSessionToken } from '../lib/session-token.js';
import { useSessionStore } from '../state/session-store.js';
import { describeError } from '@warehouse14/i18n-de';

export function PinLogin(): JSX.Element {
  const api = useApiClient();
  const setFromLogin = useSessionStore((s) => s.setFromLogin);

  const [pin, setPin] = useState<string>('');
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Re-render once a second while locked so the countdown ticks.
  useEffect(() => {
    if (!lockedUntilIso) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [lockedUntilIso]);

  const lockoutSecondsLeft = useMemo(() => {
    if (!lockedUntilIso) return 0;
    const target = new Date(lockedUntilIso).getTime();
    return Math.max(0, Math.ceil((target - now) / 1_000));
  }, [lockedUntilIso, now]);

  const locked = lockoutSecondsLeft > 0;

  // Clear the lockout silently once the countdown finishes.
  useEffect(() => {
    if (lockedUntilIso && lockoutSecondsLeft === 0) {
      setLockedUntilIso(null);
      setErrorMsg(null);
    }
  }, [lockedUntilIso, lockoutSecondsLeft]);

  async function handleSubmit(): Promise<void> {
    if (locked || submitting || pin.length !== 4) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await authPin.loginSafe(api, { pin });
      // Store the token for the Bearer-header auth path (Windows WebView2 drops
      // the cross-site session cookie) before flipping the session state.
      setSessionToken(res.token);
      setFromLogin(res);
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'UNAUTHORIZED':
            setFailedAttempts((n) => n + 1);
            setErrorMsg('Falsche PIN.');
            break;
          case 'PIN_LOCKED':
            {
              const details = err.details as { lockedUntil?: string } | undefined;
              if (details?.lockedUntil) setLockedUntilIso(details.lockedUntil);
              setErrorMsg('Konto gesperrt. Bitte Geduld.');
            }
            break;
          case 'DEVICE_NOT_AUTHORIZED':
            setErrorMsg('Dieses Gerät ist nicht autorisiert.');
            break;
          case 'RATE_LIMITED':
            setErrorMsg('Zu viele Versuche, kurz innehalten.');
            break;
          default:
            setErrorMsg(describeError(err));
        }
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
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--w14-parchment)',
      }}
      className="w14-paper-noise"
    >
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }}>
        <ThemeToggle />
      </div>
      <ParchmentCard padding="lg" style={{ width: 'min(440px, 100%)', textAlign: 'center' }}>
        <img
          src="/shop-logo.svg"
          alt="WAREHOUSE 14"
          style={{
            width: 300,
            maxWidth: '100%',
            height: 'auto',
            margin: '0 auto 10px',
            display: 'block',
          }}
        />
        <p
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            margin: 0,
            color: 'var(--w14-ink-faded)',
          }}
        >
          Was lange ruht, spricht leise.
        </p>
        <DiamondRule label="Anmelden" />

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
              margin: '14px 0 0',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '1.2rem',
            }}
          >
            ⌛ {lockoutLabel}
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
