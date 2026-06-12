/**
 * UpdateButton — the chasing-arrows ↻ in the header. Runs the OTA updater and
 * SURFACES the result/error as a toast (the built-in check is silent — this
 * makes "bin ich aktuell?" provable). Spins while checking. Moved out of the
 * old floating footer, which is gone.
 */

import { useState } from 'react';

import { isRunningInTauri } from '../../lib/hardware-client.js';
import { useToastStore } from '../../state/toast-store.js';
import { IconRefresh } from './Icons.js';

const SPIN_KEYFRAMES = `@keyframes w14Spin { to { transform: rotate(360deg); } }`;

export function UpdateButton(): JSX.Element {
  const [checking, setChecking] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

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
    let version = '—';
    try {
      const appMod = await import('@tauri-apps/api/app');
      version = await appMod.getVersion();
    } catch {
      /* ignore */
    }
    addToast({ tone: 'info', title: 'Suche nach Updates…', body: `Aktuelle Version: v${version}` });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
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
      addToast({
        tone: 'alert',
        title: 'Update-Prüfung fehlgeschlagen',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void checkUpdates()}
      disabled={checking}
      title="Nach Updates suchen"
      aria-label="Nach Updates suchen"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        flex: '0 0 auto',
        color: 'var(--w14-ink-faded)',
        background: 'transparent',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: checking ? 'default' : 'pointer',
        opacity: checking ? 0.65 : 1,
      }}
    >
      <style>{SPIN_KEYFRAMES}</style>
      <span style={{ display: 'inline-flex', ...(checking ? { animation: 'w14Spin 0.9s linear infinite' } : {}) }}>
        <IconRefresh size={18} />
      </span>
    </button>
  );
}
