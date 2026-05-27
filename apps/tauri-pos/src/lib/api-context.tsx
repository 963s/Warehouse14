/**
 * React Context that exposes a singleton ApiClient to every screen.
 *
 *   const api = useApiClient();
 *   await authPin.login(api, { pin });
 *
 * The client is constructed once from the base URL passed in at <App /> mount,
 * then wrapped with the step-up interceptor (memory.md #76):
 *
 *   raw client (no UI awareness)
 *      └── wrapWithStepUp → catches STEP_UP_REQUIRED, opens modal, retries
 *
 * Screens consume the WRAPPED client. The session-probe hook bypasses
 * via the raw `createApiClient` path because a 401 there must NOT trigger
 * the step-up modal (no session ≠ stale step-up).
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createApiClient, type ApiClient } from '@warehouse14/api-client';

import { wrapWithStepUp } from './wrapWithStepUp.js';

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  baseUrl: string;
  children: ReactNode;
}

export function ApiClientProvider({ baseUrl, children }: ApiClientProviderProps): JSX.Element {
  const client = useMemo(() => {
    const raw = createApiClient({ baseUrl, credentials: 'include' });
    return wrapWithStepUp(raw);
  }, [baseUrl]);
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApiClient must be called inside <ApiClientProvider>');
  }
  return client;
}
