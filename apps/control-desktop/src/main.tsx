/**
 * control-desktop — entry point. Wires the providers (TanStack Query + the
 * ApiClient context), mounts <App />, and crashes loud if the root node is
 * missing. No business logic here.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createApiClient } from '@warehouse14/api-client';

// Brand stylesheet — tokens + @font-face (local fonts only).
import '@warehouse14/ui-kit/styles.css';

import { App } from './App.js';
import { ApiClientProvider } from './api-context.js';

const env = (import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }).env;
const apiBaseUrl = env.VITE_API_BASE_URL ?? 'http://localhost:3001';

const apiClient = createApiClient({ baseUrl: apiBaseUrl });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('control-desktop: #root element is missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient} baseUrl={apiBaseUrl}>
        <App />
      </ApiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
