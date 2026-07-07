/**
 * hardware-reprobe — the pure decision behind the mid-shift re-probe (Phase 4.6).
 *
 * A device that drops mid-shift should flip its badge without a manual check, so
 * the auto-connect App re-probes on a low-frequency idle tick. The GATING logic
 * is factored out here as a pure predicate so it is unit-testable without timers,
 * a Tauri runtime, or the DOM — the effect glue (interval + visibilitychange +
 * single-flight) lives in useHardwareAutoConnect and is verified live.
 *
 * The predicate is deliberately conservative: a re-probe fires ONLY when every
 * guard holds, so an idle tick can never hammer a device or fire while a probe
 * (or a device operation that must not be interrupted) is already running.
 */

/** Default idle gap between mid-shift re-probes. */
export const DEFAULT_REPROBE_INTERVAL_MS = 90_000;

export interface ReprobeContext {
  /** Now, in epoch milliseconds. */
  nowMs: number;
  /** When the last probe sweep completed (epoch ms), or null if never probed. */
  lastSweepAtMs: number | null;
  /** Minimum idle gap between re-probes, in milliseconds. */
  intervalMs: number;
  /** The tab/window is hidden — a backgrounded till must not probe. */
  documentHidden: boolean;
  /** A probe, or a device operation that must not be interrupted, is running. */
  inFlight: boolean;
  /** The hardware config has finished hydrating. */
  loaded: boolean;
  /** We are inside the Tauri webview (browser dev has no devices to probe). */
  inTauri: boolean;
}

/**
 * True iff a mid-shift re-probe should fire now. A never-probed device
 * (`lastSweepAtMs === null`) with every other guard satisfied is treated as due.
 */
export function shouldReprobe(ctx: ReprobeContext): boolean {
  if (!ctx.inTauri) return false;
  if (!ctx.loaded) return false;
  if (ctx.documentHidden) return false;
  if (ctx.inFlight) return false;
  if (ctx.intervalMs <= 0) return false;

  const elapsed =
    ctx.lastSweepAtMs === null ? Number.POSITIVE_INFINITY : ctx.nowMs - ctx.lastSweepAtMs;
  return elapsed >= ctx.intervalMs;
}
