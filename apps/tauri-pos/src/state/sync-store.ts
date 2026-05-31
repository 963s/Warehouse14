/**
 * sync-store — offline-queue health for the header status badge (ADR-0044 §6).
 *
 * Mirrors the local SQLite outbox state the cashier needs at a glance:
 *   • `online`        — connectivity (tracks `navigator.onLine` + window events)
 *   • `syncing`       — the replay loop is draining the queue right now
 *   • `pendingCount`  — rows still awaiting replay
 *   • `conflictCount` — rows halted on a divergence (→ Compliance Inbox)
 *
 * The replay controller (offline-replay.ts) drives `syncing` + calls
 * `refreshStats()`; a 5s tick in `useOfflineReplay` keeps the counts fresh.
 */

import { create } from 'zustand';

import { outboxStore } from '../lib/api-context.js';

interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  conflictCount: number;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  /** Pull the latest pending/conflict counts from the durable outbox. */
  refreshStats: () => Promise<void>;
}

const initialOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

export const useSyncStore = create<SyncState>((set) => ({
  online: initialOnline,
  syncing: false,
  pendingCount: 0,
  conflictCount: 0,
  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  refreshStats: async () => {
    // `getStats` is optional on the OutboxStore contract; the Tauri store
    // implements it. Outside a Tauri webview it may reject (no SQLite) — keep
    // the last known counts and let the next tick retry.
    if (!outboxStore.getStats) return;
    try {
      const stats = await outboxStore.getStats();
      set({ pendingCount: stats.pending, conflictCount: stats.conflict });
    } catch {
      // SQLite unavailable / not ready — silent; counts refresh on the next tick.
    }
  },
}));

// Keep `online` in lock-step with the browser's connectivity (guarded for SSR /
// test environments without a window).
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useSyncStore.getState().setOnline(true));
  window.addEventListener('offline', () => useSyncStore.getState().setOnline(false));
}
