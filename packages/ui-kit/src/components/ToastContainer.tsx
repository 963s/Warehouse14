/**
 * ToastContainer — the brand top-right toast portal + queue.
 *
 * Owns the queue's lifecycle:
 *   • renders each active toast as <Toast/>
 *   • auto-dismisses non-sticky toasts after their `autoDismissMs`
 *   • allows manual dismiss + onClick navigation
 *
 * Consumed via the `useToast()` hook (separate file). Mounted once at the
 * AppShell level — never duplicate in a screen.
 */

import { useEffect, useMemo, type CSSProperties } from 'react';

import { Toast, type ToastShape } from './Toast.js';

export interface ToastContainerProps {
  toasts: readonly ToastShape[];
  onDismiss: (id: string) => void;
  /** Optional per-toast click handler (e.g. navigate to the related screen). */
  onActivate?: (id: string) => void;
}

export function ToastContainer({
  toasts,
  onDismiss,
  onActivate,
}: ToastContainerProps): JSX.Element {
  // Auto-dismiss timers. Sticky toasts (autoDismissMs === null) are skipped.
  useEffect(() => {
    const timers: number[] = [];
    for (const t of toasts) {
      if (t.autoDismissMs == null) continue;
      const id = t.id;
      const ms = t.autoDismissMs;
      const timer = window.setTimeout(() => onDismiss(id), ms);
      timers.push(timer);
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [toasts, onDismiss]);

  const containerStyle: CSSProperties = useMemo(
    () => ({
      position: 'fixed',
      top: 76, // below the 56-px header
      right: 16,
      zIndex: 900,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      pointerEvents: 'none',
    }),
    [],
  );

  return (
    <div style={containerStyle} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <Toast
            toast={t}
            onDismiss={() => onDismiss(t.id)}
            {...(onActivate ? { onClick: () => onActivate(t.id) } : {})}
          />
        </div>
      ))}
    </div>
  );
}
