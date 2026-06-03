/**
 * AppFooter — a compact marker pinned to the bottom of every screen: live app
 * version + support code + a Support button (copies version+code) + a visible
 * "Updates prüfen" button that runs the updater and SURFACES the result/error
 * (the built-in UpdateBanner check is silent — this makes OTA provable).
 */

import { useEffect, useState } from 'react';

import { isRunningInTauri } from '../../lib/hardware-client.js';
import { useToastStore } from '../../state/toast-store.js';

const SUPPORT_CODE = 'W14-963';

export function AppFooter(): JSX.Element {
  const [version, setVersion] = useState('—');
  const [checking, setChecking] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    let alive = true;
    import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {
        if (alive) setVersion('dev');
      });
    return () => {
      alive = false;
    };
  }, []);

  const copySupport = (): void => {
    void navigator.clipboard
      ?.writeText(`Warehouse14 POS v${version} · Support-Code: ${SUPPORT_CODE}`)
      .catch(() => {});
  };

  const checkUpdates = async (): Promise<void> => {
    if (!isRunningInTauri()) {
      addToast({
        tone: 'alert',
        title: 'Nur in der App',
        body: 'Updates lassen sich nur in der installierten Desktop-App prüfen.',
      });
      return;
    }
    setChecking(true);
    addToast({ tone: 'info', title: 'Suche nach Updates…', body: `Aktuelle Version: v${version}` });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      // check() returns an Update object when one is available, or null. (There
      // is NO `.available` property on the v2 Update — checking it was the bug.)
      const result = await check();
      if (result) {
        addToast({
          tone: 'success',
          title: `Update ${result.version} verfügbar`,
          body: 'Wird heruntergeladen und installiert — die App startet neu.',
        });
        await result.downloadAndInstall();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        window.setTimeout(() => void relaunch(), 1200);
      } else {
        addToast({
          tone: 'success',
          title: 'Sie sind aktuell',
          body: `v${version} ist die neueste Version. (Update-Kanal erreichbar ✓)`,
        });
      }
    } catch (err) {
      // SURFACE the real error instead of swallowing it — this is the whole point.
      addToast({
        tone: 'alert',
        title: 'Update-Prüfung fehlgeschlagen',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setChecking(false);
    }
  };

  const btn: React.CSSProperties = {
    cursor: 'pointer',
    fontSize: '0.66rem',
    padding: '2px 10px',
    color: 'var(--w14-ink)',
    background: 'var(--w14-parchment-3)',
    border: '1px solid var(--w14-rule)',
    borderRadius: 'var(--w14-radius-button)',
  };

  return (
    <footer
      className="w14-smallcaps"
      style={{
        position: 'fixed',
        bottom: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 12px',
        fontSize: '0.66rem',
        letterSpacing: '0.06em',
        color: 'var(--w14-ink-faded)',
        background: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        boxShadow: 'var(--w14-shadow-card)',
      }}
    >
      <span>Warehouse14 POS · v{version}</span>
      <span aria-hidden="true">·</span>
      <span>Support-Code: {SUPPORT_CODE}</span>
      <button
        type="button"
        onClick={() => void checkUpdates()}
        disabled={checking}
        title="Nach Updates suchen"
        className="w14-smallcaps"
        style={{ ...btn, opacity: checking ? 0.6 : 1 }}
      >
        {checking ? 'Prüft…' : '⟳ Updates prüfen'}
      </button>
      <button
        type="button"
        onClick={copySupport}
        title="Version + Support-Code kopieren"
        className="w14-smallcaps"
        style={btn}
      >
        Support
      </button>
    </footer>
  );
}
