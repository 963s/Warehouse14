/**
 * Fiskaly DSFinV-K client (Epic K — Part 1).
 *
 * Pushes a day's cash-point closing to the Fiskaly DSFinV-K cloud, which
 * assembles the BMF-mandated DSFinV-K export bundle for a Finanzamt audit.
 * Same `fetchImpl`-injection pattern as opensanctions.ts so it is unit-testable
 * without the network.
 *
 * FAIL-SAFE (memory.md #63): a year-end export is important, but a transient
 * Fiskaly outage must NEVER block the daily-closing flow. Every failure mode —
 * missing credentials, timeout, non-2xx — resolves to `{ error: string }` and
 * is logged by the caller; nothing throws.
 */

export interface FiskalyConfig {
  apiKey: string;
  apiSecret: string;
}

/** Opaque DSFinV-K cash-point-closing payload (BMF schema, built by caller). */
export type CashPointClosing = Record<string, unknown>;

export interface FiskalyError {
  error: string;
}

export type PushClosingResult = { exportId: string } | FiskalyError;
export type TriggerExportResult = { downloadUrl: string } | FiskalyError;

export type FiskalyFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

export interface FiskalyClientOptions {
  baseUrl?: string;
  fetchImpl?: FiskalyFetch;
  /** Hard timeout in ms (default 15_000). */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://dsfinvk.fiskaly.com/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const defaultFetch: FiskalyFetch = (input, init) => fetch(input, init as RequestInit | undefined);

export function isFiskalyConfigured(config: FiskalyConfig): boolean {
  return config.apiKey.length > 0 && config.apiSecret.length > 0;
}

function basicAuth(config: FiskalyConfig): string {
  const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

/** Narrowing helper so callers can branch on success without a cast. */
export function isFiskalyError(r: { error?: string }): r is FiskalyError {
  return typeof r.error === 'string';
}

/**
 * POST a cash-point closing to Fiskaly. Returns `{ exportId }` on success or
 * `{ error }` on any failure (never throws).
 */
export async function pushCashPointClosing(
  config: FiskalyConfig,
  closing: CashPointClosing,
  opts: FiskalyClientOptions = {},
): Promise<PushClosingResult> {
  if (!isFiskalyConfigured(config)) {
    return { error: 'fiskaly not configured' };
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/cash_point_closings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(config),
      },
      body: JSON.stringify(closing),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { error: `fiskaly cash_point_closings failed: HTTP ${res.status}` };
    }

    const data = (await res.json()) as { _id?: string; id?: string };
    const exportId = data._id ?? data.id;
    if (!exportId) {
      return { error: 'fiskaly response missing closing id' };
    }
    return { exportId };
  } catch (err) {
    return { error: `fiskaly cash_point_closings unreachable: ${describeError(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trigger a DSFinV-K export for a previously-pushed closing. Returns
 * `{ downloadUrl }` on success or `{ error }` on any failure (never throws).
 */
export async function triggerExport(
  config: FiskalyConfig,
  exportId: string,
  opts: FiskalyClientOptions = {},
): Promise<TriggerExportResult> {
  if (!isFiskalyConfigured(config)) {
    return { error: 'fiskaly not configured' };
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/exports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(config),
      },
      body: JSON.stringify({ cash_point_closing_id: exportId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { error: `fiskaly exports failed: HTTP ${res.status}` };
    }

    const data = (await res.json()) as { download_url?: string; href?: string };
    const downloadUrl = data.download_url ?? data.href;
    if (!downloadUrl) {
      return { error: 'fiskaly response missing download_url' };
    }
    return { downloadUrl };
  } catch (err) {
    return { error: `fiskaly exports unreachable: ${describeError(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
