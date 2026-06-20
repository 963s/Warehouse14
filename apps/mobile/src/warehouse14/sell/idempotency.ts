/**
 * idempotency — the at-most-once key for a money-path commit.
 *
 * Both finalize (Verkauf) and ankauf (Ankauf) take an `idempotencyKey`: a
 * UUIDv4 generated ONCE when the Bezahlen sheet opens and sent UNCHANGED on
 * every retry (double-tap, step-up cancel-resume, lost-response retry). The
 * server's partial UNIQUE INDEX guarantees the same key never books a second
 * transaction — a duplicate returns the original row, not a second sale/payout
 * (see transactions.ts FinalizeBody/AnkaufBody §19.2 C-4).
 *
 * RN has no `crypto.randomUUID`, but `react-native-get-random-values` (a hard
 * app dependency, imported once at the app entry) polyfills
 * `crypto.getRandomValues`, which is all we need for a spec-correct v4. We fall
 * back to `crypto.randomUUID` when a runtime does provide it, and only as a last
 * resort to `Math.random` — that path is non-cryptographic but the key only
 * needs to be unique-per-open, and the server's UNIQUE INDEX is the real guard.
 */

/** A UUIDv4 string suitable for a finalize/ankauf `idempotencyKey`. */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined

  // Best: a native randomUUID when the runtime offers it.
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID()
  }

  // Standard: build a v4 from 16 cryptographically-random bytes (the
  // react-native-get-random-values polyfill provides getRandomValues).
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    return formatUuidV4(bytes)
  }

  // Last resort: non-crypto randomness. Unique-per-open is enough here because
  // the server's UNIQUE INDEX is the authoritative at-most-once guard.
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  return formatUuidV4(bytes)
}

/** Stamp the version (4) + variant (RFC 4122) bits and hex-format a v4 UUID. */
function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // variant 10xx
  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, "0"))
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  )
}
