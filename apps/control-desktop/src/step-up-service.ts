/**
 * step-up-service — paper-thin bridge between the api-client's step-up
 * middleware and the Zustand store that owns the PIN modal (mirrors the POS).
 *
 * The real auth happens server-side: the modal POSTs `/api/auth/step-up`,
 * which freshens `session.lastPinStepUpAt`. The replayed request then passes
 * `requireStepUp`. The header token is therefore intentionally empty — the
 * session cookie is the source of truth, not the header value.
 */

import type { StepUpDependencies, StepUpReason, StepUpToken } from '@warehouse14/api-client';

import { useStepUpStore } from './state/step-up-store.js';

async function requestStepUp(reason: StepUpReason): Promise<StepUpToken> {
  // Forward the reason (method + path of the guarded call) so the modal can name
  // the action the owner is confirming. The token stays empty on purpose — the
  // freshened session cookie is the source of truth, not this header value.
  await useStepUpStore.getState().ask(reason);
  return { value: '' };
}

export const stepUpService: StepUpDependencies = { requestStepUp };
