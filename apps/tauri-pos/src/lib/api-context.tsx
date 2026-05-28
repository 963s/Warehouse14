/**
 * React Context that exposes a singleton ApiClient to every screen.
 *
 *   const api = useApiClient();
 *   await authPin.login(api, { pin });
 *
 * The client is constructed once from the base URL passed in at <App />
 * mount, with the locked-order production middleware chain. The external
 * `wrapWithStepUp` decorator has been folded into the chain as
 * `stepUpMiddleware` (ADR-0043). The legacy `wrapWithStepUp.ts` file may
 * remain on disk for one release cycle but is no longer imported here.
 *
 * The session-probe hook bypasses step-up via `meta.custom.skipStepUp =
 * true`, not via constructing a separate raw client. Same surface, same
 * telemetry, same dedup — the only difference is that a 401 / step-up
 * response on the probe path does NOT open the PIN modal.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  circuitBreakerMiddleware,
  createApiClient,
  inflightDedupMiddleware,
  retryMiddleware,
  stepUpMiddleware,
  telemetryMiddleware,
  type ApiClient,
  type Middleware,
} from '@warehouse14/api-client';

import { stepUpService } from './stepUpService.js';
import { telemetrySink } from './telemetrySink.js';

const ApiClientContext = createContext<ApiClient | null>(null);

/**
 * Locked-order production middleware stack. Order is asserted in CI by
 * `apps/tauri-pos/src/lib/__tests__/production-middleware-order.test.ts`.
 *
 * Outermost → innermost:
 *   step-up    UX replay on STEP_UP_REQUIRED (single shot, opens PIN modal)
 *   retry      infra retry on idempotent + retryable (excludes STEP_UP_REQUIRED, CIRCUIT_OPEN)
 *   telemetry  per-attempt audit; logs even CIRCUIT_OPEN refusals (GoBD)
 *   circuit    per-bucket health; fast-fails inside cooldown
 *   dedup      coalesces concurrent identical GETs
 *
 * Phase 3 adds `offlineQueueMiddleware` between step-up and retry — see
 * ADR-0044.
 */
export const productionMiddlewares: readonly Middleware[] = [
  stepUpMiddleware(stepUpService),
  retryMiddleware(),
  telemetryMiddleware({ sink: telemetrySink }),
  circuitBreakerMiddleware(),
  inflightDedupMiddleware(),
];

export interface ApiClientProviderProps {
  baseUrl: string;
  /**
   * Dev-mode device fingerprint. In production, mTLS handles device
   * identity via Cloudflare Access. In dev, the API expects the
   * fingerprint as a header so it can resolve which paired user lives
   * behind this terminal. Pulled from `VITE_DEV_DEVICE_FINGERPRINT` at
   * build time.
   */
  devDeviceFingerprint?: string;
  children: ReactNode;
}

export function ApiClientProvider({
  baseUrl,
  devDeviceFingerprint,
  children,
}: ApiClientProviderProps): JSX.Element {
  const client = useMemo(() => {
    const defaultHeaders: Record<string, string> = {};
    if (devDeviceFingerprint) {
      defaultHeaders['x-dev-device-fingerprint'] = devDeviceFingerprint;
    }
    return createApiClient({
      baseUrl,
      credentials: 'include',
      defaultHeaders,
      middlewares: productionMiddlewares,
    });
  }, [baseUrl, devDeviceFingerprint]);
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApiClient must be called inside <ApiClientProvider>');
  }
  return client;
}
