/**
 * tauri-pos — entry point. Stays small on purpose: wires the providers
 * (TanStack Query, Router), mounts <App />, and crashes loud on missing
 * env. No business logic here.
 */

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

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

const env = (
  import.meta as unknown as {
    env: {
      VITE_API_BASE_URL?: string;
      VITE_DEV_DEVICE_FINGERPRINT?: string;
      VITE_SENTRY_DSN?: string;
    };
  }
).env;
const apiBaseUrl = env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const devDeviceFingerprint = env.VITE_DEV_DEVICE_FINGERPRINT ?? '';

// Telemetry (GlitchTip/Sentry) — optional + fail-safe: only init when a DSN is
// configured; a failure here must never block the POS from mounting.
const sentryDsn = env.VITE_SENTRY_DSN?.trim();
if (sentryDsn) {
  try {
    Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0 });
  } catch {
    // Ignore — the app still boots without telemetry.
  }
}

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
