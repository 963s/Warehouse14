import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GROUPING_WINDOW_SECONDS,
  computeGroupingClose,
  decideGroupingAction,
  isWindowExpired,
  parseOverrideCommand,
} from '../src/index.js';

const now = new Date('2026-05-29T12:00:00Z');

describe('grouping window', () => {
  it('computes close at now + window (default 120s)', () => {
    const close = computeGroupingClose(now);
    expect(close.getTime() - now.getTime()).toBe(DEFAULT_GROUPING_WINDOW_SECONDS * 1000);
    expect(computeGroupingClose(now, 60).getTime() - now.getTime()).toBe(60_000);
  });

  it('expires only once now passes the close time', () => {
    const close = computeGroupingClose(now);
    expect(isWindowExpired(close, now)).toBe(false);
    expect(isWindowExpired(close, new Date(close.getTime() + 1))).toBe(true);
    expect(isWindowExpired(close, new Date(close.getTime() - 1))).toBe(false);
  });

  it('a later message slides the window forward', () => {
    const first = computeGroupingClose(now);
    const later = new Date(now.getTime() + 30_000);
    const second = computeGroupingClose(later);
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });
});

describe('decideGroupingAction', () => {
  it('extends on a non-command message (image or caption)', () => {
    const a = decideGroupingAction(null, now);
    expect(a.kind).toBe('extend');
    if (a.kind === 'extend') {
      expect(a.groupingClosesAt.getTime()).toBe(computeGroupingClose(now).getTime());
    }
  });

  it('maps each command to its action', () => {
    expect(decideGroupingAction(parseOverrideCommand('fertig', 'de'), now).kind).toBe('close');
    expect(decideGroupingAction(parseOverrideCommand('neu', 'de'), now).kind).toBe('new_session');
    expect(decideGroupingAction(parseOverrideCommand('abbrechen', 'de'), now).kind).toBe('cancel');
    expect(decideGroupingAction(parseOverrideCommand('hilfe', 'de'), now).kind).toBe('help');
  });

  it('returns a split action carrying the parsed groups', () => {
    const a = decideGroupingAction(parseOverrideCommand('1-2=A,3=B', 'en'), now);
    expect(a.kind).toBe('split');
    if (a.kind === 'split') {
      expect(a.groups).toHaveLength(2);
      expect(a.groups[0]?.photoIndices).toEqual([1, 2]);
    }
  });
});
