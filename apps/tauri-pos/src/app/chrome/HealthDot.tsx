/**
 * HealthDot — the connection/sync state distilled to a single dot (no label).
 * Green = everything's fine; it only speaks up when something's wrong: the dot
 * turns wax-red and pulses, and TAPPING it surfaces the exact state + an error
 * code (and, for a real conflict, jumps to the Compliance-Inbox; for an
 * unreachable API, re-checks the connection). Replaces the wordy status badge.
 */

import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';

import { classifyConnectionHealth, useSyncStore } from '../../state/sync-store.js';
import { useToastStore } from '../../state/toast-store.js';

const DOT_KEYFRAMES = `
@keyframes w14DotPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.7); } }
`;

interface DotVisual {
  color: string;
  label: string;
  /** Human German explanation shown to the operator (the raw `code` is demoted). */
  detail: string;
  /** Internal W14- support reference — never the headline; shown muted, for support. */
  code: string;
  pulse: boolean;
  action: 'none' | 'compliance' | 'retry';
}

export function HealthDot(): JSX.Element {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const online = useSyncStore((s) => s.online);
  const syncing = useSyncStore((s) => s.syncing);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const conflictCount = useSyncStore((s) => s.conflictCount);
  const apiReachable = useSyncStore((s) => s.apiReachable);

  const health = classifyConnectionHealth({
    online,
    syncing,
    pendingCount,
    conflictCount,
    apiReachable,
  });

  let v: DotVisual;
  if (health === 'conflict') {
    v = {
      color: 'var(--w14-wax-red)',
      label: 'Sync blockiert — Konflikt',
      detail: 'Ein Offline-Vorgang weicht vom Server ab und wartet im Konfliktpostfach auf Prüfung.',
      code: 'W14-SYNC-CONFLICT',
      pulse: true,
      action: 'compliance',
    };
  } else if (health === 'offline') {
    v = {
      color: 'var(--w14-accent)',
      label: `Offline — ${pendingCount} in Warteschlange`,
      detail: 'Ohne Verbindung. Die Vorgänge werden gesendet, sobald das Netz zurück ist.',
      code: 'W14-NET-OFFLINE',
      pulse: false,
      action: 'none',
    };
  } else if (health === 'unreachable') {
    v = {
      color: 'var(--w14-wax-red)',
      label: 'Server nicht erreichbar',
      detail: 'Der Server antwortet nicht. Bitte die Internetverbindung prüfen; erneut tippen versucht es neu.',
      code: 'W14-API-UNREACHABLE',
      pulse: true,
      action: 'retry',
    };
  } else if (health === 'syncing') {
    v = {
      color: 'var(--w14-gold)',
      label: `Synchronisiert — ${pendingCount}`,
      detail: 'Die Warteschlange wird gerade abgearbeitet.',
      code: 'W14-SYNC',
      pulse: false,
      action: 'none',
    };
  } else {
    v = {
      color: 'var(--w14-verdigris)',
      label: 'Bereit — alles in Ordnung',
      detail: 'Verbindung und Synchronisation laufen.',
      code: 'OK',
      pulse: false,
      action: 'none',
    };
  }

  const onClick = (): void => {
    if (v.action === 'compliance') {
      navigate('/compliance-inbox');
      return;
    }
    if (v.action === 'retry') {
      useSyncStore.setState({ apiReachable: null }); // force a fresh probe
    }
    addToast({
      tone: v.code === 'OK' ? 'success' : 'alert',
      title: v.label,
      // The human explanation leads; the raw W14- code is demoted to a muted
      // support reference at the end (for a support call), never the headline.
      body: v.code === 'OK' ? v.detail : `${v.detail}  ·  Support-Ref. ${v.code}`,
    });
  };

  const btnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    flex: '0 0 auto',
    background: 'transparent',
    border: '1px solid var(--w14-rule)',
    borderRadius: 'var(--w14-radius-button)',
    cursor: 'pointer',
  };

  return (
    <button type="button" onClick={onClick} title={v.label} aria-label={v.label} style={btnStyle}>
      <style>{DOT_KEYFRAMES}</style>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: v.color,
          boxShadow: `0 0 6px -1px ${v.color}`,
          ...(v.pulse ? { animation: 'w14DotPulse 1.4s ease-in-out infinite' } : {}),
        }}
      />
    </button>
  );
}
