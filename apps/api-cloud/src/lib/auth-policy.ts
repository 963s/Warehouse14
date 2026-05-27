/**
 * Auth policy primitives — typed errors + route helpers.
 *
 * The route layer calls `requireAuth(req)`, `requireRole(req, 'ADMIN')`,
 * `requireOwner(req)`, `requireStepUp(req, { maxAgeMinutes })`. Each throws
 * a typed DomainError when the precondition fails; the error-handler plugin
 * from Day 11 maps it to the right HTTP status + stable error code.
 *
 * Basel Day-12b directive: step-up window = 10 minutes for sensitive actions.
 */

import type { FastifyRequest } from 'fastify';

import { DomainError, type ApiErrorCode } from '../plugins/error-handler.js';
import type { Actor, ActorRole, ActorWithSession } from './actor.js';

/** Default step-up freshness window for sensitive actions (ADR-0022 §4c + Basel directive). */
export const STEP_UP_WINDOW_MINUTES = 10;

// ────────────────────────────────────────────────────────────────────────
// Typed errors — picked up by plugins/error-handler.ts.
// ────────────────────────────────────────────────────────────────────────

export class UnauthorizedError extends DomainError {
  public readonly httpStatus = 401;
  public readonly code: ApiErrorCode = 'UNAUTHORIZED';
}

export class ForbiddenError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'FORBIDDEN';
}

export class StepUpRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'STEP_UP_REQUIRED';
  public readonly windowMinutes: number;
  public constructor(windowMinutes: number) {
    super(`PIN step-up required (within last ${windowMinutes} minutes)`);
    this.windowMinutes = windowMinutes;
  }
}

export class PinLockedError extends DomainError {
  public readonly httpStatus = 423;
  public readonly code: ApiErrorCode = 'PIN_LOCKED';
  public readonly lockedUntil: Date;
  public constructor(lockedUntil: Date) {
    super(`PIN locked until ${lockedUntil.toISOString()} — Full Login required to unlock`);
    this.lockedUntil = lockedUntil;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Request decorations — populated by the auth plugin.
// ────────────────────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    /** `null` on unauthenticated / public routes. */
    actor: Actor | null;
    /** `null` on unauthenticated / public routes. */
    session: ActorWithSession | null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Guards.
// ────────────────────────────────────────────────────────────────────────

/** Throws if no actor — i.e. the request is not authenticated. */
export function requireAuth(req: FastifyRequest): asserts req is FastifyRequest & {
  actor: Actor;
  session: ActorWithSession;
} {
  if (!req.actor || !req.session) {
    throw new UnauthorizedError('Authentication required');
  }
}

/** Requires that the actor has one of the listed roles. */
export function requireRole(req: FastifyRequest, ...roles: ActorRole[]): void {
  requireAuth(req);
  if (!roles.includes(req.actor.role)) {
    throw new ForbiddenError(
      `Role required: ${roles.join(' | ')}; actor role is ${req.actor.role}`,
    );
  }
}

/**
 * Requires that the actor is the Owner. Combines `requireAuth` + the
 * `is_owner` bit. Used for the rare Owner-only routes (manual ledger
 * rollover, manual KYC purge initiation, etc.).
 */
export function requireOwner(req: FastifyRequest): void {
  requireAuth(req);
  if (!req.actor.isOwner) {
    throw new ForbiddenError('Owner-only operation');
  }
}

/**
 * Requires that the current session has a PIN step-up within the last
 * `maxAgeMinutes` (default 10). On failure, throws a StepUpRequiredError
 * which the front-end catches and shows the PIN prompt.
 *
 * Basel directive (Day 12b): step-up validity = 10 minutes maximum.
 */
export function requireStepUp(
  req: FastifyRequest,
  opts: { maxAgeMinutes?: number; now?: Date } = {},
): void {
  const window = opts.maxAgeMinutes ?? STEP_UP_WINDOW_MINUTES;
  const now = opts.now ?? new Date();

  requireAuth(req);
  const last = req.session.lastPinStepUpAt;
  if (!last) {
    throw new StepUpRequiredError(window);
  }
  const ageMs = now.getTime() - last.getTime();
  if (ageMs < 0 || ageMs > window * 60_000) {
    throw new StepUpRequiredError(window);
  }
}

/**
 * Composed helper: Owner-only + step-up fresh. Common pattern for
 * destructive single-actor operations.
 */
export function requireOwnerStepUp(req: FastifyRequest): void {
  requireOwner(req);
  requireStepUp(req);
}
