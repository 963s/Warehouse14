/**
 * last-receipt-store — holds the most recently finalized receipt so the
 * operator can RE-PRINT it (e.g. the thermal printer jammed and they already
 * closed the preview). In-memory only (no PII at rest); cleared on sign-out
 * with the rest of the per-operator state.
 */

import { create } from 'zustand';

import type { ThermalReceiptData } from '../lib/hardware-client.js';

interface LastReceiptState {
  lastReceipt: ThermalReceiptData | null;
  setLastReceipt: (r: ThermalReceiptData) => void;
  clearLastReceipt: () => void;
}

export const useLastReceiptStore = create<LastReceiptState>((set) => ({
  lastReceipt: null,
  setLastReceipt: (r) => set({ lastReceipt: r }),
  clearLastReceipt: () => set({ lastReceipt: null }),
}));
