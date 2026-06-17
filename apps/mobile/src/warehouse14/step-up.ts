/**
 * Step-up bridge — the paper-thin link between the api-client's
 * stepUpMiddleware (non-React) and the native PIN Dialog (React).
 *
 * Mirrors apps/tauri-pos/src/lib/stepUpService.ts: when a sensitive action
 * (e.g. relocate) 403s with STEP_UP_REQUIRED, the middleware calls
 * `requestStepUp`, which opens the PIN Dialog and awaits it. The Dialog host
 * verifies the PIN via authPin.stepUp (refreshing sessions.last_pin_step_up_at)
 * then resolves; the middleware replays the original request EXACTLY ONCE.
 *
 * The returned token value is empty on purpose: the backend re-checks the
 * freshly-bumped session timestamp (auth-policy.requireStepUp), it does NOT
 * read the x-step-up-token header — identical to the Tauri POS contract.
 */
import type { StepUpDependencies, StepUpReason, StepUpToken } from "@warehouse14/api-client"

export class StepUpCancelledError extends Error {
  constructor() {
    super("PIN-Bestätigung abgebrochen")
    this.name = "StepUpCancelledError"
  }
}

interface Pending {
  reason: StepUpReason
  resolve: () => void
  reject: (err: unknown) => void
}

let pending: Pending | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Called by the middleware (non-React). Opens the dialog and awaits it. */
function ask(reason: StepUpReason): Promise<void> {
  // Only one prompt at a time — supersede any stale one.
  pending?.reject(new StepUpCancelledError())
  return new Promise<void>((resolve, reject) => {
    pending = { reason, resolve, reject }
    emit()
  })
}

async function requestStepUp(reason: StepUpReason): Promise<StepUpToken> {
  await ask(reason)
  return { value: "" }
}

/** Pass this to stepUpMiddleware(...) in api.ts. */
export const stepUpService: StepUpDependencies = { requestStepUp }

// ── React side (consumed by StepUpDialogHost) ───────────────────────────────
export function subscribeStepUp(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getPendingStepUp(): Pending | null {
  return pending
}

/** PIN verified — let the middleware replay the original request. */
export function completeStepUp(): void {
  const p = pending
  pending = null
  emit()
  p?.resolve()
}

/** User cancelled (or PIN failed terminally) — propagate to the caller. */
export function cancelStepUp(err: unknown = new StepUpCancelledError()): void {
  const p = pending
  pending = null
  emit()
  p?.reject(err)
}
