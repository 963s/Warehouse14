/**
 * The thin `request()` helper + the `ApiClient` carrier object every domain
 * cluster consumes. Domain methods receive an `ApiClient` and call
 * `client.request(...)` — they never see `fetch` directly.
 */

import { ApiError, ApiNetworkError } from './errors.js';
import type { ApiClientConfig, ApiErrorCode, RequestOptions } from './types.js';

export interface ApiClient {
  readonly baseUrl: string;
  /**
   * Issue an HTTP request and parse the response shape. Non-2xx throws
   * `ApiError` (with the stable `code`); network failures throw
   * `ApiNetworkError`. 204 / empty bodies return `undefined`.
   */
  request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T>;
}

interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const defaultTimeout = config.timeoutMs ?? 15_000;

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('request timeout')),
      opts.timeoutMs ?? defaultTimeout,
    );
    // Chain the caller's signal — abort if either fires.
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort(opts.signal.reason);
      opts.signal.addEventListener('abort', () => controller.abort(opts.signal!.reason));
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...config.defaultHeaders,
      ...opts.headers,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        credentials: config.credentials ?? 'include',
        signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : null,
      });
    } catch (err) {
      throw new ApiNetworkError(
        err instanceof Error ? err.message : 'unknown network failure',
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    // No body case (204, HEAD-like).
    if (res.status === 204 || res.headers.get('Content-Length') === '0') {
      if (!res.ok) {
        throw new ApiError({
          code: mapHttpStatus(res.status),
          message: `HTTP ${res.status} (no body)`,
          httpStatus: res.status,
          requestId: res.headers.get('x-request-id'),
        });
      }
      return undefined as T;
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length === 0 ? undefined : JSON.parse(text);
    } catch {
      throw new ApiError({
        code: 'INTERNAL_ERROR',
        message: `non-JSON body (HTTP ${res.status})`,
        httpStatus: res.status,
        requestId: res.headers.get('x-request-id'),
        details: { text: text.slice(0, 200) },
      });
    }

    if (!res.ok) {
      const envelope = parsed as Partial<ErrorEnvelope>;
      const err = envelope?.error;
      throw new ApiError({
        code: err?.code ?? mapHttpStatus(res.status),
        message: err?.message ?? `HTTP ${res.status}`,
        httpStatus: res.status,
        requestId: err?.requestId ?? res.headers.get('x-request-id'),
        details: err?.details,
      });
    }

    return parsed as T;
  }

  return { baseUrl, request };
}

function mapHttpStatus(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL_ERROR';
}
