/**
 * Toast — brand-themed dismissable notification.
 *
 * Three tones (memory.md §10.2 + #76):
 *   • info      → ink rule on parchment-2 (default)
 *   • success   → gold rule, gold seal icon
 *   • alert     → wax-red rule, persistent until manual dismiss
 *
 * Never used directly — the consumer calls `useToast().addToast(...)` and the
 * `<ToastContainer/>` renders the active list. This file just exports the
 * presentational atom.
 */

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'alert';

export interface ToastShape {
  id: string;
  tone: ToastTone;
  title: string;
  body?: ReactNode;
  /** Milliseconds before auto-dismiss. `null` = sticky (alerts default to sticky). */
  autoDismissMs: number | null;
}

const TONE_BORDER: Record<ToastTone, string> = {
  info: 'var(--w14-rule)',
  success: 'var(--w14-verdigris)',
  alert: 'var(--w14-wax-red)',
};

const TONE_GLYPH: Record<ToastTone, string> = {
  info: '◆',
  success: '◉', // a stamped seal
  alert: '✕',
};

const TONE_COLOR: Record<ToastTone, string> = {
  info: 'var(--w14-ink-aged)',
  success: 'var(--w14-verdigris)',
  alert: 'var(--w14-wax-red)',
};

export interface ToastProps {
  toast: ToastShape;
  onDismiss: () => void;
  onClick?: () => void;
}

export function Toast({ toast, onDismiss, onClick }: ToastProps): JSX.Element {
  const style: CSSProperties = {
    minWidth: 280,
    maxWidth: 380,
    backgroundColor: 'var(--w14-parchment-2)',
    color: 'var(--w14-ink)',
    border: `1px solid ${TONE_BORDER[toast.tone]}`,
    borderLeftWidth: 4,
    borderRadius: 'var(--w14-radius-card)',
    boxShadow: 'var(--w14-shadow-modal)',
    padding: '12px 14px 12px 16px',
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    columnGap: 12,
    cursor: onClick ? 'pointer' : 'default',
  };

  const handleKeyDown = onClick
    ? (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }
    : undefined;

  return (
    <div
      role={toast.tone === 'alert' ? 'alert' : 'status'}
      aria-live={toast.tone === 'alert' ? 'assertive' : 'polite'}
      style={style}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : undefined}
    >
      <span
        aria-hidden
        style={{
          fontFamily: 'var(--w14-font-display)',
          color: TONE_COLOR[toast.tone],
          fontSize: '1.2rem',
          lineHeight: 1,
        }}
      >
        {TONE_GLYPH[toast.tone]}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '0.96rem',
            color: 'var(--w14-ink)',
          }}
        >
          {toast.title}
        </span>
        {toast.body !== undefined && (
          <span
            style={{
              fontSize: '0.82rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {toast.body}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Schließen"
        onClick={(ev) => {
          ev.stopPropagation();
          onDismiss();
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--w14-ink-faded)',
          padding: 4,
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.9rem',
        }}
      >
        ×
      </button>
    </div>
  );
}
