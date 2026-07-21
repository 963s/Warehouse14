/**
 * Local device quick-unlock code — the mobile mirror of the desktop
 * `apps/tauri-pos/src/lib/local-lock.ts`.
 *
 * A per-device 4-digit code that gates an ALREADY-authenticated Google session:
 * fast re-entry after a cold start or after the app was backgrounded, so a
 * grabbed phone cannot just walk in. It is NEVER the authentication secret — the
 * real identity is the Google session.
 *
 * Security review 2026-07-21 — a 4-digit code is a 10,000 keyspace, so the ONLY
 * meaningful defenses are:
 *   1. Store the hash in the hardware-backed Keychain / Keystore (expo-secure-
 *      store) — never plaintext, never sent to the server. (at-rest)
 *   2. Bound how many guesses are even possible: escalating lockout after a few
 *      wrong tries, and a WIPE after WIPE_AFTER — the code is cleared and the
 *      session dropped, forcing a full Google re-login. An attacker gets at most
 *      WIPE_AFTER of the 10,000 guesses before the device is useless. (online)
 *   3. A bounded key-stretch (STRETCH_ROUNDS of SHA-256) raises the cost of an
 *      OFFLINE crack of a pulled hash. A 4-digit secret can never be made
 *      GPU-proof by stretching alone, so (2) is the real control; (3) is
 *      defense in depth. The attempt state itself lives in secure-store so
 *      relaunching the app cannot reset the counter.
 */
import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"

const KEY = "w14.local-pin"
const ATTEMPTS_KEY = "w14.local-pin.attempts"

/** Wrong tries before the local code + session are WIPED (forces Google re-login). */
export const WIPE_AFTER = 10
/** Bounded key-stretch rounds (defense-in-depth for an offline crack). */
const STRETCH_ROUNDS = 1200
/** Current stored-format version tag. */
const FORMAT = "v2"

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function randomSalt(): string {
  return toHex(Crypto.getRandomBytes(16))
}

function sha256Hex(s: string): Promise<string> {
  // digestStringAsync returns lowercase hex by default (CryptoEncoding.HEX).
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s)
}

/** Bounded iterated SHA-256 — a poor-man KDF within expo-crypto's primitives. */
async function stretch(salt: string, pin: string): Promise<string> {
  let h = await sha256Hex(`${salt}:${pin}`)
  for (let i = 0; i < STRETCH_ROUNDS; i++) {
    h = await sha256Hex(`${salt}:${h}`)
  }
  return h
}

export type LocalPinState = "set" | "unset" | "error"

/**
 * Tri-state read of the device code. "unset" means the keystore ANSWERED with
 * no value (first run — creating a code is legitimate); "error" means the read
 * itself failed (transient Android keystore failures are real). The gate must
 * FAIL CLOSED on "error": treating it as "unset" would let any holder of the
 * phone set a fresh code over the owner's and walk in.
 */
export async function readLocalPinState(): Promise<LocalPinState> {
  try {
    return (await SecureStore.getItemAsync(KEY)) !== null ? "set" : "unset"
  } catch {
    return "error"
  }
}

/** Set (or replace) the local code — stores v2:salt:stretchedHash. Clears attempts. */
export async function setLocalPin(pin: string): Promise<void> {
  const salt = randomSalt()
  const hash = await stretch(salt, pin)
  await SecureStore.setItemAsync(KEY, `${FORMAT}:${salt}:${hash}`)
  await clearAttempts()
}

/**
 * Verify a candidate code. Handles BOTH the new v2 stretched format and the
 * legacy `salt:hash` single-round format (so an existing device is not locked
 * out on upgrade); a successful legacy verify silently re-hashes to v2.
 */
export async function verifyLocalPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(KEY).catch(() => null)
  if (!stored) return false

  if (stored.startsWith(`${FORMAT}:`)) {
    const rest = stored.slice(FORMAT.length + 1)
    const idx = rest.indexOf(":")
    if (idx <= 0) return false
    const salt = rest.slice(0, idx)
    const hash = rest.slice(idx + 1)
    return (await stretch(salt, pin)) === hash
  }

  // Legacy v1 (single-round salt:hash) — verify, and on success upgrade to v2.
  const idx = stored.indexOf(":")
  if (idx <= 0) return false
  const salt = stored.slice(0, idx)
  const legacyHash = stored.slice(idx + 1)
  const ok = (await sha256Hex(salt + pin)) === legacyHash
  if (ok) await setLocalPin(pin) // migrate to the stretched format
  return ok
}

// ── Brute-force lockout state (persisted, so a relaunch cannot reset it) ─────

export interface AttemptState {
  /** Consecutive wrong attempts since the last success. */
  fails: number
  /** Epoch ms until which entry is locked (0 = not locked). */
  lockedUntil: number
}

const ZERO: AttemptState = { fails: 0, lockedUntil: 0 }

export async function readAttempts(): Promise<AttemptState> {
  try {
    const raw = await SecureStore.getItemAsync(ATTEMPTS_KEY)
    if (!raw) return { ...ZERO }
    const p = JSON.parse(raw) as Partial<AttemptState>
    return {
      fails: typeof p.fails === "number" ? p.fails : 0,
      lockedUntil: typeof p.lockedUntil === "number" ? p.lockedUntil : 0,
    }
  } catch {
    return { ...ZERO }
  }
}

async function writeAttempts(s: AttemptState): Promise<void> {
  try {
    await SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify(s))
  } catch {
    // best-effort; the gate still enforces the in-memory count this session.
  }
}

/** Reset the attempt counter (on a correct code). */
export async function clearAttempts(): Promise<void> {
  await writeAttempts({ ...ZERO })
}

/** Escalating lock window (ms) for the Nth consecutive failure. */
function lockMsFor(fails: number): number {
  if (fails >= 9) return 15 * 60_000
  if (fails >= 7) return 5 * 60_000
  if (fails >= 5) return 60_000
  if (fails >= 3) return 15_000
  return 0
}

export interface FailResult extends AttemptState {
  /** True when this failure crossed WIPE_AFTER — the code + session were wiped. */
  wiped: boolean
}

/**
 * Record one wrong code. Escalates the lock window and, at WIPE_AFTER, WIPES the
 * local code (clearLocalPin) — the caller must then drop the session so the only
 * way back in is a fresh Google login.
 */
export async function recordFailedAttempt(): Promise<FailResult> {
  const prev = await readAttempts()
  const fails = prev.fails + 1
  if (fails >= WIPE_AFTER) {
    await clearLocalPin()
    await clearAttempts()
    return { fails, lockedUntil: 0, wiped: true }
  }
  const lockMs = lockMsFor(fails)
  const lockedUntil = lockMs > 0 ? Date.now() + lockMs : 0
  const next: AttemptState = { fails, lockedUntil }
  await writeAttempts(next)
  return { ...next, wiped: false }
}

/** Remove the local code (e.g. on sign-out). Also clears the attempt counter. */
export async function clearLocalPin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY)
  } catch {
    // ignore
  }
  await clearAttempts()
}
