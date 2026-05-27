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
