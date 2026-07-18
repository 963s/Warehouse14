/**
 * Owner Google sign-in for the phone — the SAME server-brokered flow the desktop
 * uses (`apps/tauri-pos/src/lib/google-login.ts`), adapted to the mobile system
 * browser.
 *
 * The app opens `…/api/admin/auth/google/start?returnTo=warehouse14://auth-done`
 * in the OS auth browser (SFSafariViewController / Chrome Custom Tabs — Google's
 * OAuth policy allows these; an embedded WebView would be blocked as a
 * "disallowed_useragent"). The operator completes Google consent; the server
 * verifies the id_token, resolves the email against `users` (403 if not a
 * provisioned staff member — nothing is created), mints the session, and 302s to
 * `warehouse14://auth-done#token=…&expiresAt=…`. `openAuthSessionAsync` returns
 * that redirect URL; we read token + expiresAt from the fragment. The actor is
 * then fetched with `GET /api/auth/session` (see `completeGoogleLogin` in api.ts)
 * — exactly the desktop window handoff.
 *
 * No native OAuth plugin and no mobile Google client: Google only ever redirects
 * to the server's Web-application `…/callback`; the `warehouse14://` hop is
 * between the server and the app, after Google is done.
 */
import * as WebBrowser from "expo-web-browser"

/** The deep link the server callback redirects the session back to. */
export const AUTH_RETURN_TO = "warehouse14://auth-done"

export type GoogleAuthResult =
  | { ok: true; token: string; expiresAt: string }
  /** `error: null` = the operator cancelled the browser. A non-null code
   *  (e.g. `FORBIDDEN`, `OAUTH_FAILED`) came back from the server callback. */
  | { ok: false; error: string | null }

/** The `/start` URL for the returnTo handoff. */
export function buildStartUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "")
  return `${base}/api/admin/auth/google/start?returnTo=${encodeURIComponent(AUTH_RETURN_TO)}`
}

/**
 * Parse a `#a=1&b=2` URL fragment without depending on URLSearchParams (React
 * Native has no complete URL implementation and the app installs no URL polyfill).
 */
export function parseFragment(url: string): Record<string, string> {
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : ""
  const out: Record<string, string> = {}
  for (const pair of hash.split("&")) {
    if (!pair) continue
    const eq = pair.indexOf("=")
    const k = eq >= 0 ? pair.slice(0, eq) : pair
    const v = eq >= 0 ? pair.slice(eq + 1) : ""
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

/**
 * Open the system auth browser and resolve once the `warehouse14://` redirect
 * lands (or as cancelled/errored). Only carries `token` + `expiresAt`; the caller
 * resolves the actor with the session probe.
 */
export async function signInWithGoogle(baseUrl: string): Promise<GoogleAuthResult> {
  const startUrl = buildStartUrl(baseUrl)
  const res = await WebBrowser.openAuthSessionAsync(startUrl, AUTH_RETURN_TO)
  if (res.type !== "success" || !res.url) {
    // "cancel" (dismissed) / "dismiss" / "locked" → treat as cancelled.
    return { ok: false, error: null }
  }
  const params = parseFragment(res.url)
  if (params.token && params.expiresAt) {
    return { ok: true, token: params.token, expiresAt: params.expiresAt }
  }
  return { ok: false, error: params.error ?? "OAUTH_FAILED" }
}
