/**
 * step-up-store — bridge between the ApiClient's step-up middleware and the
 * <StepUpModal/> component (mirrors the POS, memory.md #76).
 *
 * When the middleware encounters `STEP_UP_REQUIRED`, it:
 *   1. calls `ask()` → returns a Promise that resolves on PIN success
 *      or rejects when the owner cancels.
 *   2. The store toggles `active = true` and remembers the resolver.
 *   3. The modal renders, the owner types the PIN, the modal calls
 *      `complete()` on success or `cancel()` on Esc.
 *   4. The resolver fires; the middleware replays the original request.
 */

import { create } from 'zustand';

import type { StepUpReason } from '@warehouse14/api-client';

/**
 * Thrown when the owner CANCELS the PIN modal (Esc / backdrop / Abbrechen). It
 * is a plain rejection, NOT an ApiError — the middleware propagates it verbatim,
 * so callers must recognise a deliberate cancel via `isStepUpCancelled(err)` and
 * report "abgebrochen", not a system failure.
 */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Step-up cancelled by owner.');
    this.name = 'StepUpCancelledError';
  }
}

/** True iff `err` is a deliberate owner cancel of the step-up PIN modal. */
export function isStepUpCancelled(err: unknown): boolean {
  return err instanceof StepUpCancelledError;
}

interface StepUpRequest {
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface StepUpState {
  active: boolean;
  request: StepUpRequest | null;
  /** Why the middleware asked — carries the method + path of the guarded request
   *  so the modal can name the action the owner is confirming. */
  reason: StepUpReason | null;

  /** Called by the middleware to ask for a PIN; returns a Promise. */
  ask: (reason?: StepUpReason) => Promise<void>;
  /** Called by the modal on a successful POST /api/auth/step-up. */
  complete: () => void;
  /** Called by the modal on Esc or backdrop click. */
  cancel: () => void;
}

export const useStepUpStore = create<StepUpState>((set, get) => ({
  active: false,
  request: null,
  reason: null,

  ask: (reason) =>
    new Promise<void>((resolve, reject) => {
      // If a step-up is already pending, fail fast — resolve the current
      // modal first.
      const current = get().request;
      if (current) {
        reject(new Error('A step-up is already pending.'));
        return;
      }
      set({ active: true, request: { resolve, reject }, reason: reason ?? null });
    }),

  complete: () => {
    const r = get().request;
    if (r) r.resolve();
    set({ active: false, request: null, reason: null });
  },

  cancel: () => {
    const r = get().request;
    if (r) r.reject(new StepUpCancelledError());
    set({ active: false, request: null, reason: null });
  },
}));
