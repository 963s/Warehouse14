/**
 * Phase-2 P2.6 — hardware-store hydration validates the persisted config.
 *
 * localStorage is untrusted: a corrupt/tampered `zvt.port` or `zvt.ip` must NOT
 * reach `zvtClient.authorize`. This is the safety-critical case — each section
 * is validated independently and a bad one falls back to its default.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHardwareStore } from './hardware-store.js';

const KEY = 'warehouse14.hardware-config.v1';

function stubLocalStorage(store: Map<string, string>): void {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
}

describe('hardware-store hydrateFromLocal validation', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    stubLocalStorage(store);
    useHardwareStore.setState({ loaded: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drops the zvt section to default when zvt.port is a string', () => {
    store.set(
      KEY,
      JSON.stringify({
        zvt: { ip: '10.0.0.5', port: '20007', lastReachable: null, lastCheckedAt: null },
      }),
    );
    useHardwareStore.getState().hydrateFromLocal();
    const { zvt } = useHardwareStore.getState().config;
    expect(zvt.port).toBe(20007); // the DEFAULT, NOT the tampered string
    expect(zvt.ip).toBe(''); // the whole section fell back, never reaching zvtClient
  });

  it('drops the zvt section when zvt.port is out of range', () => {
    store.set(
      KEY,
      JSON.stringify({
        zvt: { ip: '10.0.0.5', port: 70000, lastReachable: null, lastCheckedAt: null },
      }),
    );
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().config.zvt.port).toBe(20007);
  });

  it('keeps a valid zvt config intact', () => {
    store.set(
      KEY,
      JSON.stringify({
        zvt: { ip: '10.0.0.5', port: 20007, lastReachable: true, lastCheckedAt: '2026-06-16' },
      }),
    );
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().config.zvt).toEqual({
      ip: '10.0.0.5',
      port: 20007,
      lastReachable: true,
      lastCheckedAt: '2026-06-16',
    });
  });

  it('total garbage → all defaults, loaded true', () => {
    store.set(KEY, '{');
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().loaded).toBe(true);
    expect(useHardwareStore.getState().config.zvt.port).toBe(20007);
    expect(useHardwareStore.getState().config.thermal.port).toBe(9100);
  });
});
