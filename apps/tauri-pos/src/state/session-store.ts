/**
 * Zustand store — current operator session.
 *
 * The Tauri webview cookie store persists across reloads, so on cold start
 * we probe `/api/auth/session` to know whether a session is still alive
 * (see `useSessionProbe`). Until that round-trip resolves, `status` is
 * `'unknown'`. The login screen owns the transition from `'unauthenticated'`
 * to `'authenticated'`.
 */

import { create } from 'zustand';

import type { AuthProfile, AuthSessionResponse, PinLoginResponse, SessionActor } from '@warehouse14/api-client';

import { readProfileCache, writeProfileCache } from '../lib/profile-cache.js';

/**
 * `unreachable` is distinct from `unauthenticated`: the cold-start probe could
 * not reach the server at all (network / circuit-open), so we must NOT show the
 * PIN pad (which implies "your session ended — log in again"). Instead App.tsx
 * renders a "Keine Verbindung zum Server" screen with a retry. From there the
 * operator can re-probe, which resolves to authenticated / unauthenticated.
 */
export type SessionStatus = 'unknown' | 'unauthenticated' | 'unreachable' | 'authenticated';

interface SessionState {
  status: SessionStatus;
  actor: SessionActor | null;
  /** Who is signed in (email + Google name/picture), for the header profile. */
  profile: AuthProfile | null;
  lastPinStepUpAt: string | null;
  sessionExpiresAt: string | null;

  /** Called by PinLogin after a successful POST /api/auth/pin-login. */
  setFromLogin: (payload: PinLoginResponse) => void;
  /** Called by useSessionProbe after a cold-start probe found a live session. */
  setFromProbe: (payload: AuthSessionResponse) => void;
  /** Called by the step-up modal after a successful POST /api/auth/step-up. */
  recordStepUp: (lastPinStepUpAt: string) => void;
  setUnauthenticated: () => void;
  /** Cold-start probe could not reach the server (network / circuit). */
  setUnreachable: () => void;
  /** Re-run the cold-start probe (drives status back to 'unknown'). */
  retryProbe: () => void;
  setStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'unknown',
  actor: null,
  // Hydrate the last-known profile so the header shows the operator instantly.
  profile: readProfileCache(),
  lastPinStepUpAt: null,
  sessionExpiresAt: null,

  setFromLogin: (payload) => {
    if (payload.profile) writeProfileCache(payload.profile);
    set((s) => ({
      status: 'authenticated',
      actor: payload.actor,
      // Prefer the fresh profile; keep the cached one if the server omitted it.
      profile: payload.profile ?? s.profile,
      // PIN login itself is a step-up — the server stamps `lastPinStepUpAt`
      // server-side; we surface "now" for the client clock too.
      lastPinStepUpAt: new Date().toISOString(),
      sessionExpiresAt: payload.sessionExpiresAt,
    }));
  },
  setFromProbe: (payload) => {
    if (payload.profile) writeProfileCache(payload.profile);
    set((s) => ({
      status: 'authenticated',
      actor: payload.actor,
      profile: payload.profile ?? s.profile,
      lastPinStepUpAt: payload.lastPinStepUpAt,
      sessionExpiresAt: payload.expiresAt,
    }));
  },
  recordStepUp: (lastPinStepUpAt) => set({ lastPinStepUpAt }),
  setUnauthenticated: () => {
    writeProfileCache(null);
    set({
      status: 'unauthenticated',
      actor: null,
      profile: null,
      lastPinStepUpAt: null,
      sessionExpiresAt: null,
    });
  },
  // Server unreachable ≠ signed out: keep the cached profile so a retry that
  // reconnects doesn't flash an empty identity.
  setUnreachable: () =>
    set({
      status: 'unreachable',
      actor: null,
      lastPinStepUpAt: null,
      sessionExpiresAt: null,
    }),
  retryProbe: () => set({ status: 'unknown' }),
  setStatus: (status) => set({ status }),
}));
