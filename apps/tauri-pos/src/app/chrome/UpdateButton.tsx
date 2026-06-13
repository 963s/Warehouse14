/**
 * UpdateButton — the single ↻ trigger in the header right-cluster.
 *
 * No longer auto-installs on a plain check (that was the old, alarming
 * behaviour). It now just OPENS <UpdateCenter/>, the one update surface, and
 * carries a subtle gold cue when `useAppUpdate` knows an update is waiting
 * (status 'available' or 'ready'). All lifecycle logic lives in the hook +
 * the center; this is a pure trigger.
 *
 * The <UpdateCenter/> modal is mounted here, co-located with its trigger, so
 * the open-state lives next to the button without a separate store. The hook's
 * state is a module-level singleton, so the badge and the modal always agree.
 */

import { useState } from 'react';

import { useAppUpdate } from '../../hooks/useAppUpdate.js';
import { IconRefresh } from './Icons.js';
import { UpdateCenter } from './UpdateCenter.js';

const SPIN_KEYFRAMES = '@keyframes w14Spin { to { transform: rotate(360deg); } }';

export function UpdateButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const { status, hasUpdate } = useAppUpdate();
  const spinning = status === 'checking' || status === 'downloading';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={hasUpdate ? 'Update verfügbar' : 'Nach Updates suchen'}
        aria-label={hasUpdate ? 'Update verfügbar — Aktualisierungen öffnen' : 'Nach Updates suchen'}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          flex: '0 0 auto',
          color: hasUpdate ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          background: 'transparent',
          border: `1px solid ${hasUpdate ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
          boxShadow: hasUpdate ? '0 0 0 2px var(--w14-gold-faint, rgba(176,141,87,0.18))' : 'none',
        }}
      >
        <style>{SPIN_KEYFRAMES}</style>
        <span
          style={{
            display: 'inline-flex',
            ...(spinning ? { animation: 'w14Spin 0.9s linear infinite' } : {}),
          }}
        >
          <IconRefresh size={18} />
        </span>
        {hasUpdate && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--w14-gold)',
              boxShadow: '0 0 0 1.5px var(--w14-parchment-2)',
            }}
          />
        )}
      </button>
      <UpdateCenter open={open} onClose={() => setOpen(false)} />
    </>
  );
}
