import { describe, expect, it } from 'vitest';

import {
  type ExpiredAppointment,
  NO_SHOW_RELEASE_REASON,
  type NoShowDeps,
  detectNoShows,
} from '../../src/lib/no-show-detector.js';

/** A fake DB that records the operations the detector performs. */
function makeFakeDeps(expired: ExpiredAppointment[]) {
  const calls = {
    markNoShow: [] as string[],
    releaseHolds: [] as Array<{ id: string; reason: string }>,
    followUps: [] as string[],
  };
  const deps: NoShowDeps = {
    listExpired: () => Promise.resolve(expired),
    markNoShow: (id) => {
      calls.markNoShow.push(id);
      return Promise.resolve();
    },
    releaseHolds: (id, reason) => {
      calls.releaseHolds.push({ id, reason });
      return Promise.resolve(2); // pretend 2 holds released per appointment
    },
    queueFollowUp: (a) => {
      calls.followUps.push(a.id);
      return Promise.resolve();
    },
  };
  return { deps, calls };
}

describe('detectNoShows', () => {
  it('marks NO_SHOW, releases holds, and queues a follow-up per expired appointment', async () => {
    const expired: ExpiredAppointment[] = [
      { id: 'a1', customerId: 'c1', recipient: '+491700000001' },
      { id: 'a2', customerId: 'c2', recipient: 'kunde@example.de' },
    ];
    const { deps, calls } = makeFakeDeps(expired);

    const res = await detectNoShows(deps, {
      graceMinutes: 30,
      now: new Date('2026-05-29T11:00:00Z'),
    });

    expect(res.markedNoShow).toEqual(['a1', 'a2']);
    expect(calls.markNoShow).toEqual(['a1', 'a2']);
    expect(res.holdsReleased).toBe(4); // 2 per appointment
    expect(calls.releaseHolds).toEqual([
      { id: 'a1', reason: NO_SHOW_RELEASE_REASON },
      { id: 'a2', reason: NO_SHOW_RELEASE_REASON },
    ]);
    expect(res.followUpsQueued).toBe(2);
    expect(calls.followUps).toEqual(['a1', 'a2']);
  });

  it('skips the follow-up when no recipient is resolvable, but still marks + releases', async () => {
    const { deps, calls } = makeFakeDeps([{ id: 'a3', customerId: null, recipient: null }]);

    const res = await detectNoShows(deps, { graceMinutes: 30 });

    expect(res.markedNoShow).toEqual(['a3']);
    expect(res.holdsReleased).toBe(2);
    expect(res.followUpsQueued).toBe(0);
    expect(calls.followUps).toEqual([]);
  });

  it('does nothing when there are no expired appointments', async () => {
    const { deps } = makeFakeDeps([]);
    const res = await detectNoShows(deps, { graceMinutes: 45 });
    expect(res).toEqual({ markedNoShow: [], holdsReleased: 0, followUpsQueued: 0 });
  });
});
