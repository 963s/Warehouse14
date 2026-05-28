/**
 * Stable error class for every non-2xx response. The backend always returns
 *
 *   { error: { code: ApiErrorCode, message, requestId, details? } }
 *
 * — we parse that shape and surface it as a typed exception. Front-end code
 * inspects `err.code` (not HTTP status) to decide UX behaviour:
 *
 *   STEP_UP_REQUIRED   → open PIN modal
 *   DEVICE_NOT_AUTHORIZED → log out + clear cookies
 *   VALIDATION_ERROR   → show inline form errors
 *   RATE_LIMITED       → show throttle banner
 */

import type { ApiErrorCode } from './types.js';

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly httpStatus: number;
  public readonly requestId: string | null;
  public readonly details: unknown;

  constructor(opts: {
    code: ApiErrorCode;
    message: string;
    httpStatus: number;
    requestId?: string | null;
    details?: unknown;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.requestId = opts.requestId ?? null;
    this.details = opts.details;
  }
}

/** Surfaces network-level failures (DNS, connection refused, timeout). */
export class ApiNetworkError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ApiNetworkError';
    this.cause = cause;
  }
}

/**
 * Thrown by `circuitBreakerMiddleware` when an endpoint's failure rate has
 * exceeded the configured threshold and we're inside the cooldown window.
 *
 * Deliberately NOT an `ApiError` subclass: there's no real HTTP response and
 * no real status code. The UI should surface a degraded-service banner
 * ("Cloud-API momentan nicht erreichbar — versuche in {N}s wieder") rather
 * than the generic API error toast.
 *
 * The retry middleware MUST NOT retry this error — see middleware/retry.ts.
 */
export class ApiCircuitOpenError extends Error {
  public readonly bucket: string;
  public readonly openedAt: number;
  public readonly retryAfterMs: number;

  constructor(bucket: string, openedAt: number, retryAfterMs: number) {
    super(`circuit open for ${bucket} (retry after ${retryAfterMs}ms)`);
    this.name = 'ApiCircuitOpenError';
    this.bucket = bucket;
    this.openedAt = openedAt;
    this.retryAfterMs = retryAfterMs;
  }
}
