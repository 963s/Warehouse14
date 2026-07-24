/**
 * Owner Google sign-in for the phone — the SAME server-brokered flow the desktop
 * uses (`apps/tauri-pos/src/lib/google-login.ts`), adapted to the mobile system
 * browser, with TWO independent return paths so the login can never hang:
 *
 *   1. SCHNELLER WEG (deep link): der Server-Callback zeigt eine Seite mit
 *      automatischem Sprung + sichtbarem Knopf nach
 *      `warehouse14://auth-done#token=…`. Landet der Sprung, löst
 *      `openAuthSessionAsync` mit dieser URL auf und der Token steht im Fragment.
 *   2. NETZ (Abhol-Schleife): die App schickt zusätzlich eine Einmal-Nonce mit;
 *      der Server PARKT die fertige Sitzung darunter, und die App holt sie per
 *      POST `/api/admin/auth/google/claim` ab — PARALLEL zum offenen Browser.
 *      Klemmt der Custom Tab (Chrome blockiert automatische Schema-Sprünge ohne
 *      Nutzergeste — Basels Befund am 24.07.2026, zwei Updates in Folge), holt
 *      die Schleife die Sitzung trotzdem, und der Browser wird geschlossen.
 *
 * Wer zuerst liefert, gewinnt; der jeweils andere Weg wird verworfen (die
 * geparkte Sitzung ist einmalig und verfällt nach Minuten von selbst).
 *
 * No native OAuth plugin and no mobile Google client: Google only ever redirects
 * to the server's Web-application `…/callback`; the `warehouse14://` hop is
 * between the server and the app, after Google is done.
 */
import * as WebBrowser from "expo-web-browser"

// Ohne diesen Aufruf bleibt die Auth-Sitzung auf Android hängen, wenn der
// Rücksprung die App öffnet: der wartende openAuthSessionAsync wird nie
// aufgelöst. Muss einmal im Modul-Scope laufen, bevor eine Sitzung startet.
WebBrowser.maybeCompleteAuthSession()

/** The deep link the server callback redirects the session back to. */
export const AUTH_RETURN_TO = "warehouse14://auth-done"

/** Poll cadence + budget for the claim leg (the operator reads a consent screen). */
const CLAIM_INTERVAL_MS = 1500
const CLAIM_BUDGET_MS = 3 * 60 * 1000

export type GoogleAuthResult =
  | { ok: true; token: string; expiresAt: string }
  /** `error: null` = the operator cancelled the browser. A non-null code
   *  (e.g. `FORBIDDEN`, `OAUTH_FAILED`) came back from the server callback. */
  | { ok: false; error: string | null }

/** URL-sichere Einmal-Nonce (~192 Bit) für die geparkte Sitzung. */
function generateNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let out = ""
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

/** The `/start` URL carrying BOTH return paths (deep link + parked nonce). */
export function buildStartUrl(baseUrl: string, nonce: string): string {
  const base = baseUrl.replace(/\/+$/, "")
  return (
    `${base}/api/admin/auth/google/start` +
    `?returnTo=${encodeURIComponent(AUTH_RETURN_TO)}` +
    `&nonce=${encodeURIComponent(nonce)}`
  )
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Die geparkte Sitzung abholen — bis eine da ist oder das Budget endet. */
async function claimLoop(
  baseUrl: string,
  nonce: string,
  isSettled: () => boolean,
): Promise<GoogleAuthResult | null> {
  const base = baseUrl.replace(/\/+$/, "")
  const deadline = Date.now() + CLAIM_BUDGET_MS
  while (Date.now() < deadline) {
    if (isSettled()) return null
    await sleep(CLAIM_INTERVAL_MS)
    if (isSettled()) return null
    try {
      const r = await fetch(`${base}/api/admin/auth/google/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce }),
      })
      if (!r.ok) continue
      const body = (await r.json()) as {
        ok?: boolean
        token?: string
        sessionExpiresAt?: string
      }
      if (body.ok && body.token && body.sessionExpiresAt) {
        return { ok: true, token: body.token, expiresAt: body.sessionExpiresAt }
      }
    } catch {
      // Netz-Ruckler während der Browser offen ist — weiter warten.
    }
  }
  return null
}

/**
 * Open the system auth browser and resolve once EITHER return path lands: the
 * `warehouse14://` redirect (fast) or the parked-session claim (net). Only
 * carries `token` + `expiresAt`; the caller resolves the actor with the
 * session probe.
 */
export async function signInWithGoogle(baseUrl: string): Promise<GoogleAuthResult> {
  const nonce = generateNonce()
  const startUrl = buildStartUrl(baseUrl, nonce)

  let settled = false

  // Netz: läuft PARALLEL zum Browser, nicht danach — ein klemmender Tab kann
  // die Anmeldung so nie mehr aufhalten.
  const viaClaim = claimLoop(baseUrl, nonce, () => settled).then((r) => {
    if (r && !settled) {
      settled = true
      // Den (möglicherweise klemmenden) Tab schliessen; scheitert leise auf
      // Plattformen ohne dismiss.
      try {
        void WebBrowser.dismissBrowser()
      } catch {
        /* kein Tab offen — gut so */
      }
    }
    return r
  })

  // Schneller Weg: der Browser selbst.
  const viaBrowser: Promise<GoogleAuthResult | null> = WebBrowser.openAuthSessionAsync(
    startUrl,
    AUTH_RETURN_TO,
  ).then((res) => {
    if (settled) return null
    if (res.type !== "success" || !res.url) {
      // "cancel" (dismissed) / "dismiss" / "locked": NICHT sofort aufgeben —
      // die Person kann die Anmeldung im Browser abgeschlossen und den Tab von
      // Hand geschlossen haben. Der Claim-Schleife eine kurze Gnadenfrist
      // lassen; danach entscheidet das Rennen unten.
      return sleep(6000).then(() => null)
    }
    const params = parseFragment(res.url)
    if (params.token && params.expiresAt) {
      settled = true
      return { ok: true, token: params.token, expiresAt: params.expiresAt }
    }
    settled = true
    return { ok: false, error: params.error ?? "OAUTH_FAILED" }
  })

  // Wer zuerst ein ECHTES Ergebnis liefert, gewinnt. `null` heisst „dieser Weg
  // hat nichts", dann zählt der jeweils andere.
  const first = await Promise.race([viaBrowser, viaClaim])
  if (first) {
    settled = true
    return first
  }
  const [b, c] = await Promise.all([viaBrowser, viaClaim])
  settled = true
  const result = b ?? c
  if (result) return result
  // Beide Wege leer: der Mensch hat abgebrochen.
  return { ok: false, error: null }
}
