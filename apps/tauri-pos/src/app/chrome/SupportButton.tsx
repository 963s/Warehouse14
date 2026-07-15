/**
 * SupportButton — the header button that summons „Vierzehn", the Warehouse 14
 * voice assistant. A tap opens the dramatic Jarvis overlay; a right-click (or
 * long-press) still copies the support code so an actual problem can be reported.
 *
 * The assistant is read-only: it reads and reports (and can open a dev ticket
 * for Basel), but never runs code or touches the system. The live voice session
 * is wired in JarvisOverlay via `useRealtimeSession`.
 */

import { useCallback, useState } from 'react';

import { IconSupport } from './Icons.js';
import { JarvisOverlay } from './JarvisOverlay.js';

const SUPPORT_CODE = 'W14-963';

export function SupportButton(): JSX.Element {
  const [jarvisOpen, setJarvisOpen] = useState(false);

  const open = useCallback(() => setJarvisOpen(true), []);
  const close = useCallback(() => setJarvisOpen(false), []);
  const copyCode = useCallback(() => {
    void navigator.clipboard
      ?.writeText(`Warehouse14 POS · Support-Code: ${SUPPORT_CODE}`)
      .catch(() => {});
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        onContextMenu={(e) => {
          e.preventDefault();
          copyCode();
        }}
        title="Vierzehn"
        aria-label="Vierzehn, Sprachassistent"
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
          cursor: 'pointer',
        }}
      >
        <IconSupport size={18} />
      </button>
      {jarvisOpen && <JarvisOverlay onClose={close} />}
    </>
  );
}
