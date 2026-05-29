/**
 * toast-store — the global toast queue.
 *
 * Pure Zustand list of `ToastShape` records. `<ToastContainer/>` reads,
 * any code path (SSE alert subscription, error boundary, step-up modal)
 * calls `addToast(...)`.
 */

import { create } from 'zustand';

import type { ToastShape, ToastTone } from '@warehouse14/ui-kit';

interface ToastInput {
  tone: ToastTone;
  title: string;
  body?: import('react').ReactNode;
  /** ms; pass `null` for sticky. Defaults: info 5000, success 4000, alert null. */
  autoDismissMs?: number | null;
  /** Stable id — when set, duplicate adds are coalesced (used by SSE bridge). */
  id?: string;
  /** Optional target — clicking the toast navigates here (router-aware caller). */
  onClickPath?: string;
}

interface ToastState {
  toasts: ToastShape[];
  /** Stable IDs of toasts currently in the queue (de-dupe). */
  ids: Set<string>;
  /** Map from toast id → optional navigation path. */
  paths: Map<string, string>;

  addToast: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t-${Date.now()}-${counter}`;
}

const DEFAULT_AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  info: 5_000,
  success: 4_000,
  alert: null, // sticky — operator dismisses manually
};

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  ids: new Set(),
  paths: new Map(),

  addToast: ({ tone, title, body, autoDismissMs, id, onClickPath }) => {
    const finalId = id ?? nextId();
    // De-dupe by stable id — useful for "one toast per AML event row".
    if (id && get().ids.has(id)) return finalId;
    const ms = autoDismissMs === undefined ? DEFAULT_AUTO_DISMISS_MS[tone] : autoDismissMs;
    const t: ToastShape =
      body !== undefined
        ? { id: finalId, tone, title, body, autoDismissMs: ms }
        : { id: finalId, tone, title, autoDismissMs: ms };
    set((s) => {
      const nextIds = new Set(s.ids);
      nextIds.add(finalId);
      const nextPaths = new Map(s.paths);
      if (onClickPath) nextPaths.set(finalId, onClickPath);
      return {
        toasts: [...s.toasts, t],
        ids: nextIds,
        paths: nextPaths,
      };
    });
    return finalId;
  },
  dismiss: (id) =>
    set((s) => {
      if (!s.ids.has(id)) return s;
      const nextIds = new Set(s.ids);
      nextIds.delete(id);
      const nextPaths = new Map(s.paths);
      nextPaths.delete(id);
      return {
        toasts: s.toasts.filter((t) => t.id !== id),
        ids: nextIds,
        paths: nextPaths,
      };
    }),
  clear: () => set({ toasts: [], ids: new Set(), paths: new Map() }),
}));
