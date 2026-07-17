/**
 * Google staff/owner sign-in for the desktop, via the server device-handoff flow
 * (no native OAuth plugin and no custom URL scheme required).
 *
 *   1. generate an opaque nonce on this device
 *   2. open the system browser at /api/admin/auth/google/start?nonce=…
 *   3. the operator completes Google consent; the server verifies the id_token,
 *      resolves the email against `users` (403 if not a provisioned staff member),
 *      parks the minted session under the nonce, and shows a success page
 *   4. we poll POST /api/admin/auth/google/claim { nonce } until it returns the
 *      session — the SAME { token, actor, sessionExpiresAt } shape as pin-login,
 *      so the existing session store + Bearer plumbing consume it unchanged
 *
 * The nonce (32 random bytes, base64url) is the capability: single-use, and it
 * expires server-side after five minutes.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { ApiClient, PinLoginResponse } from '@warehouse14/api-client';

/** The claim endpoint returns the login payload when ready, else a pending marker. */
type ClaimResponse = PinLoginResponse | { ok: false; pending: true };

/** 32 random bytes → URL-safe base64 (43 chars). Matches the server's nonce guard. */
export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `/start` URL the system browser is pointed at. */
export function buildStartUrl(baseUrl: string, nonce: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/admin/auth/google/start?nonce=${encodeURIComponent(nonce)}`;
}

/**
 * Open the OS default browser at `url`.
 *
 * In the packaged app a bare `window.open` does NOT reach the OS browser (the
 * WKWebView just swallows it and the sign-in hangs), so we call the Rust
 * `open_url` command, which opens via the shell plugin — the same reliable path
 * `open_microphone_settings` uses. The `window.open` fallback only runs in the
 * plain-browser dev harness (no Tauri IPC), where it works.
 */
export function openExternal(url: string): void {
  void invoke('open_url', { url }).catch(() => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  });
}

/** The loopback the staff callback redirects to; intercepted by the Rust window. */
const AUTH_DONE_RETURN = 'http://localhost/__w14_auth_done';

/** `/start` URL for the IN-APP window flow — the callback returns the token to
 *  the loopback `returnTo`, which the Rust window intercepts (no device nonce,
 *  no polling). */
export function buildStartUrlReturn(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/admin/auth/google/start?returnTo=${encodeURIComponent(AUTH_DONE_RETURN)}`;
}

export type GoogleWindowResult =
  | { ok: true; token: string; expiresAt: string }
  /** `error: null` = the operator closed the window (cancelled). A non-null
   *  code (e.g. `FORBIDDEN`, `OAUTH_FAILED`) came back from the server callback. */
  | { ok: false; error: string | null };

/**
 * Sign in with Google in an IN-APP window (no external browser, no polling).
 *
 * Opens the account picker inside the app via the Rust `start_google_login`
 * command; resolves once the callback redirect is intercepted (with the token),
 * or as cancelled/errored. We start listening BEFORE opening the window so the
 * result event is never missed.
 */
export async function signInWithGoogleWindow(
  baseUrl: string,
): Promise<GoogleWindowResult> {
  const startUrl = buildStartUrlReturn(baseUrl);
  return new Promise<GoogleWindowResult>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    const finish = (value: GoogleWindowResult): void => {
      if (settled) return;
      settled = true;
      unlisten?.();
      resolve(value);
    };
    void listen<string>('google-auth-result', (event) => {
      const params = new URLSearchParams(event.payload || '');
      const token = params.get('token');
      const expiresAt = params.get('expiresAt');
      if (token && expiresAt) finish({ ok: true, token, expiresAt });
      else finish({ ok: false, error: params.get('error') });
    })
      .then((stop) => {
        unlisten = stop;
        // Listener is live — now open the window.
        return invoke('start_google_login', { startUrl });
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        unlisten?.();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/** One claim poll. Returns the login payload when ready, else null (still pending). */
export async function claimOnce(
  client: ApiClient,
  nonce: string,
): Promise<PinLoginResponse | null> {
  const res = await client.request<ClaimResponse>('POST', '/api/admin/auth/google/claim', {
    nonce,
  });
  return res.ok ? res : null;
}
