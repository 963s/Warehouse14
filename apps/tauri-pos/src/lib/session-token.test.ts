/**
 * Phase D — the session-token store notifies listeners on every change, so a
 * token RENEWAL (not only login/sign-out) can re-sync the companion hub Bearer.
 *
 * The bug this guards: `companion_set_auth` only fired on login and sign-out,
 * so a mid-shift cloud-token renewal left the hub holding a stale Bearer and
 * every phone proxy call 503'd. Making `setSessionToken` the single change
 * choke point means ANY future renewal path is covered automatically.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { onSessionTokenChange, setSessionToken } from './session-token.js';

afterEach(() => {
  // Reset the module-level cache between tests (null is a no-op if already null).
  setSessionToken(null);
});

describe('onSessionTokenChange', () => {
  it('fires on each real change (login → renewal → sign-out) with the new value', () => {
    const seen: (string | null)[] = [];
    const off = onSessionTokenChange((t) => seen.push(t));

    setSessionToken('tok-1'); // login
    setSessionToken('tok-2'); // mid-shift renewal — the path that used to be missed
    setSessionToken(null); // sign-out

    off();
    expect(seen).toEqual(['tok-1', 'tok-2', null]);
  });

  it('does NOT fire when the token is set to the same value (no spurious re-push)', () => {
    setSessionToken('tok-x');
    const fn = vi.fn();
    const off = onSessionTokenChange(fn);
    setSessionToken('tok-x'); // unchanged
    off();
    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivery', () => {
    const fn = vi.fn();
    const off = onSessionTokenChange(fn);
    off();
    setSessionToken('tok-y');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a throwing listener never breaks the token write or other listeners', () => {
    const good = vi.fn();
    const offBad = onSessionTokenChange(() => {
      throw new Error('listener blew up');
    });
    const offGood = onSessionTokenChange(good);

    expect(() => setSessionToken('tok-z')).not.toThrow();
    expect(good).toHaveBeenCalledWith('tok-z');

    offBad();
    offGood();
  });
});
