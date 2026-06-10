/**
 * useBarcodeScanner — global keyboard listener that detects USB-HID
 * barcode scanner input via timing heuristic.
 *
 * USB barcode scanners enumerate as HID keyboards and "type" the scanned
 * code rapidly, ending with Enter (or Tab, depending on configuration).
 * They typically emit one character per ~16 ms — humans typing land
 * around 100–300 ms per keystroke. The 50 ms inter-keypress threshold
 * cleanly separates the two without misfiring on power-typists.
 *
 * Hook semantics:
 *   • Attaches a `keydown` listener to `document` while mounted.
 *   • Maintains a rolling buffer of recent characters + their first/last
 *     timestamps.
 *   • Buffer resets when the inter-keypress gap exceeds 50 ms.
 *   • On `Enter`, evaluates the buffer. Scan = buffer length ≥ 6 AND
 *     total elapsed time < 200 ms AND every character is printable ASCII.
 *   • Valid scan: `event.preventDefault()` to swallow the trailing Enter
 *     (so it doesn't submit any focused form), then `onScan(buffer)`.
 *   • Invalid: buffer reset, keystrokes flow through to focused inputs
 *     as normal.
 *
 * Coexistence with focused inputs is automatic: typing-speed keystrokes
 * never accumulate fast enough to qualify as a scan, so the focused
 * input field receives them normally.
 *
 * The `enabled` flag lets a parent surface toggle the listener (e.g.
 * disable while a modal that needs Enter-to-submit is open).
 */

import { useEffect, useRef } from 'react';

import { useScannerStore } from '../state/scanner-store.js';

const MIN_BUFFER_LEN = 6;
const MAX_GAP_MS = 50;
const MAX_TOTAL_MS = 200;
const PRINTABLE_ASCII = /^[\x20-\x7e]$/;

export interface UseBarcodeScannerOptions {
  enabled?: boolean;
  onScan: (code: string) => void;
  /**
   * Passive mode: record scanner liveness (for the Gerätemanager "Scanner
   * bereit" badge) but do NOT swallow the trailing Enter or route the code.
   * Used by the always-on app-wide liveness listener so it never competes with
   * the per-screen routing handler (Verkauf/Lager) for the same keystrokes.
   */
  passive?: boolean;
}

export function useBarcodeScanner({
  enabled = true,
  onScan,
  passive = false,
}: UseBarcodeScannerOptions): void {
  // Use refs to keep the listener identity stable across renders.
  const bufferRef = useRef<string>('');
  const firstAtRef = useRef<number>(0);
  const lastAtRef = useRef<number>(0);
  // Stash latest callback so the listener doesn't reattach when onScan changes.
  const onScanRef = useRef<UseBarcodeScannerOptions['onScan']>(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const reset = (): void => {
      bufferRef.current = '';
      firstAtRef.current = 0;
      lastAtRef.current = 0;
    };

    const onKey = (ev: KeyboardEvent): void => {
      // Ignore modifier-only keystrokes and IME composition.
      if (ev.isComposing) return;

      const now = performance.now();
      const key = ev.key;

      if (key === 'Enter') {
        const buf = bufferRef.current;
        const total = lastAtRef.current - firstAtRef.current;
        const qualifies =
          buf.length >= MIN_BUFFER_LEN &&
          total <= MAX_TOTAL_MS &&
          // Buffer entries are validated per-key during accumulation, so this
          // is just a paranoia check for hostile input methods.
          /^[\x20-\x7e]+$/.test(buf);
        reset();
        if (qualifies) {
          // Record liveness so the Gerätemanager can show "Scanner bereit" —
          // a successful HID decode is the only honest readiness signal for a
          // keyboard-class device (it has no IP to probe). Both the passive
          // app-wide listener and the routing listeners ping it; the store
          // de-dupes by overwriting the same timestamp.
          useScannerStore.getState().markScan(buf);
          // Passive (liveness-only) instances never swallow Enter or route —
          // the per-screen routing handler owns that for the focused surface.
          if (!passive) {
            // Swallow the Enter so it doesn't submit any focused form.
            ev.preventDefault();
            ev.stopPropagation();
            onScanRef.current(buf);
          }
        }
        return;
      }

      // Only single-character printable keys feed the buffer. Special keys
      // (ArrowLeft, F1, Shift, Meta, …) break the buffer because they
      // indicate human interaction.
      if (key.length !== 1 || !PRINTABLE_ASCII.test(key)) {
        reset();
        return;
      }

      // Modifier-augmented keystrokes (Ctrl+V paste, Cmd+T new tab) are
      // never scanner input — drop the buffer.
      if (ev.ctrlKey || ev.metaKey || ev.altKey) {
        reset();
        return;
      }

      const gap = lastAtRef.current === 0 ? 0 : now - lastAtRef.current;
      if (gap > MAX_GAP_MS) {
        // Restart the buffer with THIS keystroke as char 1.
        bufferRef.current = key;
        firstAtRef.current = now;
        lastAtRef.current = now;
        return;
      }
      bufferRef.current += key;
      lastAtRef.current = now;
      if (firstAtRef.current === 0) firstAtRef.current = now;
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      reset();
    };
  }, [enabled, passive]);
}
