/**
 * Phase-2 P1.1 — the bounded bot dispatcher.
 *
 * Replaces the unbounded `void runBot(...)` fire-and-forget at the webhook
 * entrypoints. Three invariants the production-safety fix depends on:
 *   1. concurrency is capped (a Meta retry storm can't exhaust the pg pool);
 *   2. a rejecting task is caught at the top level (the socials path had NO
 *      `.catch` → an unhandledRejection that can crash the process);
 *   3. past a hard queue cap the dispatcher sheds (backpressure) — the inbound
 *      message is already durably stored, so a shed task is recoverable.
 */

import { describe, expect, it, vi } from 'vitest';

import { BoundedDispatcher } from '../../src/lib/bot-dispatch.js';

const silentLog = { warn: () => {}, error: () => {} };

/** A deferred promise whose resolution the test controls. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('BoundedDispatcher', () => {
  it('never runs more than `maxConcurrent` tasks at once', async () => {
    const dispatcher = new BoundedDispatcher(2, silentLog);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, () => deferred());

    for (let i = 0; i < 6; i++) {
      const gate = gates[i];
      if (!gate) throw new Error('missing gate');
      dispatcher.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
      });
    }

    // 2 should be running, 4 queued.
    await Promise.resolve();
    expect(dispatcher.activeCount).toBe(2);
    expect(dispatcher.pendingCount).toBe(4);

    // Release them one at a time; the cap must hold throughout.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    await dispatcher.drain();
    expect(peak).toBe(2);
    expect(dispatcher.activeCount).toBe(0);
  });

  it('drains every queued task (FIFO)', async () => {
    const dispatcher = new BoundedDispatcher(1, silentLog);
    const order: number[] = [];
    for (let i = 0; i < 5; i++) {
      dispatcher.run(async () => {
        order.push(i);
      });
    }
    await dispatcher.drain();
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('catches a rejecting task — no unhandled rejection, logged once', async () => {
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    const errorLog = vi.fn();
    const dispatcher = new BoundedDispatcher(2, { warn: () => {}, error: errorLog });

    dispatcher.run(async () => {
      throw new Error('boom');
    });
    await dispatcher.drain();
    // let any stray microtask settle
    await new Promise((r) => setTimeout(r, 10));

    process.off('unhandledRejection', onUnhandled);
    expect(onUnhandled).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('sheds tasks past the hard queue cap (backpressure)', async () => {
    const warnLog = vi.fn();
    // maxConcurrent 1, queueMax 2 → 1 active + 2 queued accepted; the rest shed.
    const dispatcher = new BoundedDispatcher(1, { warn: warnLog, error: () => {} }, 2);
    const gate = deferred();
    let started = 0;

    for (let i = 0; i < 6; i++) {
      dispatcher.run(async () => {
        started++;
        await gate.promise;
      });
    }
    // 1 running + 2 queued = 3 accepted; 3 shed.
    expect(dispatcher.shed).toBe(3);
    expect(warnLog).toHaveBeenCalled();

    gate.resolve();
    await dispatcher.drain();
    expect(started).toBe(3);
  });
});
