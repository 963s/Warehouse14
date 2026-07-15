/**
 * usePrimeMicPermission — trigger the OS microphone prompt once, early.
 *
 * The Vierzehn voice assistant needs the microphone. Rather than surprise the
 * owner with a permission prompt the first time they summon Vierzehn mid-sale,
 * we ask once, quietly, right after the authenticated shell mounts: a single
 * getUserMedia(audio) whose tracks are stopped immediately. macOS shows its
 * standard one-time prompt; once granted, Vierzehn connects with no prompt at
 * all — it wakes and greets straight away.
 *
 * Guards:
 *  • Runs at most once per app session (module-level flag).
 *  • Skips entirely if the Permissions API already reports a decision
 *    (granted / denied) — no need to reopen the microphone.
 *  • Swallows every error: a denial here is handled properly by Vierzehn's own
 *    flow (typed failure + „Systemeinstellungen öffnen" button); priming must
 *    never surface an error or block the UI.
 */
import { useEffect } from 'react';

let primed = false;

export function usePrimeMicPermission(): void {
  useEffect(() => {
    if (primed) return;
    primed = true;
    void (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
      // If the browser can already tell us the decision is made, don't reopen the mic.
      try {
        const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
        if (perms?.query) {
          const status = await perms.query({ name: 'microphone' as PermissionName });
          if (status.state === 'granted' || status.state === 'denied') return;
        }
      } catch {
        /* Permissions API has no 'microphone' entry in WebKit — fall through to prime. */
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* Denied / no device — Vierzehn's own connect flow surfaces the honest recovery. */
      }
    })();
  }, []);
}
