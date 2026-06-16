/**
 * Phase D — `syncCompanionAuthWithSession` keeps the companion hub's mother
 * Bearer in lockstep with the session token. A renewal pushes the NEW Bearer; a
 * sign-out clears it. This is what stops the "503 on every phone after a
 * mid-shift renewal" failure: the hub never holds a stale token.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (_cmd: string, _args?: unknown) => undefined);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import { syncCompanionAuthWithSession } from './companion-bridge.js';
import { setSessionToken } from './session-token.js';

afterEach(() => {
  setSessionToken(null);
  invoke.mockClear();
});

describe('syncCompanionAuthWithSession', () => {
  it('re-pushes the new Bearer to the hub when the token is renewed mid-shift', async () => {
    const off = syncCompanionAuthWithSession();
    setSessionToken('renewed-token');
    await Promise.resolve(); // let the best-effort async push settle
    off();
    expect(invoke).toHaveBeenCalledWith('companion_set_auth', { bearer: 'renewed-token' });
  });

  it('clears the hub Bearer when the session ends', async () => {
    setSessionToken('live'); // establish before subscribing (no listener yet)
    const off = syncCompanionAuthWithSession();
    invoke.mockClear();
    setSessionToken(null);
    await Promise.resolve();
    off();
    expect(invoke).toHaveBeenCalledWith('companion_set_auth', { bearer: '' });
  });

  it('unsubscribe halts further hub syncs', async () => {
    const off = syncCompanionAuthWithSession();
    off();
    setSessionToken('after-unsub');
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
});
