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
  /** 'network' = TCP 9100 socket; 'usb' = OS print queue via CUPS raw (no IP). */
  mode: 'network' | 'usb';
  ip: string;
  port: number; // typical 9100
  /** USB mode: the OS print-queue name (e.g. 'Warehouse14-Bon'). */
  printerName: string;
  /** Last-known status from `zvtClient.check` / printer probe. */
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
}

export interface A4PrinterConfig {
  /** OS print-queue name as returned by `list_system_printers()`. */
  printerName: string;
}

export interface LabelPrinterConfig {
  /** 'tcp' = network 9100 socket; 'system' = CUPS queue via lpr -o raw. */
  mode: 'tcp' | 'system';
  /** Network mode: printer IP. */
  ip: string;
  port: number; // typical 9100
  /** System mode: OS print-queue name. */
  printerName: string;
  /** Command dialect the printer speaks. */
  printerType: 'ZPL' | 'ESCPOS';
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
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
  /**
   * The Fiskaly api_key/api_secret are NO LONGER stored here. They live in the
   * OS keychain (written via `tseClient.storeCredentials`, hydrated inside Rust).
   * This is a non-secret UI hint: are credentials present in the keychain?
   */
  credentialsStored: boolean;
  /** Last status returned by `tse_status`. */
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
}

export interface HardwareConfig {
  thermal: ThermalConfig;
  a4: A4PrinterConfig;
  label: LabelPrinterConfig;
  zvt: ZvtTerminalConfig;
  tse: TseFiskalyConfig;
}

const DEFAULT: HardwareConfig = {
  thermal: {
    mode: 'network',
    ip: '',
    port: 9100,
    printerName: '',
    lastReachable: null,
    lastCheckedAt: null,
  },
  a4: { printerName: '' },
  label: {
    mode: 'system',
    ip: '',
    port: 9100,
    printerName: '',
    printerType: 'ZPL',
    lastReachable: null,
    lastCheckedAt: null,
  },
  zvt: { ip: '', port: 20007, lastReachable: null, lastCheckedAt: null },
  tse: {
    tssId: '',
    clientId: '',
    credentialsStored: false,
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
  setLabel: (patch: Partial<LabelPrinterConfig>) => void;
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
  setLabel: (patch) => {
    const next = { ...get().config, label: { ...get().config.label, ...patch } };
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
          label: { ...DEFAULT.label, ...(parsed.label ?? {}) },
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
