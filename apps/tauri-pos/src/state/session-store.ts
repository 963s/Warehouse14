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

import type { AuthSessionResponse, PinLoginResponse, SessionActor } from '@warehouse14/api-client';

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
  lastPinStepUpAt: null,
  sessionExpiresAt: null,

  setFromLogin: (payload) =>
    set({
      status: 'authenticated',
      actor: payload.actor,
      // PIN login itself is a step-up — the server stamps `lastPinStepUpAt`
      // server-side; we surface "now" for the client clock too.
      lastPinStepUpAt: new Date().toISOString(),
      sessionExpiresAt: payload.sessionExpiresAt,
    }),
  setFromProbe: (payload) =>
    set({
      status: 'authenticated',
      actor: payload.actor,
      lastPinStepUpAt: payload.lastPinStepUpAt,
      sessionExpiresAt: payload.expiresAt,
    }),
  recordStepUp: (lastPinStepUpAt) => set({ lastPinStepUpAt }),
  setUnauthenticated: () =>
    set({
      status: 'unauthenticated',
      actor: null,
      lastPinStepUpAt: null,
      sessionExpiresAt: null,
    }),
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
