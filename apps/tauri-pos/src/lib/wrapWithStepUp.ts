/**
 * wrapWithStepUp — adds an interceptor to an ApiClient that catches
 * `STEP_UP_REQUIRED`, asks the global step-up store for a PIN, and retries
 * the original request automatically.
 *
 * Architectural choice (memory.md #76):
 *   • The raw `createApiClient(...)` instance has no UI awareness.
 *   • This wrapper is the SINGLE place where API errors translate into
 *     a UI action (open the modal). Other domains (toasts, telemetry)
 *     stay decoupled from the client.
 *
 * Single-retry policy: after step-up succeeds we retry exactly once. If
 * the second call STILL returns `STEP_UP_REQUIRED` we surface it — that
 * means the server is rejecting the step-up itself (clock skew, locked
 * PIN, etc.) and the operator needs to address it.
 */

import { ApiError, type ApiClient } from '@warehouse14/api-client';

import { useStepUpStore } from '../state/step-up-store.js';

export function wrapWithStepUp(client: ApiClient): ApiClient {
  return {
    baseUrl: client.baseUrl,
    async request(method, path, body, opts) {
      try {
        return await client.request(method, path, body, opts);
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'STEP_UP_REQUIRED') {
          throw err;
        }
        // Ask the global modal for a fresh PIN. The promise rejects on
        // operator cancel → bubbles back to the caller as the original error.
        try {
          await useStepUpStore.getState().ask();
        } catch (cancelErr) {
          // Operator dismissed — surface the ORIGINAL STEP_UP_REQUIRED error
          // so the calling screen can render an inline hint.
          throw err;
        }
        // Single retry. If this also fails with STEP_UP_REQUIRED something
        // server-side is wrong — let it propagate.
        return await client.request(method, path, body, opts);
      }
    },
  };
}
