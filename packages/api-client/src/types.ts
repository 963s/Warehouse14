/**
 * Common types re-exported across all api-client domain files.
 *
 * The stable `ApiErrorCode` enum mirrors `apps/api-cloud/src/plugins/error-handler.ts`
 * — keep them in sync. A backend PR that introduces a new code must add it
 * here in the same PR (CI guard candidate, Phase 1.5).
 */

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
  | 'EXTERNAL_SERVICE_FAILED'
  | 'INTERNAL_ERROR';

export interface RequestOptions {
  /** Abort the request when the signal fires. Plumbs through to `fetch`. */
  signal?: AbortSignal;
  /** Override the per-request timeout in ms (default: client-level). */
  timeoutMs?: number;
  /** Additional headers — merged with the client defaults. */
  headers?: Record<string, string>;
  /**
   * Stable route label for telemetry, e.g. `/ankauf/:id` (so telemetry can
   * group attempts on the same logical endpoint even when the URL contains
   * IDs). If omitted, telemetry falls back to the raw path.
   */
  routeTemplate?: string;
}

export interface ApiClientConfig {
  /** Base URL of the API — e.g. `https://api.warehouse14.de` or `http://localhost:3001`. */
  baseUrl: string;
  /** Default timeout per request, in milliseconds. Default: 15_000. */
  timeoutMs?: number;
  /** Include credentials (cookies) — Tauri webview sets this to `'include'`. */
  credentials?: RequestCredentials;
  /** Extra default headers, e.g. `{ 'X-Dev-Device-Fingerprint': '…' }` in dev. */
  defaultHeaders?: Record<string, string>;
  /**
   * Middleware chain. Outermost first; the terminal `fetch` runs after the
   * last entry. Order is load-bearing — see ADR-0042 + ADR-0043 in
   * `docs/architecture/adr/`. Omit for a raw client (used by the session
   * probe and by integration tests that want deterministic terminal
   * behaviour without retries/dedup).
   *
   * Imported as `Middleware` from `./middleware.js` — kept untyped here to
   * avoid a circular import; consumers should use the const factory exported
   * from `apps/tauri-pos/src/lib/api-context.tsx` (`productionMiddlewares`).
   */
  middlewares?: readonly import('./middleware.js').Middleware[];
}
