/**
 * tauri-pos — entry point. Stays small on purpose: wires the providers
 * (TanStack Query, Router), mounts <App />, and crashes loud on missing
 * env. No business logic here.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Brand stylesheet — loads tokens + @font-face (local fonts only).
import '@warehouse14/ui-kit/styles.css';

import { App } from './app/App.js';
import { ApiClientProvider } from './lib/api-context.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const env = (import.meta as unknown as {
  env: { VITE_API_BASE_URL?: string; VITE_DEV_DEVICE_FINGERPRINT?: string };
}).env;
const apiBaseUrl = env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const devDeviceFingerprint = env.VITE_DEV_DEVICE_FINGERPRINT ?? '';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing in index.html');

createRoot(root).render(
  <StrictMode>
    <ApiClientProvider baseUrl={apiBaseUrl} devDeviceFingerprint={devDeviceFingerprint}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ApiClientProvider>
  </StrictMode>,
);
