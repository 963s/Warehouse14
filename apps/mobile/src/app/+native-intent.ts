/**
 * +native-intent — expo-router's native deep-link rewrite hook.
 *
 * The owner Google sign-in returns via `warehouse14://auth-done#token=…`. On
 * Android the auth browser is a JS polyfill (custom tab + a Linking listener),
 * so the SAME redirect also reaches expo-router, which would otherwise resolve
 * the unknown path "auth-done" to the +not-found screen in the middle of the
 * handoff. The token travels in the URL fragment and is consumed exclusively by
 * the pending `signInWithGoogle` promise (google-login.ts) — never by the
 * router — so the router's only correct move is to stay on the login screen.
 * If Android killed the app behind the browser tab (cold-start delivery), the
 * promise is gone; landing on /login lets the owner simply tap again.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes("auth-done")) return "/login"
  return path
}
