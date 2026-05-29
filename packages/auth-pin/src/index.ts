/**
 * @warehouse14/auth-pin
 *
 * POS PIN authentication primitives, per ADR-0022. This package is
 * **purely functional + sync-async stateless** — it never touches the
 * database. The API caller owns persistence + audit logging.
 *
 * Surface:
 *   • PinPolicy.validate(pin)          — format + blacklist check
 *   • hashPin(pin)                     — argon2id hash, suitable for storage
 *   • verifyPin(plain, hash)           — constant-time verify against a stored hash
 *   • decideAttemptOutcome(state, ok)  — pure state machine for the lockout
 *
 * Threat model + cost analysis lives in ADR-0022 §5.
 */

import { hash, verify } from '@node-rs/argon2';

// ────────────────────────────────────────────────────────────────────────
// 1. PIN strength policy
// ────────────────────────────────────────────────────────────────────────

/**
 * Hand-curated list of the most common 4-digit PINs that any operator
 * "just typing whatever" would reach for. Reflects DataGenetics 2012 +
 * Have-I-Been-Pwned analysis. NOT a substitute for true entropy; only a
 * gate against the most obviously weak choices.
 */
const WEAK_PIN_BLACKLIST: ReadonlySet<string> = new Set([
  // All same digit (10 values)
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  // Sequential ascending (7 values)
  '0123',
  '1234',
  '2345',
  '3456',
  '4567',
  '5678',
  '6789',
  // Sequential descending (7 values)
  '9876',
  '8765',
  '7654',
  '6543',
  '5432',
  '4321',
  '3210',
  // Common-leak top-N — duplicates removed (Set tolerates them but the
  // pre-audit line read as un-reviewed). Source: DataGenetics 2012 + HIBP.
  // '1004' is the Korean street-slang for "angel" — extremely common.
  // '0007' is James Bond. Both kept once.
  '1004',
  '2580',
  '0852',
  '1212',
  '6969',
  '1313',
  '8520',
  '1010',
  '1122',
  '5683',
  '0007',
  '2000',
]);

export type PinValidationError =
  | { code: 'WRONG_LENGTH'; expected: 4; actual: number }
  | { code: 'NON_NUMERIC' }
  | { code: 'BLACKLISTED' };

export interface PinPolicyOptions {
  /**
   * If `true`, the blacklist is enforced (production default).
   * If `false`, ONLY format checks apply — used by dev bootstrap to seed
   * with `0000`. Hard-fail unless the caller proves intent.
   */
  enforceBlacklist: boolean;
}

export const PinPolicy = {
  /**
   * Pure validation. Returns `null` on success, an error tag on failure.
   * Caller maps the tag to a localized message for the UI.
   */
  validate(pin: string, opts: PinPolicyOptions): PinValidationError | null {
    if (pin.length !== 4) {
      return { code: 'WRONG_LENGTH', expected: 4, actual: pin.length };
    }
    if (!/^\d{4}$/.test(pin)) {
      return { code: 'NON_NUMERIC' };
    }
    if (opts.enforceBlacklist && WEAK_PIN_BLACKLIST.has(pin)) {
      return { code: 'BLACKLISTED' };
    }
    return null;
  },

  /** Read-only view of the blacklist — useful for ops tooling. */
  get blacklist(): readonly string[] {
    return [...WEAK_PIN_BLACKLIST];
  },
} as const;

// ────────────────────────────────────────────────────────────────────────
// 2. Argon2id hash + verify
// ────────────────────────────────────────────────────────────────────────

/**
 * argon2id parameters — tuned for the V1 hardware target (Oracle Cloud
 * Always Free ARM64 + Apple Silicon dev). Single-PIN verify under ~100ms,
 * well under the 200ms target for a step-up prompt.
 *
 * If we change parameters later, existing hashes carry their parameters
 * inline (PHC format) so old PINs still verify. The new params apply only
 * to NEW hashes.
 */
const ARGON2_PARAMS = {
  // @node-rs/argon2 defaults to Argon2id — we rely on that and avoid the
  // const-enum import that clashes with `verbatimModuleSyntax: true`.
  // OWASP 2024 baseline for argon2id: m=19 MiB, t=2, p=1.
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash a 4-digit PIN. The caller is responsible for having validated the
 * PIN through `PinPolicy.validate` first — this function does NOT re-check.
 */
export async function hashPin(pin: string): Promise<string> {
  return hash(pin, ARGON2_PARAMS);
}

/**
 * Constant-time compare against an argon2id-encoded hash.
 * Returns `true` on match, `false` otherwise. Never throws on a wrong PIN.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, pin);
  } catch {
    // Malformed stored hash, version mismatch, etc. — treat as failed verify
    // rather than leaking the underlying error to the caller.
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// 3. Brute-force lockout state machine — pure, no I/O
// ────────────────────────────────────────────────────────────────────────

/** Current persistent state of a user's PIN attempts (read from DB). */
export interface AttemptState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

/** Inputs to the decision: state + clock + ok/not-ok of THIS attempt. */
export interface AttemptDecisionInput {
  state: AttemptState;
  now: Date;
  pinCorrect: boolean;
}

/** What the caller should persist + signal back to the route. */
export type AttemptDecision =
  | { kind: 'success'; newState: AttemptState }
  | { kind: 'failed'; newState: AttemptState }
  | { kind: 'failed_now_locked'; newState: AttemptState; auditEventType: 'auth.pin_locked' }
  | { kind: 'already_locked'; until: Date };

export const PIN_FAILED_THRESHOLD = 5;
export const PIN_LOCKOUT_MINUTES = 30;

/**
 * The pure state machine.
 *
 *   • Already locked + lockedUntil > now → 'already_locked' (do not even verify).
 *   • Lock expired       → treat counter as fresh; verify; on success clear lock.
 *   • Wrong PIN          → failedAttempts++; if = THRESHOLD → lock for MINUTES.
 *   • Right PIN          → reset counter + clear lockedUntil.
 *
 * Caller persists `newState` AND emits the suggested audit event.
 */
export function decideAttemptOutcome(input: AttemptDecisionInput): AttemptDecision {
  const { state, now, pinCorrect } = input;

  // 1. Refuse even reading the PIN if the user is currently locked.
  if (state.lockedUntil && state.lockedUntil > now) {
    return { kind: 'already_locked', until: state.lockedUntil };
  }

  // 2. The lock has expired (or never fired) — treat as fresh attempt.
  if (pinCorrect) {
    return {
      kind: 'success',
      newState: { failedAttempts: 0, lockedUntil: null },
    };
  }

  // 3. Wrong PIN. Bump counter; lock if we just crossed the threshold.
  const newCount = (state.lockedUntil ? 0 : state.failedAttempts) + 1;
  if (newCount >= PIN_FAILED_THRESHOLD) {
    const lockoutEnd = new Date(now.getTime() + PIN_LOCKOUT_MINUTES * 60_000);
    return {
      kind: 'failed_now_locked',
      newState: { failedAttempts: newCount, lockedUntil: lockoutEnd },
      auditEventType: 'auth.pin_locked',
    };
  }
  return {
    kind: 'failed',
    newState: { failedAttempts: newCount, lockedUntil: null },
  };
}

// ────────────────────────────────────────────────────────────────────────
// 4. Storefront password helpers (Day 19).
//
// Shoppers (B2C) use email + password, not a 4-digit PIN. Internally the
// hashing uses the same argon2id parameters; we expose dedicated aliases +
// a separate strength validator so call sites read clearly.
//
// Password policy (memory.md #65):
//   • Minimum length 10 chars (NIST 800-63B baseline for unblocked accounts).
//   • Rejected if it matches the email (case-insensitive).
//   • Rejected if entirely numeric (the PIN's space — too easy to brute force
//     when wrapped in cookie auth instead of mTLS).
//   • No max-length cap below 128 (argon2id handles arbitrary inputs).
//
// Lockout is the same `decideAttemptOutcome` state machine — shoppers and
// staff share the budget of 5 attempts → 30-minute lock.
// ────────────────────────────────────────────────────────────────────────

export type PasswordValidationError =
  | { code: 'TOO_SHORT'; min: number; actual: number }
  | { code: 'TOO_LONG'; max: number; actual: number }
  | { code: 'MATCHES_EMAIL' }
  | { code: 'ALL_DIGITS' };

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordPolicyContext {
  /** The email being registered — used to refuse password === email. Optional. */
  email?: string;
}

export const PasswordPolicy = {
  validate(pw: string, ctx: PasswordPolicyContext = {}): PasswordValidationError | null {
    if (pw.length < PASSWORD_MIN_LENGTH) {
      return { code: 'TOO_SHORT', min: PASSWORD_MIN_LENGTH, actual: pw.length };
    }
    if (pw.length > PASSWORD_MAX_LENGTH) {
      return { code: 'TOO_LONG', max: PASSWORD_MAX_LENGTH, actual: pw.length };
    }
    if (ctx.email && pw.trim().toLowerCase() === ctx.email.trim().toLowerCase()) {
      return { code: 'MATCHES_EMAIL' };
    }
    if (/^\d+$/.test(pw)) {
      return { code: 'ALL_DIGITS' };
    }
    return null;
  },
} as const;

/** Alias for clarity — shoppers hash passwords, not PINs. */
export const hashPassword = hashPin;
export const verifyPassword = verifyPin;
