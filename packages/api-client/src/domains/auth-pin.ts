/**
 * PIN-auth domain client. Mirrors the actual `apps/api-cloud/src/routes/
 * auth-pin.ts` and `auth-session.ts` wire shapes.
 *
 * Corrected 2026-05-26 (memory.md #76): the prior version used the wrong
 * paths (`/api/auth/pin/login`) and body (`{ email, pin }`). The real
 * server uses `POST /api/auth/pin-login` with `{ pin }` only — mTLS
 * resolves the user via the device cert.
 */

import type { ApiClient } from '../client.js';

export type ActorRole = 'ADMIN' | 'CASHIER' | 'READONLY';

export interface SessionActor {
  id: string;
  role: ActorRole;
  isOwner: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/auth/pin-login
// ────────────────────────────────────────────────────────────────────────

export interface PinLoginRequest {
  /** 4-digit PIN. The device cert (mTLS) resolves the user identity. */
  pin: string;
}

export interface PinLoginResponse {
  ok: true;
  sessionExpiresAt: string;
  actor: SessionActor;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/auth/step-up
// ────────────────────────────────────────────────────────────────────────

export interface PinStepUpRequest {
  pin: string;
}

export interface PinStepUpResponse {
  ok: true;
  lastPinStepUpAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/auth/session
// ────────────────────────────────────────────────────────────────────────

export interface AuthSessionResponse {
  ok: true;
  actor: SessionActor;
  lastPinStepUpAt: string | null;
  expiresAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/auth/sign-out
// ────────────────────────────────────────────────────────────────────────

export interface SignOutResponse {
  ok: true;
}

export const authPin = {
  login(client: ApiClient, body: PinLoginRequest): Promise<PinLoginResponse> {
    return client.request<PinLoginResponse>('POST', '/api/auth/pin-login', body);
  },
  stepUp(client: ApiClient, body: PinStepUpRequest): Promise<PinStepUpResponse> {
    return client.request<PinStepUpResponse>('POST', '/api/auth/step-up', body);
  },
  session(client: ApiClient): Promise<AuthSessionResponse> {
    return client.request<AuthSessionResponse>('GET', '/api/auth/session');
  },
  signOut(client: ApiClient): Promise<SignOutResponse> {
    return client.request<SignOutResponse>('POST', '/api/auth/sign-out');
  },
};
