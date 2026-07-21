/**
 * Local device quick-unlock code (Track A2).
 *
 * A per-device 4-digit code that gates an ALREADY-authenticated Google session:
 * fast re-entry after a cold start or idle timeout, so a grabbed machine cannot
 * just walk in. It is NEVER the authentication secret — the real identity is the
 * Google session. The hash lives on THIS device (localStorage); it is never
 * sent to the server.
 *
 * Security review 2026-07-21 — a 4-digit code is a 10,000 keyspace, so the real
 * defenses are: (1) a proper KDF (Web Crypto PBKDF2, 100k rounds) instead of a
 * single SHA-256, raising the cost of an offline crack of a pulled hash; and
 * (2) an escalating lockout + WIPE-after-N so only a handful of the 10,000
 * guesses are ever possible online — after WIPE_AFTER wrong tries the code is
 * cleared and the caller drops the session, forcing a fresh Google login. The
 * attempt counter is persisted so a reload cannot reset it.
 *
 * Go-live note (unchanged): move this + `session-token.ts` into the OS keychain
 * (a Tauri Rust command) so an XSS cannot read the hash. localStorage is the
 * scaffold — the KDF + lockout here are the brute-force controls regardless.
 */

const KEY = 'w14.local-pin';
const ATTEMPTS_KEY = 'w14.local-pin.attempts';

/** Wrong tries before the local code is WIPED (forces a fresh Google login). */
export const WIPE_AFTER = 10;
/** PBKDF2 rounds — Web Crypto runs these natively, so this is cheap on unlock. */
const PBKDF2_ROUNDS = 100_000;
const FORMAT = 'v2';

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

/** Real PBKDF2 (SHA-256) via Web Crypto — the desktop's proper KDF. */
async function pbkdf2Hex(salt: string, pin: string, rounds: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: rounds, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/** Has a local code been set on this device? */
export function hasLocalPin(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/** Set (or replace) the local code — stores v2:rounds:salt:hash. Clears attempts. */
export async function setLocalPin(pin: string): Promise<void> {
  const salt = randomSalt();
  const hash = await pbkdf2Hex(salt, pin, PBKDF2_ROUNDS);
  localStorage.setItem(KEY, `${FORMAT}:${PBKDF2_ROUNDS}:${salt}:${hash}`);
  clearAttempts();
}

/**
 * Verify a candidate code. Handles BOTH the new v2 PBKDF2 format and the legacy
 * `salt:hash` single-round format (so an existing device is not locked out on
 * upgrade); a successful legacy verify silently re-hashes to v2.
 */
export async function verifyLocalPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(KEY);
  if (!stored) return false;

  if (stored.startsWith(`${FORMAT}:`)) {
    const [, roundsStr, salt, hash] = stored.split(':');
    if (roundsStr == null || salt == null || hash == null) return false;
    const rounds = Number.parseInt(roundsStr, 10);
    if (!Number.isFinite(rounds) || rounds < 1) return false;
    return (await pbkdf2Hex(salt, pin, rounds)) === hash;
  }

  // Legacy v1 (single-round salt:hash) — verify, and on success upgrade to v2.
  const idx = stored.indexOf(':');
  if (idx <= 0) return false;
  const salt = stored.slice(0, idx);
  const legacyHash = stored.slice(idx + 1);
  const ok = (await sha256Hex(salt + pin)) === legacyHash;
  if (ok) await setLocalPin(pin);
  return ok;
}

// ── Brute-force lockout state (persisted, so a reload cannot reset it) ────────

export interface AttemptState {
  fails: number;
  /** Epoch ms until which entry is locked (0 = open). */
  lockedUntil: number;
}

const ZERO: AttemptState = { fails: 0, lockedUntil: 0 };

export function readAttempts(): AttemptState {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return { ...ZERO };
    const p = JSON.parse(raw) as Partial<AttemptState>;
    return {
      fails: typeof p.fails === 'number' ? p.fails : 0,
      lockedUntil: typeof p.lockedUntil === 'number' ? p.lockedUntil : 0,
    };
  } catch {
    return { ...ZERO };
  }
}

function writeAttempts(s: AttemptState): void {
  try {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(s));
  } catch {
    // best-effort
  }
}

export function clearAttempts(): void {
  writeAttempts({ ...ZERO });
}

function lockMsFor(fails: number): number {
  if (fails >= 9) return 15 * 60_000;
  if (fails >= 7) return 5 * 60_000;
  if (fails >= 5) return 60_000;
  if (fails >= 3) return 15_000;
  return 0;
}

export interface FailResult extends AttemptState {
  /** True when this failure crossed WIPE_AFTER — the code was WIPED. */
  wiped: boolean;
}

/**
 * Record one wrong code. Escalates the lock window and, at WIPE_AFTER, WIPES the
 * local code — the caller must then drop the session so the only way back in is
 * a fresh Google login.
 */
export function recordFailedAttempt(): FailResult {
  const prev = readAttempts();
  const fails = prev.fails + 1;
  if (fails >= WIPE_AFTER) {
    clearLocalPin();
    clearAttempts();
    return { fails, lockedUntil: 0, wiped: true };
  }
  const lockMs = lockMsFor(fails);
  const lockedUntil = lockMs > 0 ? Date.now() + lockMs : 0;
  const next: AttemptState = { fails, lockedUntil };
  writeAttempts(next);
  return { ...next, wiped: false };
}

/** Remove the local code (e.g. on sign-out). Also clears the attempt counter. */
export function clearLocalPin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  clearAttempts();
}
