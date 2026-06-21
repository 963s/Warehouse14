/**
 * Request gate — a tiny client-side concurrency limiter that keeps a single
 * screen load from firing a whole fan-out at the backend in one burst.
 *
 * Why this exists: the Schatzkammer dashboard lights up from ~10 independent
 * read endpoints. Without a gate, `Promise.allSettled([...])` opens all ten
 * sockets in the same tick. The api-cloud read budget is a sliding 10/min, so
 * one open + one focus-refetch inside a minute trivially trips RATE_LIMITED and
 * the owner sees the "Zu viele Versuche" storm. Coalescing identical in-flight
 * keys (see dedupe.ts) does NOT help here — the ten reads are ten *different*
 * endpoints, so there is nothing to coalesce.
 *
 * The gate caps how many reads are in flight at once and queues the overflow,
 * so the same ten requests still all run — just spread over a few ticks instead
 * of one burst. It is a politeness valve, not a cache: it holds no data and
 * fabricates nothing. A queued task runs the moment a slot frees, so total
 * latency is barely affected on a healthy network while the peak request rate
 * stays well under the budget.
 *
 * Honesty rule: the gate only schedules WHEN a real request runs. It never
 * substitutes a value, never resolves early, and propagates every rejection
 * untouched — the caller sees the exact same result it would without the gate.
 */

/** A queued unit of work plus the resolvers that settle the caller's promise. */
interface Waiter<T> {
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export interface RequestGate {
  /**
   * Run `task` under the gate. If a slot is free it starts immediately;
   * otherwise it waits FIFO until one frees. Resolves/rejects with exactly what
   * `task` resolves/rejects — the gate is transparent.
   */
  run<T>(task: () => Promise<T>): Promise<T>
  /** Reads currently executing (occupying a slot). Test / introspection. */
  active(): number
  /** Reads waiting for a slot. Test / introspection. */
  pending(): number
}

/**
 * Build a gate that allows at most `maxConcurrent` tasks to run at once.
 * Default 4 — enough that a fan-out still feels instant on a fast network, low
 * enough that ten dashboard reads land as ~3 small waves rather than one burst
 * that overruns the per-minute budget.
 */
export function createRequestGate(maxConcurrent = 4): RequestGate {
  const limit = Math.max(1, Math.floor(maxConcurrent))
  let inFlight = 0
  const queue: Waiter<unknown>[] = []

  function pump(): void {
    while (inFlight < limit && queue.length > 0) {
      const waiter = queue.shift()!
      inFlight++
      // Run detached; settle the caller, then free the slot and pump again.
      void (async () => {
        try {
          const value = await waiter.task()
          waiter.resolve(value)
        } catch (err) {
          waiter.reject(err)
        } finally {
          inFlight--
          pump()
        }
      })()
    }
  }

  function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      pump()
    })
  }

  return {
    run,
    active: () => inFlight,
    pending: () => queue.length,
  }
}

/**
 * The app-wide read gate. There is one cloud and one per-minute budget, so a
 * single shared gate across every surface is the honest model: if two screens
 * happen to load at once, their reads share the same valve and still stay under
 * budget. Mutations do NOT go through here — a write the operator committed to
 * must never wait behind a background poll.
 */
export const readGate: RequestGate = createRequestGate(4)
