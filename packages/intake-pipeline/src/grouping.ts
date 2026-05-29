/**
 * Multi-image grouping-window logic — ADR-0015 §4. Pure + deterministic.
 *
 * While messages keep arriving from the same staff phone, the window slides to
 * now()+windowSeconds. When now() passes grouping_closes_at the session locks
 * (RECEIVED → GROUPED). Staff text commands override the window immediately.
 */

import type { OverrideCommand, SplitGroup } from './parser/overrideCommands.js';

/** Default sliding window. Configurable via system_settings.intake.grouping_window_seconds. */
export const DEFAULT_GROUPING_WINDOW_SECONDS = 120;

/** When the window should close given a fresh message at `now`. */
export function computeGroupingClose(
  now: Date,
  windowSeconds: number = DEFAULT_GROUPING_WINDOW_SECONDS,
): Date {
  return new Date(now.getTime() + windowSeconds * 1000);
}

/** True once the sliding window has elapsed (session ready to lock). */
export function isWindowExpired(groupingClosesAt: Date, now: Date): boolean {
  return now.getTime() > groupingClosesAt.getTime();
}

export type GroupingAction =
  | { kind: 'extend'; groupingClosesAt: Date }
  | { kind: 'close' }
  | { kind: 'new_session' }
  | { kind: 'cancel' }
  | { kind: 'help' }
  | { kind: 'split'; groups: SplitGroup[] }
  | { kind: 'noop' };

/**
 * Decide how an inbound event affects the open grouping window.
 *   • no command (image / plain caption) → slide the window forward;
 *   • DONE → close now; NEW → start a fresh session; CANCEL → reject;
 *   • HELP → send help; SPLIT → split the session.
 */
export function decideGroupingAction(
  command: OverrideCommand | null,
  now: Date,
  windowSeconds: number = DEFAULT_GROUPING_WINDOW_SECONDS,
): GroupingAction {
  if (command === null) {
    return { kind: 'extend', groupingClosesAt: computeGroupingClose(now, windowSeconds) };
  }
  switch (command.type) {
    case 'DONE':
      return { kind: 'close' };
    case 'NEW':
      return { kind: 'new_session' };
    case 'CANCEL':
      return { kind: 'cancel' };
    case 'HELP':
      return { kind: 'help' };
    case 'SPLIT':
      return { kind: 'split', groups: command.groups };
    default:
      return { kind: 'noop' };
  }
}
