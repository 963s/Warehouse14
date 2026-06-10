/**
 * useHardwareAutoConnect — silent app-start hardware probe + a one-tap
 * "Alle Geräte verbinden" action for the Gerätemanager.
 *
 * The mandate: hardware should connect ONE-TAP / automatically. On a real shop
 * machine the printers + terminal sit at fixed LAN addresses the operator
 * already configured once, so re-probing every saved endpoint on launch (and
 * marking it connected when it answers) means the POS is "ready" without anyone
 * opening Settings. The probes are pure TCP/queue reachability checks — they
 * send NO bytes, so an auto-probe never feeds paper or wakes the terminal.
 *
 * Each probe writes `lastReachable` + `lastCheckedAt` back into the hardware
 * store, which is exactly what the per-device status badges render. Failures
 * are swallowed (an offline printer is a normal state, surfaced calmly as a red
 * badge — never a crash or a blocking toast at boot).
 *
 * `connectDevice` powers the per-card "Automatisch verbinden" button and
 * returns the boolean result so the caller can also fire a toast.
 */

import { useCallback, useEffect, useRef } from 'react';

import {
  type LabelConfig,
  isRunningInTauri,
  labelClient,
  thermalClient,
  zvtClient,
} from '../lib/hardware-client.js';
import { useHardwareStore } from '../state/hardware-store.js';

export type HardwareDeviceKind = 'thermal' | 'label' | 'zvt';

interface UseHardwareAutoConnect {
  /** Probe a single device; resolves `true` when reachable. Never throws. */
  connectDevice: (kind: HardwareDeviceKind) => Promise<boolean>;
  /** Probe every configured device in parallel (the "Alle verbinden" action). */
  connectAll: () => Promise<void>;
}

/**
 * Probe one device by kind, persisting the verdict into the store. Pulled out
 * of the hook so both the boot sweep and the manual button share one code path.
 * Returns `false` (not a throw) on any error so callers can treat "unreachable"
 * and "errored" identically — both mean "not connected".
 */
async function probeDevice(kind: HardwareDeviceKind): Promise<boolean> {
  const store = useHardwareStore.getState();
  const cfg = store.config;
  const now = new Date().toISOString();

  try {
    if (kind === 'thermal') {
      if (!cfg.thermal.ip) return false;
      const ok = await thermalClient.check({ ip: cfg.thermal.ip, port: cfg.thermal.port });
      store.setThermal({ lastReachable: ok, lastCheckedAt: now });
      return ok;
    }
    if (kind === 'zvt') {
      if (!cfg.zvt.ip) return false;
      const ok = await zvtClient.check({ ip: cfg.zvt.ip, port: cfg.zvt.port });
      store.setZvt({ lastReachable: ok, lastCheckedAt: now });
      return ok;
    }
    // label
    const l = cfg.label;
    const configured = l.mode === 'system' ? l.printerName.length > 0 : l.ip.length > 0;
    if (!configured) return false;
    const labelConfig: LabelConfig = {
      mode: l.mode,
      ip: l.ip || undefined,
      port: l.port,
      printerName: l.printerName || undefined,
      printerType: l.printerType,
    };
    const ok = await labelClient.check(labelConfig);
    store.setLabel({ lastReachable: ok, lastCheckedAt: now });
    return ok;
  } catch {
    // Unreachable / not-configured / browser-mode — mark offline, stay calm.
    if (kind === 'thermal') store.setThermal({ lastReachable: false, lastCheckedAt: now });
    else if (kind === 'zvt') store.setZvt({ lastReachable: false, lastCheckedAt: now });
    else store.setLabel({ lastReachable: false, lastCheckedAt: now });
    return false;
  }
}

/**
 * @param autoOnMount When true (the App-shell instance), run a one-shot probe
 *   sweep of every saved device once the store has hydrated. The Gerätemanager
 *   passes `false` and only uses the returned manual actions.
 */
export function useHardwareAutoConnect(autoOnMount = false): UseHardwareAutoConnect {
  const loaded = useHardwareStore((s) => s.loaded);
  const sweptRef = useRef(false);

  const connectDevice = useCallback((kind: HardwareDeviceKind) => probeDevice(kind), []);

  const connectAll = useCallback(async () => {
    await Promise.all([probeDevice('thermal'), probeDevice('label'), probeDevice('zvt')]);
  }, []);

  useEffect(() => {
    if (!autoOnMount || sweptRef.current) return;
    // Only meaningful inside Tauri; in browser mode the probes would all fail
    // and there is no hardware to connect to.
    if (!isRunningInTauri()) return;
    // Wait for the store to hydrate from localStorage so we probe the SAVED
    // endpoints, not the empty defaults.
    if (!loaded) return;
    sweptRef.current = true;
    void connectAll();
  }, [autoOnMount, loaded, connectAll]);

  return { connectDevice, connectAll };
}
