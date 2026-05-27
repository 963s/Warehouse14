/**
 * Hardware-config store.
 *
 * Persists every endpoint the POS talks to (thermal printer, A4 printer,
 * ZVT terminal, Fiskaly TSE). Settings live in three places, written in
 * this order on every PATCH:
 *
 *   1. Zustand (in-memory) — instant UI updates.
 *   2. localStorage — survives webview reload, present before network is up.
 *   3. PATCH /api/system-settings/:key — audit-logged source of truth.
 *
 * On cold boot we hydrate from localStorage first, then revalidate
 * asynchronously via the API. The Gerätemanager screen drives the
 * "Test Connection" calls into hardware-client.
 */

import { create } from 'zustand';

const LOCAL_KEY = 'warehouse14.hardware-config.v1';

export interface ThermalConfig {
  ip: string;
  port: number; // typical 9100
  /** Last-known status from `zvtClient.check` / printer probe. */
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
}

export interface A4PrinterConfig {
  /** OS print-queue name as returned by `list_system_printers()`. */
  printerName: string;
}

export interface ZvtTerminalConfig {
  ip: string;
  port: number; // typical 20007
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
}

export interface TseFiskalyConfig {
  tssId: string;
  clientId: string;
  /** The raw key — never logged, never sent to the React layer except here. */
  apiKey: string;
  apiSecret: string;
  /** Last status returned by `tse_status`. */
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
}

export interface HardwareConfig {
  thermal: ThermalConfig;
  a4: A4PrinterConfig;
  zvt: ZvtTerminalConfig;
  tse: TseFiskalyConfig;
}

const DEFAULT: HardwareConfig = {
  thermal: { ip: '', port: 9100, lastReachable: null, lastCheckedAt: null },
  a4: { printerName: '' },
  zvt: { ip: '', port: 20007, lastReachable: null, lastCheckedAt: null },
  tse: {
    tssId: '',
    clientId: '',
    apiKey: '',
    apiSecret: '',
    lastReachable: null,
    lastCheckedAt: null,
    lastSyncAt: null,
  },
};

interface HardwareState {
  config: HardwareConfig;
  loaded: boolean;
  setThermal: (patch: Partial<ThermalConfig>) => void;
  setA4: (patch: Partial<A4PrinterConfig>) => void;
  setZvt: (patch: Partial<ZvtTerminalConfig>) => void;
  setTse: (patch: Partial<TseFiskalyConfig>) => void;
  hydrateFromLocal: () => void;
  /** Replace the whole config (used after a successful API revalidation). */
  replaceAll: (next: HardwareConfig) => void;
}

export const useHardwareStore = create<HardwareState>((set, get) => ({
  config: DEFAULT,
  loaded: false,

  setThermal: (patch) => {
    const next = { ...get().config, thermal: { ...get().config.thermal, ...patch } };
    persist(next);
    set({ config: next });
  },
  setA4: (patch) => {
    const next = { ...get().config, a4: { ...get().config.a4, ...patch } };
    persist(next);
    set({ config: next });
  },
  setZvt: (patch) => {
    const next = { ...get().config, zvt: { ...get().config.zvt, ...patch } };
    persist(next);
    set({ config: next });
  },
  setTse: (patch) => {
    const next = { ...get().config, tse: { ...get().config.tse, ...patch } };
    persist(next);
    set({ config: next });
  },
  hydrateFromLocal: () => {
    if (get().loaded) return;
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<HardwareConfig>;
        const merged: HardwareConfig = {
          thermal: { ...DEFAULT.thermal, ...(parsed.thermal ?? {}) },
          a4: { ...DEFAULT.a4, ...(parsed.a4 ?? {}) },
          zvt: { ...DEFAULT.zvt, ...(parsed.zvt ?? {}) },
          tse: { ...DEFAULT.tse, ...(parsed.tse ?? {}) },
        };
        set({ config: merged, loaded: true });
        return;
      }
    } catch {
      // Corrupt storage — fall through to defaults.
    }
    set({ loaded: true });
  },
  replaceAll: (next) => {
    persist(next);
    set({ config: next });
  },
}));

function persist(config: HardwareConfig): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(config));
  } catch {
    // QuotaExceeded — UI surfaces an error if it cares.
  }
}
