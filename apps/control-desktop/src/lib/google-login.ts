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
 * Open the OS default browser. Tauri v2 routes a `_blank` window.open to the
 * shell, the same pattern apps/tauri-pos uses for its external links — so no
 * `@tauri-apps/plugin-shell` dependency is needed here.
 */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
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
