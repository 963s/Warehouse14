/**
 * useSafeRetry — a guarded wrapper around `useMutation` that retries a write
 * exactly once it's safe, and otherwise gets out of the way.
 *
 * Two failure modes a write hits on a flaky LAN:
 *
 *   1. it failed at the transport level (the wire dropped mid-request), OR
 *   2. it never left because we were already offline.
 *
 * For an IDEMPOTENT, NON-FISCAL write (mark a task done, set an appointment
 * status, mark a thread handled), repeating it lands the same end state — so the
 * kind thing is to remember the attempt and re-fire it automatically the moment
 * the connection store flips back to „online". That's pure UX with no risk.
 *
 * For a FISCAL / money-movement write — or any write the call site hasn't vouched
 * is idempotent — we do the opposite: we NEVER auto-retry. We hold the failed
 * attempt's themed error and a calm reason, and the operator re-triggers it
 * themselves (a fiscal one through its own step-up + confirm path). This is the
 * absolute line from the task: a fiscal/money mutation is never queued or
 * auto-fired here. The classification is delegated to `retry-policy`, which uses
 * the SAME fiscal-prefix source of truth as the api-client.
 *
 * This hook does NOT replace the api-client's durable offline outbox (that's the
 * desktop POS's GoBD-grade path with caller-supplied idempotency keys). It's the
 * lightweight, session-scoped „try the harmless thing again when we reconnect"
 * layer for the read/admin surfaces of the Owner OS.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { HttpMethod } from "@warehouse14/api-client"

import {
  classifyRetry,
  describeRetryDecision,
  isTransientTransportError,
  type RetryDecision,
} from "./retry-policy"
import { useConnection } from "../ui/data/connection"
import { useMutation } from "../ui/data/useMutation"
import type { MutationOptions, MutationResult } from "../ui/data/useMutation"

export interface SafeRetryOptions<V, T, C = unknown> extends MutationOptions<V, T, C> {
  /**
   * Describes the underlying request so the policy can classify it. `idempotent`
   * defaults to false — only set it true when repeating the exact request is
   * genuinely harmless. NEVER unlocks a fiscal path (the policy blocks those
   * regardless).
   */
  request: { method: HttpMethod; path: string; idempotent?: boolean }
  /**
   * Maximum automatic re-fires for a safe write before we stop and surface the
   * error for a manual retry. Keeps a permanently-failing endpoint from looping.
   * Default 3.
   */
  maxAutoRetries?: number
}

export interface SafeRetryResult<V, T> extends MutationResult<V, T> {
  /** The policy's verdict for this write (stable for the hook's life). */
  decision: RetryDecision
  /** A calm German line explaining what will (or won't) happen on reconnect. */
  retryHint: string
  /** True while we're holding a failed safe write to re-fire on reconnect. */
  willAutoRetry: boolean
}

export function useSafeRetry<V, T, C = unknown>(
  mutator: (vars: V) => Promise<T>,
  options: SafeRetryOptions<V, T, C>,
): SafeRetryResult<V, T> {
  const { request, maxAutoRetries = 3, ...mutationOptions } = options
  const decision = classifyRetry(request)
  const retryHint = describeRetryDecision(decision)

  const m = useMutation<V, T, C>(mutator, mutationOptions)
  const { status } = useConnection()

  // The last vars of a SAFE write that failed on transport — held so we can
  // re-fire it when we reconnect. Cleared on success or when retries are spent.
  const [pendingVars, setPendingVars] = useState<V | null>(null)
  const attemptsRef = useRef(0)
  const mutateRef = useRef(m.mutate)
  mutateRef.current = m.mutate

  const mutate = useCallback(
    async (vars: V): Promise<T | null> => {
      try {
        const out = await mutateRef.current(vars)
        // Success (including offline-queued, where out is null but no throw):
        // clear any pending re-fire and reset the attempt counter.
        setPendingVars(null)
        attemptsRef.current = 0
        return out
      } catch (err) {
        // Only a SAFE write that failed because the wire was down is remembered.
        // A real server refusal (validation/conflict) is a genuine answer — never
        // re-fired. A fiscal/non-idempotent write is never remembered at all.
        if (decision.safe && isTransientTransportError(err)) {
          setPendingVars(vars)
        }
        throw err
      }
    },
    [decision.safe],
  )

  // When we come back online, re-fire a held safe write — once per reconnect,
  // up to the cap. The mutation's own optimistic/rollback + error handling apply.
  useEffect(() => {
    if (status !== "online" || pendingVars == null) return
    if (attemptsRef.current >= maxAutoRetries) {
      // Out of automatic attempts — stop holding it; the surface shows the error
      // and the operator can retry by hand.
      setPendingVars(null)
      return
    }
    attemptsRef.current += 1
    const vars = pendingVars
    // Clear before firing so a failure inside re-sets it deliberately via mutate.
    setPendingVars(null)
    void mutate(vars).catch(() => {
      // Swallowed: mutate already surfaced the themed error onto the mutation
      // state and (if still transient) re-armed pendingVars for the next online.
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return {
    ...m,
    mutate,
    decision,
    retryHint,
    willAutoRetry: decision.safe && pendingVars != null,
  }
}
