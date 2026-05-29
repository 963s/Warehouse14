/**
 * React Context exposing a singleton ApiClient (+ its base URL) to the
 * back-office tree. Mirrors the tauri-pos pattern but stays minimal for the
 * scaffold — the full middleware chain (step-up, offline outbox) lands when the
 * first Owner workflow is wired.
 */

import { type ReactNode, createContext, useContext } from 'react';

import type { ApiClient } from '@warehouse14/api-client';

interface ApiContextValue {
  client: ApiClient;
  baseUrl: string;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiClientProvider({
  client,
  baseUrl,
  children,
}: {
  client: ApiClient;
  baseUrl: string;
  children: ReactNode;
}): JSX.Element {
  return <ApiContext.Provider value={{ client, baseUrl }}>{children}</ApiContext.Provider>;
}

export function useApiClient(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error('useApiClient must be used within <ApiClientProvider>');
  }
  return ctx;
}
