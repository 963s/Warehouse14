/**
 * Local device quick-unlock code — the mobile mirror of the desktop
 * `apps/tauri-pos/src/lib/local-lock.ts`.
 *
 * A per-device 4-digit code that gates an ALREADY-authenticated Google session:
 * fast re-entry after a cold start or after the app was backgrounded, so a
 * grabbed phone cannot just walk in. It is NEVER the authentication secret — the
 * real identity is the Google session. Only a salted SHA-256 hash of the code
 * lives on THIS device, in the OS Keychain / Keystore (expo-secure-store); it is
 * never sent to the server.
 */
import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"

const KEY = "w14.local-pin"

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

/** Has a local code been set on this device? */
export async function hasLocalPin(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) !== null
  } catch {
    return false
  }
}

/** Set (or replace) the local code — stores salt:hash only. */
export async function setLocalPin(pin: string): Promise<void> {
  const salt = randomSalt()
  const hash = await sha256Hex(salt + pin)
  await SecureStore.setItemAsync(KEY, `${salt}:${hash}`)
}

/** Verify a candidate code against the stored hash. */
export async function verifyLocalPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(KEY).catch(() => null)
  if (!stored) return false
  const idx = stored.indexOf(":")
  if (idx <= 0) return false
  const salt = stored.slice(0, idx)
  const hash = stored.slice(idx + 1)
  const candidate = await sha256Hex(salt + pin)
  return candidate === hash
}

/** Remove the local code (e.g. on sign-out). */
export async function clearLocalPin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY)
  } catch {
    // ignore
  }
}
