/**
 * Local device quick-unlock code (Track A2).
 *
 * A per-device 4-digit code that gates an ALREADY-authenticated Google session:
 * fast re-entry after a cold start or idle timeout, so a grabbed machine cannot
 * just walk in. It is NEVER the authentication secret — the real identity is the
 * Google session. Only a salted SHA-256 hash of the code lives on THIS device
 * (localStorage); it is never sent to the server.
 *
 * Go-live note: mirror `session-token.ts` and move this into the OS keychain so
 * XSS cannot read the hash. localStorage is the scaffold.
 */

const KEY = 'w14.local-pin';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return toHex(b);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return toHex(new Uint8Array(buf));
}

/** Has a local code been set on this device? */
export function hasLocalPin(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/** Set (or replace) the local code — stores salt:hash only. */
export async function setLocalPin(pin: string): Promise<void> {
  const salt = randomSalt();
  const hash = await sha256Hex(salt + pin);
  localStorage.setItem(KEY, `${salt}:${hash}`);
}

/** Verify a candidate code against the stored hash. */
export async function verifyLocalPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(KEY);
  if (!stored) return false;
  const idx = stored.indexOf(':');
  if (idx <= 0) return false;
  const salt = stored.slice(0, idx);
  const hash = stored.slice(idx + 1);
  const candidate = await sha256Hex(salt + pin);
  return candidate === hash;
}

/** Remove the local code (e.g. on sign-out). */
export function clearLocalPin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
