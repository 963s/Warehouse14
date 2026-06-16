/**
 * control-desktop — entry point. Wires the providers (TanStack Query + the
 * ApiClient context), mounts <App />, and crashes loud if the root node is
 * missing. No business logic here.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createApiClient, stepUpMiddleware } from '@warehouse14/api-client';

// Brand stylesheet — tokens + @font-face (local fonts only).
import '@warehouse14/ui-kit/styles.css';

import { App } from './App.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { ApiClientProvider } from './api-context.js';
import { stepUpService } from './step-up-service.js';

const env = (import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }).env;
const apiBaseUrl = env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// Owner mutations (trust, KYC, settings) require a fresh PIN. The step-up
// middleware replays the call once the <StepUpModal/> POSTs /api/auth/step-up.
const apiClient = createApiClient({
  baseUrl: apiBaseUrl,
  middlewares: [stepUpMiddleware(stepUpService)],
});

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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient} baseUrl={apiBaseUrl}>
          <App />
        </ApiClientProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
