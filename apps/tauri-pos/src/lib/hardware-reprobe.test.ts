import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REPROBE_INTERVAL_MS,
  type ReprobeContext,
  shouldReprobe,
} from './hardware-reprobe.js';

// A context where every guard is satisfied and the interval has clearly elapsed.
const base: ReprobeContext = {
  nowMs: 1_000_000,
  lastSweepAtMs: 1_000_000 - 100_000, // 100s ago, past the 90s interval
  intervalMs: DEFAULT_REPROBE_INTERVAL_MS,
  documentHidden: false,
  inFlight: false,
  loaded: true,
  inTauri: true,
};

describe('shouldReprobe', () => {
  it('fires when idle, visible, loaded, in Tauri, and the interval elapsed', () => {
    expect(shouldReprobe(base)).toBe(true);
  });

  it('never fires outside the Tauri webview', () => {
    expect(shouldReprobe({ ...base, inTauri: false })).toBe(false);
  });

  it('never fires before the hardware config has loaded', () => {
    expect(shouldReprobe({ ...base, loaded: false })).toBe(false);
  });

  it('does not fire while the tab is hidden', () => {
    expect(shouldReprobe({ ...base, documentHidden: true })).toBe(false);
  });

  it('does not fire while a probe/operation is in flight', () => {
    expect(shouldReprobe({ ...base, inFlight: true })).toBe(false);
  });

  it('does not fire before the interval has elapsed', () => {
    expect(shouldReprobe({ ...base, lastSweepAtMs: base.nowMs - 10_000 })).toBe(false);
  });

  it('fires exactly on the interval boundary', () => {
    expect(
      shouldReprobe({ ...base, lastSweepAtMs: base.nowMs - DEFAULT_REPROBE_INTERVAL_MS }),
    ).toBe(true);
  });

  it('treats a never-probed device as due', () => {
    expect(shouldReprobe({ ...base, lastSweepAtMs: null })).toBe(true);
  });

  it('never fires with a non-positive interval', () => {
    expect(shouldReprobe({ ...base, intervalMs: 0 })).toBe(false);
    expect(shouldReprobe({ ...base, intervalMs: -5 })).toBe(false);
  });
});
