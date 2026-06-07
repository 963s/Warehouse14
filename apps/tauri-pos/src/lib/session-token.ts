/**
 * Session bearer-token store for the Tauri webview.
 *
 * Why this exists: the cloud session is a `SameSite=None; Secure; HttpOnly`
 * cookie. That works on macOS (the webview origin `tauri://localhost` is a
 * secure context) but on Windows WebView2 the origin is the NON-secure
 * `http://tauri.localhost`, where a cross-site `Secure; SameSite=None` cookie
 * is dropped (third-party-cookie policy). So the POS ALSO carries the session
 * token as an `Authorization: Bearer` header, which is immune to cookie
 * policy. The api-client reads this via `getAuthToken()` on every request, and
 * the SSE stream passes it as an `access_token` query param.
 *
 * The token mirrors the cookie value (same `sessions.token`) and is persisted
 * to localStorage so the session survives an app restart, matching the
 * cookie's lifetime.
 *
 * SECURITY (go-live TODO): move this to the Tauri OS keychain (as the Fiskaly
 * keys were) so an XSS cannot read it. Acceptable for now under the strict
 * webview CSP (no third-party script execution) + test mode.
 */

const KEY = 'w14.session-token';

let cached: string | null | undefined;

/** The current session token, or null when signed out. */
export function getSessionToken(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Persist (or clear, when null) the session token. */
export function setSessionToken(token: string | null): void {
  cached = token;
  try {
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage unavailable — the in-memory cache still serves this run */
  }
}

/** Clear the session token (sign-out cascade). */
export function clearSessionToken(): void {
  setSessionToken(null);
}
