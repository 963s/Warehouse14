/**
 * Die Brücke zur Nachbestätigung — der hauchdünne Draht zwischen der
 * Middleware im Bausatz (ohne React) und dem Dialog (mit React).
 *
 * Wie in apps/tauri-pos/src/lib/stepUpService.ts: antwortet eine empfindliche
 * Handlung mit STEP_UP_REQUIRED, ruft die Middleware `requestStepUp`, was den
 * Dialog öffnet und auf ihn wartet. Der Dialog verlangt die GERÄTESPERRE —
 * denselben Code oder dieselbe Biometrie wie beim Öffnen der App —, prüft sie
 * AUF DEM GERÄT und meldet dem Server erst danach, dass bestätigt wurde. Dann
 * spielt die Middleware die ursprüngliche Anfrage GENAU EINMAL erneut ab.
 *
 * Bis zum 23.07.2026 verlangte er hier die vierstellige Kassen-PIN, die am
 * 21.07. abgeschafft worden war.
 *
 * Der zurückgegebene Wert ist absichtlich leer: der Server prüft den frisch
 * gestempelten Zeitstempel der Sitzung, er liest KEINEN Kopfzeilen-Schlüssel.
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
