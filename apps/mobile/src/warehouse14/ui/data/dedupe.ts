/**
 * In-flight request de-duplication.
 *
 * When two components mount the same query at the same moment — say the
 * Schatzkammer header and a child both want `bridgeSummary()` keyed
 * `"bridge"` — we must not fire two identical requests at the LAN dev backend.
 * `dedupe(key, fn)` returns the SAME promise to every caller that asks for an
 * already-in-flight key, and clears the slot the moment it settles so the next
 * refetch starts a fresh request.
 *
 * This is deliberately a tiny module-level Map (not a cache): it de-dupes
 * *concurrent* calls only and never holds onto resolved data. Caching /
 * stale-while-revalidate lives in `useQuery` where it belongs.
 */

/**
 * A slot holds the shared promise plus a unique token, so a settling request
 * only clears the map entry it actually owns (a newer refetch may have already
 * replaced it in a pathological race).
 */
interface Slot {
  promise: Promise<unknown>
  token: symbol
}

const inFlight = new Map<string, Slot>()

/**
 * Share one in-flight promise per `key`. The first caller runs `fn`; concurrent
 * callers with the same key get the same promise. The slot clears on settle.
 *
 * Passing no key (or via the un-keyed callers) is handled upstream — this
 * function always expects a concrete key.
 */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing.promise as Promise<T>

  const token = Symbol(key)
  const promise = (async () => {
    try {
      return await fn()
    } finally {
      // Clear only if we still own this slot — a newer refetch may have taken
      // it over with a different token in a pathological race.
      if (inFlight.get(key)?.token === token) inFlight.delete(key)
    }
  })()

  inFlight.set(key, { promise, token })
  return promise
}

/** True if a request for `key` is currently in flight. (Test / introspection.) */
export function isInFlight(key: string): boolean {
  return inFlight.has(key)
}

/** Drop any in-flight slot for `key` without cancelling its promise. (Tests.) */
export function clearInFlight(key?: string): void {
  if (key == null) inFlight.clear()
  else inFlight.delete(key)
}
