/**
 * AppFooter — a compact marker pinned to the bottom of every screen showing
 * the live app version + a support code + a Support button (copies version +
 * code to the clipboard for support tickets). Doubles as the OTA "did the
 * update land?" tell.
 */

import { useEffect, useState } from 'react';

const SUPPORT_CODE = 'W14-963';

export function AppFooter(): JSX.Element {
  const [version, setVersion] = useState('—');

  useEffect(() => {
    let alive = true;
    // Real version baked into the Tauri binary (falls back gracefully in a
    // plain browser/dev webview where the Tauri API isn't present).
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
        onClick={copySupport}
        title="Version + Support-Code kopieren"
        className="w14-smallcaps"
        style={{
          cursor: 'pointer',
          fontSize: '0.66rem',
          padding: '2px 10px',
          color: 'var(--w14-ink)',
          background: 'var(--w14-parchment-3)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-button)',
        }}
      >
        Support
      </button>
    </footer>
  );
}
