/**
 * Offline replay controller (ADR-0044 §6 — action items 4 & 5), app layer.
 *
 * The pure FIFO/conflict policy lives in `drainOutbox` (api-client). This file
 * supplies the three things only the app knows: the real `ApiClient` to replay
 * through, the connectivity listeners that trigger a drain, and the
 * single-flight lock that keeps overlapping `online` events from double-draining.
 *
 * A replayed request is pushed back through the SAME production chain, but with
 * `meta.custom` flags that make it inert at the layers that would misbehave in
 * the background:
 *   • skipOfflineQueue — so offline-queue passes it through (no re-enqueue loop)
 *   • skipStepUp       — so a STEP_UP_REQUIRED can't try to open a PIN modal
 *   • idempotent       — so retry may safely re-attempt a 5xx (the sealed
 *                        Idempotency-Key guarantees at-most-once server-side)
 */

import { useEffect } from 'react';

import {
  type ApiClient,
  type OutboxRecord,
  type OutboxStore,
  drainOutbox,
} from '@warehouse14/api-client';

import { useToastStore } from '../state/toast-store.js';
import { outboxStore, useApiClient } from './api-context.js';

export interface ReplayController {
  /** Begin listening for connectivity + run an initial startup sweep. */
  start(): void;
  /** Detach listeners. */
  stop(): void;
  /** Drain now (single-flight). Resolves when this run settles. */
  trigger(): Promise<void>;
}

export interface OfflineReplayOptions {
  /** Surface a halted-queue conflict to the operator (Compliance Inbox cue). */
  onConflict?: (record: OutboxRecord, serverCode: string) => void;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function createOfflineReplay(
  client: ApiClient,
  store: OutboxStore,
  options: OfflineReplayOptions = {},
): ReplayController {
  let running = false;
  let started = false;

  const replay = (record: OutboxRecord): Promise<unknown> =>
    client.request(record.method, record.path, record.body, {
      headers: record.headers,
      custom: {
        skipOfflineQueue: true,
        skipStepUp: true,
        idempotent: true,
        idempotencyKey: record.idempotencyKey,
        gobdRelevant: record.gobdRelevant,
      },
    });

  async function trigger(): Promise<void> {
    if (running || !isOnline()) return;
    running = true;
    try {
      const outcome = await drainOutbox({
        store,
        replay,
        onConflict: (record, error) => options.onConflict?.(record, error.serverCode),
      });
      if (outcome.kind === 'halted') {
        // Queue is now stopped behind a conflict — nothing more to do until the
        // Owner resolves it; the next online event will NOT advance past it.
      }
    } catch {
      // listPending / markSucceeded I/O failure — swallow; the next
      // connectivity event retries. Never throw from a background listener.
    } finally {
      running = false;
    }
  }

  const onOnline = (): void => {
    void trigger();
  };

  return {
    start(): void {
      if (started || typeof window === 'undefined') return;
      started = true;
      window.addEventListener('online', onOnline);
      // Startup sweep: the app may launch already-online with rows left by a
      // previous crash or offline session (ADR-0044 §4 crash-recovery).
      void trigger();
    },
    stop(): void {
      if (!started || typeof window === 'undefined') return;
      started = false;
      window.removeEventListener('online', onOnline);
    },
    trigger,
  };
}

/**
 * Drive the replay controller from React. Pass `enabled = true` only once the
 * session is authenticated — a replay under no session would 401 (handled as a
 * transient abort, but pointless to attempt).
 */
export function useOfflineReplay(enabled: boolean): void {
  const client = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (!enabled) return;
    const controller = createOfflineReplay(client, outboxStore, {
      onConflict: (record, serverCode) => {
        addToast({
          tone: 'alert',
          title: 'Synchronisierungskonflikt',
          body: `Ein Offline-Vorgang (${record.path}) weicht vom Server ab (${serverCode}) und muss geprüft werden.`,
        });
      },
    });
    controller.start();
    return () => controller.stop();
  }, [enabled, client, addToast]);
}
