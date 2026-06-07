import { describe, expect, it } from 'vitest';

import { type ConnectionHealthInput, classifyConnectionHealth } from './sync-store.js';

function input(overrides: Partial<ConnectionHealthInput> = {}): ConnectionHealthInput {
  return {
    online: true,
    syncing: false,
    pendingCount: 0,
    conflictCount: 0,
    apiReachable: null,
    ...overrides,
  };
}

describe('classifyConnectionHealth', () => {
  it('reports ready when online, reachable, and the queue is empty', () => {
    expect(classifyConnectionHealth(input({ apiReachable: true }))).toBe('ready');
  });

  it('treats a never-resolved reachability (null) optimistically as ready', () => {
    expect(classifyConnectionHealth(input({ apiReachable: null }))).toBe('ready');
  });

  it('reports unreachable when the OS is online but real requests are failing', () => {
    // This is THE bug the cluster fixes: navigator.onLine is true while the
    // API/tunnel is down — it must NOT show green "Bereit".
    expect(classifyConnectionHealth(input({ online: true, apiReachable: false }))).toBe(
      'unreachable',
    );
  });

  it('reports offline when the OS reports no network, regardless of reachability', () => {
    expect(classifyConnectionHealth(input({ online: false, apiReachable: false }))).toBe('offline');
    expect(classifyConnectionHealth(input({ online: false, apiReachable: true }))).toBe('offline');
  });

  it('prioritises conflict (data integrity) over every other state', () => {
    expect(
      classifyConnectionHealth(
        input({ conflictCount: 1, online: false, apiReachable: false, pendingCount: 5 }),
      ),
    ).toBe('conflict');
  });

  it('reports syncing when there are pending rows on a reachable connection', () => {
    expect(classifyConnectionHealth(input({ pendingCount: 3, apiReachable: true }))).toBe(
      'syncing',
    );
  });

  it('reports syncing when the replay loop is actively draining', () => {
    expect(classifyConnectionHealth(input({ syncing: true, apiReachable: true }))).toBe('syncing');
  });

  it('prefers unreachable over syncing when the API is down with a queue', () => {
    // A down API with queued rows is unreachable, not "syncing" — we cannot
    // actually drain the queue, so claiming sync progress would be a lie.
    expect(
      classifyConnectionHealth(input({ pendingCount: 4, apiReachable: false, online: true })),
    ).toBe('unreachable');
  });
});
