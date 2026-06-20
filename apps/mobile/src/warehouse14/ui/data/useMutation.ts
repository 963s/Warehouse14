/**
 * useMutation — the write side of the live-data layer.
 *
 * Wraps a mutating call from `../../api` (createTask, transitionTask,
 * setAppointmentStatus, …) and gives every surface the same fast, trustworthy
 * write UX:
 *
 *   • `isPending` for disabling the button / showing a spinner,
 *   • a themed German `error` on failure,
 *   • optional OPTIMISTIC update with automatic ROLLBACK on failure, so a tap
 *     feels instant but never lies if the server says no,
 *   • the offline-queued-as-success semantic: `ApiOfflineQueuedError` is the
 *     operator's intent landing safely in the outbox, so we resolve `onSuccess`
 *     and report `queuedOffline: true` instead of throwing a red error,
 *   • step-up is already transparent (stepUpMiddleware re-auths + retries inside
 *     the api call), so a normal mutation needs no special handling here.
 *
 * Optimistic pattern (e.g. a task status chip):
 *
 *   const m = useMutation(
 *     (vars: { id: string; body: TransitionTaskBody }) =>
 *       transitionTask(vars.id, vars.body),
 *     {
 *       optimistic: {
 *         apply: (vars) => {
 *           const prev = task
 *           setTask({ ...task, status: vars.body.status })  // instant
 *           return prev                                       // rollback token
 *         },
 *         rollback: (prev) => setTask(prev),                  // on failure
 *       },
 *       onSuccess: (row) => setTask(row),                     // reconcile real
 *     },
 *   )
 *   await m.mutate({ id, body })
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ApiOfflineQueuedError } from "@warehouse14/api-client"

import { describeError } from "../../api"

/**
 * Optimistic contract. `apply` runs synchronously BEFORE the request and
 * returns a rollback token (the previous state) of type `C`; `rollback(token)`
 * restores it if the request fails. Keep both pure UI-state writes.
 */
export interface OptimisticConfig<V, C> {
  apply: (vars: V) => C
  rollback: (context: C) => void
}

export interface MutationOptions<V, T, C = unknown> {
  optimistic?: OptimisticConfig<V, C>
  /** Called after a successful (or offline-queued) write. */
  onSuccess?: (data: T | null, vars: V, queuedOffline: boolean) => void
  /** Called after a real failure (NOT offline-queued), post-rollback. */
  onError?: (error: unknown, vars: V) => void
  /** Always called after the attempt settles (success, queued, or error). */
  onSettled?: (vars: V) => void
}

export interface MutationState<T> {
  /** True while the request is in flight. */
  isPending: boolean
  /** Themed German error from the last failed attempt, or `null`. */
  error: string | null
  /** Raw thrown value behind `error`, for `instanceof` checks. */
  errorCause: unknown
  /** The last successful response, or `null`. */
  data: T | null
  /** True if the last settled attempt was durably queued offline (a success). */
  queuedOffline: boolean
}

export interface MutationResult<V, T> extends MutationState<T> {
  /**
   * Run the mutation. Resolves with the response on success, or `null` when
   * the write was offline-queued. REJECTS on a real failure (after rollback),
   * so callers may `try/catch` — `onError` also fires. Inspect `error` for the
   * themed message either way.
   */
  mutate: (vars: V) => Promise<T | null>
  /** Clear `error` / `data` / `queuedOffline` back to the resting state. */
  reset: () => void
}

const RESTING = {
  isPending: false,
  error: null,
  errorCause: null,
  queuedOffline: false,
} as const

export function useMutation<V, T, C = unknown>(
  mutator: (vars: V) => Promise<T>,
  options: MutationOptions<V, T, C> = {},
): MutationResult<V, T> {
  const [state, setState] = useState<MutationState<T>>({ ...RESTING, data: null })

  const mounted = useRef(true)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const mutatorRef = useRef(mutator)
  mutatorRef.current = mutator

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const mutate = useCallback(async (vars: V): Promise<T | null> => {
    const opts = optionsRef.current
    // Apply the optimistic change up-front; remember the rollback token.
    let context: C | undefined
    let didApply = false
    if (opts.optimistic) {
      context = opts.optimistic.apply(vars)
      didApply = true
    }

    if (mounted.current) {
      setState((s) => ({ ...s, isPending: true, error: null, errorCause: null }))
    }

    try {
      const data = await mutatorRef.current(vars)
      if (mounted.current) {
        setState({ ...RESTING, data })
      }
      opts.onSuccess?.(data, vars, false)
      opts.onSettled?.(vars)
      return data
    } catch (err) {
      // Offline-queued is a SUCCESS for the operator: intent is durably saved.
      // Keep the optimistic UI, surface a calm "queued" flag, do not roll back.
      if (err instanceof ApiOfflineQueuedError) {
        if (mounted.current) {
          setState({ ...RESTING, data: null, queuedOffline: true })
        }
        opts.onSuccess?.(null, vars, true)
        opts.onSettled?.(vars)
        return null
      }
      // Real failure → roll the optimistic change back, then report.
      if (didApply && opts.optimistic && context !== undefined) {
        opts.optimistic.rollback(context)
      }
      if (mounted.current) {
        setState((s) => ({
          ...s,
          isPending: false,
          error: describeError(err),
          errorCause: err,
        }))
      }
      opts.onError?.(err, vars)
      opts.onSettled?.(vars)
      throw err
    }
  }, [])

  const reset = useCallback(() => {
    if (mounted.current) setState({ ...RESTING, data: null })
  }, [])

  return { ...state, mutate, reset }
}
