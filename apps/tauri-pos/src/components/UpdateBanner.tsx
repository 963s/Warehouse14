/**
 * UpdateBanner — auto-update surface (Day-15 release automation).
 *
 * Polls `tauri-plugin-updater` against the configured GitHub Releases
 * endpoint (see `tauri.conf.json` → `plugins.updater.endpoints`):
 *
 *   • On app boot:    `check()` once after a 5 s grace (let auth probe
 *                     finish first; nobody wants a popup pre-login).
 *   • Hourly:         re-`check()` so a long-running shift picks up
 *                     same-day patches automatically.
 *   • On update:      shows a parchment banner at the top of the
 *                     viewport with "Aktualisieren" + "Später".
 *   • On "Aktualisieren": `download_and_install()` (Tauri 2 streams
 *                     the bundle, verifies the minisign signature against
 *                     the public key in tauri.conf.json, applies it).
 *   • After install:  `process.relaunch()` — the operator sees the new
 *                     version on the next render.
 *
 * Skipped silently when running outside Tauri (Storybook, jsdom tests).
 *
 * Visual: Parchment-2 + Gold left rule. Same vocabulary as Toast/banner
 * patterns in §10. No backdrop, no modal — the operator can still
 * interact with the POS while the banner is up (revenue-critical paths
 * keep working).
 */

import { useCallback, useEffect, useState } from 'react';

import { isRunningInTauri } from '../lib/hardware-client.js';
import { useToastStore } from '../state/toast-store.js';

interface AvailableUpdate {
  version: string;
  date: string | null;
  body: string | null;
  /** Imperative install — calls plugin internally. */
  downloadAndInstall: () => Promise<void>;
}

const POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly
const INITIAL_GRACE_MS = 5_000; // let auth probe finish first

export function UpdateBanner(): JSX.Element | null {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const probe = useCallback(async () => {
    if (!isRunningInTauri()) return;
    try {
      // Dynamic import — the plugin's wire is only available inside Tauri.
      const { check } = await import('@tauri-apps/plugin-updater');
      // check() returns an Update when one is available, else null. The v2
      // Update has NO `.available` field — the old `!result.available` guard
      // was always true, so the banner never appeared. Just null-check.
      const result = await check();
      if (result === null) {
        return;
      }
      setUpdate({
        version: result.version,
        date: result.date ?? null,
        body: result.body ?? null,
        downloadAndInstall: () => result.downloadAndInstall(),
      });
    } catch (err) {
      // Don't surface as toast — silent updater failure is fine when
      // running locally before the endpoint is reachable (e.g. dev mode,
      // or before the operator's machine has internet). Log only.
      // eslint-disable-next-line no-console
      console.warn('updater: check failed', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialId = window.setTimeout(() => {
      if (!cancelled) void probe();
    }, INITIAL_GRACE_MS);
    const intervalId = window.setInterval(() => {
      if (!cancelled) void probe();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, [probe]);

  const install = useCallback(async () => {
    if (!update) return;
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      addToast({
        tone: 'success',
        title: 'Aktualisierung installiert',
        body: 'Die Anwendung wird in wenigen Sekunden neu gestartet.',
      });
      // Give the toast a beat to render, then relaunch.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      window.setTimeout(() => {
        void relaunch();
      }, 1_500);
    } catch (err) {
      setInstalling(false);
      addToast({
        tone: 'alert',
        title: 'Aktualisierung fehlgeschlagen',
        body:
          err instanceof Error
            ? err.message
            : 'Bitte später erneut versuchen oder den Betreiber kontaktieren.',
      });
    }
  }, [addToast, update]);

  if (!update || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1500,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 18px',
        backgroundColor: 'var(--w14-parchment-2)',
        borderLeft: '3px solid var(--w14-gold)',
        borderRadius: 4,
        boxShadow: 'var(--w14-shadow-modal, 0 4px 18px rgba(0,0,0,0.15))',
        fontFamily: 'var(--w14-font-display)',
        maxWidth: 'min(540px, calc(100vw - 24px))',
      }}
    >
      <span aria-hidden style={{ fontSize: '1.05rem', color: 'var(--w14-gold)' }}>
        ✦
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="w14-smallcaps"
          style={{
            letterSpacing: '0.08em',
            fontSize: '0.78rem',
            color: 'var(--w14-ink-aged)',
            fontWeight: 600,
          }}
        >
          Neue Version {update.version} verfügbar
        </div>
        {update.body && (
          <div
            style={{
              fontSize: '0.78rem',
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {update.body.split('\n')[0]}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void install()}
        disabled={installing}
        className="w14-smallcaps"
        style={{
          padding: '5px 12px',
          fontFamily: 'var(--w14-font-display)',
          letterSpacing: '0.08em',
          fontSize: '0.74rem',
          backgroundColor: 'var(--w14-gold)',
          color: 'var(--w14-ink-aged)',
          border: 'none',
          borderRadius: 4,
          cursor: installing ? 'wait' : 'pointer',
          fontWeight: 600,
          opacity: installing ? 0.7 : 1,
        }}
      >
        {installing ? 'Lädt…' : 'Aktualisieren'}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Verbergen"
        className="w14-smallcaps"
        style={{
          padding: '5px 8px',
          background: 'transparent',
          border: 'none',
          color: 'var(--w14-ink-faded)',
          cursor: 'pointer',
          fontSize: '0.74rem',
          letterSpacing: '0.08em',
        }}
      >
        Später
      </button>
    </div>
  );
}
