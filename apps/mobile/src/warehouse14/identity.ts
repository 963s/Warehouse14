/**
 * The multi-user identity model — client-side types + the per-user seal.
 *
 * HONEST STATUS (§4): the live backend authenticates via per-device mTLS (the
 * cert resolves the user) + a shared PIN second factor. There is NO Google
 * OAuth and NO per-user-username table on the server yet. This file models the
 * identity the app ALREADY receives (SessionActor: id + role + isOwner) and
 * extends it with the client-side presentation layer (displayName, initials,
 * seal glyph, role label) so each person is visually distinct.
 *
 * What is REAL right now:
 *   • The actor id + role + isOwner come from the server (loginSafe response).
 *   • The role maps to a German label + a seal via ROLE_SEAL below.
 *   • The displayName is derived from the id (the server doesn't send a name
 *     yet) — honestly labelled as the operator's short id until the backend
 *     adds a names field.
 *
 * What is SCAFFOLDED (flagged for backend):
 *   • Google sign-in: the client has the flow shape (GoogleIdentity) but no
 *     server endpoint to exchange a Google token for a session. DO NOT fake a
 *     Google login — the login screen shows only the real PIN path until the
 *     backend supports it.
 *   • Per-user username: the PIN is shared; a per-user username needs a server
 *     users table. The model has the field; the UI doesn't expose it yet.
 *
 * NEVER fake an identity or a logged-in state. Every seal + label here is
 * derived from the real SessionActor the server returned.
 */
import type { ActorRole, SessionActor } from "@warehouse14/api-client"

/** The roles the shop recognizes (mirrors the server ActorRole). */
export const ROLE_LABEL: Record<ActorRole, string> = {
  ADMIN: "Inhaber",
  CASHIER: "Kassierer",
  READONLY: "Lesezugriff",
}

/**
 * The per-user seal — a German label + a typographic glyph that marks each
 * person's actions (Belege, Tagebuch, step-up prompts). The owner gets the
 * diamond ◆ (the house seal); staff get a calmer mark. Drives the visual
 * identity in the header, the step-up dialog, and the audit trail.
 */
export const ROLE_SEAL: Record<ActorRole, { label: string; glyph: string; tone: "ink" | "faded" }> = {
  ADMIN: { label: "Inhaber", glyph: "◆", tone: "ink" },
  CASHIER: { label: "Kassierer", glyph: "◇", tone: "faded" },
  READONLY: { label: "Lesezugriff", glyph: "○", tone: "faded" },
}

/**
 * The presentation identity — derived HONESTLY from the real SessionActor.
 * displayName falls back to a short id label until the backend sends a name;
 * this is explicitly flagged, not faked.
 */
export interface PresentationIdentity {
  /** The real server actor id. */
  id: string
  /** The real server role. */
  role: ActorRole
  /** The real server owner flag. */
  isOwner: boolean
  /** A display name — the server doesn't send one yet, so this is the short
   *  id until a backend names field exists. Honestly derived, never faked. */
  displayName: string
  /** Initials for the avatar monogram (from displayName). */
  initials: string
  /** The German role label. */
  roleLabel: string
  /** The seal glyph + label. */
  seal: { label: string; glyph: string; tone: "ink" | "faded" }
}

/** Build the presentation identity from the real session actor. */
export function presentationIdentity(actor: SessionActor): PresentationIdentity {
  const seal = ROLE_SEAL[actor.role]
  // The server sends no display name yet — derive a short, honest label from
  // the id. When the backend adds a `displayName` field, swap it in here.
  const displayName = `Nutzer ${actor.id.slice(0, 6)}`
  const initials = displayName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return {
    id: actor.id,
    role: actor.role,
    isOwner: actor.isOwner,
    displayName,
    initials,
    roleLabel: ROLE_LABEL[actor.role],
    seal,
  }
}

/**
 * Google sign-in — SCAFFOLD ONLY. The client flow shape for when the backend
 * supports it. DO NOT render a Google button until the server has a
 * `/api/auth/google` endpoint; the login screen must show only the real PIN
 * path. This type exists so the model is complete and the backend gap is
 * explicit, not hidden.
 */
export interface GoogleIdentity {
  /** The Google ID token (from expo-google-app-auth / SignIn). */
  idToken: string
  /** The Google user email. */
  email: string
  /** The Google display name. */
  name: string
}

/**
 * Google sign-in is LIVE via the server-brokered owner flow (the same one the
 * desktop uses): the phone opens `…/api/admin/auth/google/start` in the system
 * browser, the server verifies the Google id_token, resolves the email against
 * the `users` table (403 if not provisioned), mints a session, and hands it back
 * via the `warehouse14://auth-done` deep link. See `google-login.ts` +
 * `completeGoogleLogin` in `api.ts`. No client-side id_token exchange and no
 * mobile Google client are needed. PIN remains as a fallback door.
 */
export const GOOGLE_SIGN_IN_AVAILABLE = true
