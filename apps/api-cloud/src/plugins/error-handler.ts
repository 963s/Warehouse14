/**
 * Centralized error handling.
 *
 * Two responsibilities:
 *   1. Map *typed domain errors* from workspace packages (`inventory-lock`,
 *      `audit`, future `domain` lib) to HTTP responses. Routes don't try/catch
 *      these — they let them bubble.
 *   2. Map *raw Postgres errors* (foreign-key violation, check violation
 *      surfaced by the new migration-0013 triggers) to HTTP responses with a
 *      stable error code so the front-end can react.
 *
 * Anything else is treated as a 500 + Pino error log. Future Sentry hook lives
 * here.
 */

import fastifyPlugin from 'fastify-plugin';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

/** Stable error codes — front-end maps these, not status codes. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'STEP_UP_REQUIRED'
  | 'PIN_LOCKED'
  | 'CONFLICT'
  | 'SANCTIONS_BLOCK'
  | 'CLOSING_DAY_FINALIZED'
  | 'STORNO_OF_STORNO'
  | 'PRODUCT_NOT_RESERVABLE'
  | 'DEVICE_NOT_AUTHORIZED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Validation errors carry per-field detail; nothing else uses this. */
    details?: unknown;
    /** Correlation ID — same as `x-request-id` response header. */
    requestId: string;
  };
}

/** Base class for typed domain errors thrown from workspace packages. */
export abstract class DomainError extends Error {
  public abstract readonly httpStatus: number;
  public abstract readonly code: ApiErrorCode;
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Translate a known PG error message into a stable `ApiErrorCode`.
 *
 * Postgres surfaces the trigger's RAISE message verbatim via the
 * `error.message` field, plus an SQLSTATE like `23514` (check_violation).
 * The triggers we added in migration 0013 prefix their messages with stable
 * tokens that we match here — no regex on free German prose.
 */
function pgErrorToCode(err: FastifyError & { code?: string }): ApiErrorCode | null {
  const msg = err.message ?? '';
  if (msg.includes('Sanctions hard-block')) return 'SANCTIONS_BLOCK';
  if (msg.includes('Closing-day guard')) return 'CLOSING_DAY_FINALIZED';
  if (msg.includes('transactions_ankauf_requires_customer')) return 'VALIDATION_ERROR';
  if (msg.includes('transactions_one_storno_per_original_uq')) return 'CONFLICT';
  if (msg.includes('appointments_one_transaction_link_uq')) return 'CONFLICT';
  if (msg.includes('Cannot storno') && msg.includes('it is itself a storno')) return 'STORNO_OF_STORNO';
  if (err.code === '23505') return 'CONFLICT';        // unique_violation
  if (err.code === '23503') return 'CONFLICT';        // foreign_key_violation
  if (err.code === '23514') return 'CONFLICT';        // check_violation (fallback)
  if (err.code === '23502') return 'VALIDATION_ERROR'; // not_null_violation
  return null;
}

const codeToHttp: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  PIN_LOCKED: 423,
  CONFLICT: 409,
  SANCTIONS_BLOCK: 403,
  CLOSING_DAY_FINALIZED: 409,
  STORNO_OF_STORNO: 422,
  PRODUCT_NOT_RESERVABLE: 409,
  DEVICE_NOT_AUTHORIZED: 403,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

function send(reply: FastifyReply, req: FastifyRequest, code: ApiErrorCode, message: string, details?: unknown): FastifyReply {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId: req.id,
    },
  };
  return reply.status(codeToHttp[code]).send(body);
}

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler((req, reply) => {
    send(reply, req, 'NOT_FOUND', `Route ${req.method} ${req.url} not found`);
  });

  app.setErrorHandler((err, req, reply) => {
    // 1. Fastify validation errors carry `validation` + `statusCode === 400`.
    if (err.validation) {
      send(reply, req, 'VALIDATION_ERROR', err.message, err.validation);
      return;
    }

    // 2. Typed domain errors from workspace packages.
    if (err instanceof DomainError) {
      // PinLockedError carries `lockedUntil` — pass it through as structured
      // details so the client can show a countdown without parsing the message.
      const maybeLockedUntil = (err as { lockedUntil?: unknown }).lockedUntil;
      const details =
        maybeLockedUntil instanceof Date
          ? { lockedUntil: maybeLockedUntil.toISOString() }
          : undefined;
      send(reply, req, err.code, err.message, details);
      return;
    }

    // 3. Known PG triggers (migration 0013 + earlier).
    const pgCode = pgErrorToCode(err as FastifyError & { code?: string });
    if (pgCode) {
      send(reply, req, pgCode, err.message);
      return;
    }

    // 4. Fastify auth/rate-limit conventional shapes.
    if (err.statusCode === 401) { send(reply, req, 'UNAUTHORIZED', err.message); return; }
    if (err.statusCode === 403) { send(reply, req, 'FORBIDDEN', err.message); return; }
    if (err.statusCode === 429) { send(reply, req, 'RATE_LIMITED', err.message); return; }

    // 5. Unknown → 500 + log. The body intentionally hides the underlying
    //    error message (avoid leaking stack hints to a hostile client).
    req.log.error({ err }, 'unhandled error');
    send(reply, req, 'INTERNAL_ERROR', 'Internal server error');
  });
};

export default fastifyPlugin(errorHandlerPlugin, {
  name: 'warehouse14-error-handler',
  fastify: '4.x',
});
