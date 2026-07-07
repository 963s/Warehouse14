/**
 * UpdateBanner — Owner Desktop auto-update surface (mirrors the POS).
 *
 * Polls `tauri-plugin-updater` against the GitHub Releases manifest configured
 * in tauri.conf.json (`plugins.updater.endpoints` → `latest-control.json`):
 *
 *   • On boot: check() once after a 5 s grace.
 *   • Hourly:  re-check() so a long-running session picks up patches.
 *   • On update: a gold-ruled banner ("Neue Version … verfügbar") with
 *     "Aktualisieren" + "Später".
 *   • On install: download_and_install() (Tauri verifies the minisign
 *     signature against the embedded pubkey) → relaunch().
 *
 * Self-contained: no toast store, no Tauri-only imports at module load (the
 * plugin wires are dynamically imported so the browser/dev build never breaks).
 * Silent outside Tauri.
 */

import { useCallback, useEffect, useState } from 'react';
import { describeError } from '@warehouse14/i18n-de';

/** Tauri 2 injects this global into the webview; absent in a plain browser. */
function isRunningInTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface AvailableUpdate {
  version: string;
  body: string | null;
  downloadAndInstall: () => Promise<void>;
}

const POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly
const INITIAL_GRACE_MS = 5_000;

export function UpdateBanner(): JSX.Element | null {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    if (!isRunningInTauri()) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const result = await check();
      if (result === null || !result.available) return;
      setUpdate({
        version: result.version,
        body: result.body ?? null,
        downloadAndInstall: () => result.downloadAndInstall(),
      });
    } catch (err) {
      // Silent: before the endpoint is reachable (dev, offline) this is expected.
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
    setError(null);
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      window.setTimeout(() => void relaunch(), 1_200);
    } catch (err) {
      setInstalling(false);
      setError(describeError(err));
    }
  }, [update]);

  if (!update || dismissed) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a polite live-region status banner; <output> is for form results, not a floating app notice.
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
            color: 'var(--w14-ink)',
            fontWeight: 600,
          }}
        >
          Neue Version {update.version} verfügbar
        </div>
        {error ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--w14-wax-red)', marginTop: 2 }}>
            {error}
          </div>
        ) : (
          update.body && (
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
          )
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
          color: 'var(--w14-ink)',
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
