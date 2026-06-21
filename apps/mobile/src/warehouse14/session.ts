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
import type { SessionActor } from "@warehouse14/api-client"

let token: string | null = null
let actor: SessionActor | null = null
let expiresAt: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Plain getter for the api-client getAuthToken callback (non-React). */
export function getSessionToken(): string | null {
  return token
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
  token = next.token
  actor = next.actor
  expiresAt = next.expiresAt
  emit()
}

export function clearSession(): void {
  if (token === null && actor === null && expiresAt === null) return
  token = null
  actor = null
  expiresAt = null
  emit()
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
  return { token: t, actor, expiresAt, isAuthenticated: t != null }
}
