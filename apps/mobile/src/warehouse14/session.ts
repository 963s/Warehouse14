/**
 * Session store — holds the PIN-login session token + actor for the app.
 *
 * RN has no cookie jar, so the token returned by authPin.login is carried as
 * `Authorization: Bearer` via the api-client's getAuthToken (see api.ts). This
 * is an in-memory store (re-login on cold start); a production build would
 * persist it in expo-secure-store. Exposed both as a plain getter (for the
 * non-React getAuthToken callback) and a useSession() hook (for screens).
 */
import { useSyncExternalStore } from "react"
import * as SecureStore from "expo-secure-store"
import type { SessionActor } from "@warehouse14/api-client"

let token: string | null = null
let actor: SessionActor | null = null
let expiresAt: string | null = null
/**
 * A token held ONLY for the in-flight login probe (Bearer plumbing), invisible
 * to `hasSession`. Keeping it out of `token` means no component that happens to
 * re-render mid-handoff can see a half-authenticated state and flip the auth
 * gate before the probe has delivered the actor.
 */
let pendingToken: string | null = null
const listeners = new Set<() => void>()

/** Keychain / Keystore key for the persisted session (survives cold start). */
const PERSIST_KEY = "w14.session"

function emit(): void {
  for (const l of listeners) l()
}

/** Fire-and-forget persistence of the current session; a storage failure must
 *  never break auth. A null session clears the stored copy. */
function persist(): void {
  if (token && actor && expiresAt) {
    void SecureStore.setItemAsync(PERSIST_KEY, JSON.stringify({ token, actor, expiresAt })).catch(
      () => {},
    )
  } else {
    void SecureStore.deleteItemAsync(PERSIST_KEY).catch(() => {})
  }
}

/** Plain getter for the api-client getAuthToken callback (non-React). The
 *  pending login-probe token rides here too, so the probe carries its Bearer. */
export function getSessionToken(): string | null {
  return token ?? pendingToken
}

/**
 * Hold the bearer token for the in-flight login probe ONLY. It feeds
 * `getSessionToken` (so `GET /api/auth/session` is authorized) but never
 * `hasSession` — the auth gate cannot flip until `setSession` delivers the
 * actor. Rolled back via `clearSession` on failure.
 */
export function setAuthTokenSilently(t: string): void {
  pendingToken = t
}

/**
 * Restore a persisted session on cold start, if still valid. Called once at
 * startup; the LocalLockGate still requires the device code before the shell, so
 * a stolen unlocked phone with a live token cannot walk straight in.
 */
export async function hydrateSession(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(PERSIST_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { token?: string; actor?: SessionActor; expiresAt?: string }
    if (!parsed.token || !parsed.actor || !parsed.expiresAt) return
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      void SecureStore.deleteItemAsync(PERSIST_KEY).catch(() => {})
      return
    }
    setSession({ token: parsed.token, actor: parsed.actor, expiresAt: parsed.expiresAt })
  } catch {
    // corrupt / unreadable → ignore; the owner signs in again.
  }
}

/** Plain (non-React) read of "is there a session" — for imperative guards. */
export function hasSession(): boolean {
  return token != null
}

export function setSession(next: { token: string; actor: SessionActor; expiresAt: string }): void {
  // Idempotent: a re-issued login (e.g. a coalesced double-submit replaying the
  // same successful response) must NOT churn the auth gate. Only a genuinely
  // new token emits — that is what the root redirect is waiting on. Without this
  // guard, the same token re-set would notify every subscriber on each call and
  // re-run the redirect effect needlessly.
  if (token === next.token && actor?.id === next.actor.id && expiresAt === next.expiresAt) {
    return
  }
  pendingToken = null
  token = next.token
  actor = next.actor
  expiresAt = next.expiresAt
  emit()
  persist()
}

export function clearSession(): void {
  pendingToken = null
  if (token === null && actor === null && expiresAt === null) return
  token = null
  actor = null
  expiresAt = null
  emit()
  persist()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export interface SessionState {
  token: string | null
  actor: SessionActor | null
  expiresAt: string | null
  isAuthenticated: boolean
}

export function useSession(): SessionState {
  // token is a stable primitive snapshot; actor/expiresAt change with it.
  const t = useSyncExternalStore(
    subscribe,
    () => token,
    () => token,
  )
  return { token: t, actor, expiresAt, isAuthenticated: hasSession() }
}
