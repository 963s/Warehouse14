/**
 * digit-nav — the pure decision behind number-key navigation.
 *
 * The rail shows 1–8 but the keys were never bound (UX-REDESIGN §1 gap 2).
 * This resolver decides whether a keypress should jump to a primary surface,
 * and — critically — when it MUST NOT (so typing "3" into a price field or
 * while a dialog is open never navigates).
 */
import { describe, expect, it } from 'vitest';

import { type DigitNavSurface, resolveDigitNavPath } from './digit-nav.js';

const SURFACES: readonly DigitNavSurface[] = [
  { digit: 1, path: '/verkauf' },
  { digit: 2, path: '/ankauf' },
  { digit: 3, path: '/kasse' },
  { digit: 4, path: '/lager' },
  { digit: 8, path: '/schreiben' },
];

const NEUTRAL = { hasModifier: false, isTextEntry: false, isDialogOpen: false } as const;

describe('resolveDigitNavPath', () => {
  it('jumps to the surface whose digit matches, from neutral focus', () => {
    expect(resolveDigitNavPath({ key: '3', ...NEUTRAL }, SURFACES)).toBe('/kasse');
    expect(resolveDigitNavPath({ key: '1', ...NEUTRAL }, SURFACES)).toBe('/verkauf');
    expect(resolveDigitNavPath({ key: '8', ...NEUTRAL }, SURFACES)).toBe('/schreiben');
  });

  it('is suppressed while a text-entry element is focused (typing a number into a field)', () => {
    expect(
      resolveDigitNavPath(
        { key: '3', hasModifier: false, isTextEntry: true, isDialogOpen: false },
        SURFACES,
      ),
    ).toBeNull();
  });

  it('is suppressed while a dialog / Spotlight is open', () => {
    expect(
      resolveDigitNavPath(
        { key: '3', hasModifier: false, isTextEntry: false, isDialogOpen: true },
        SURFACES,
      ),
    ).toBeNull();
  });

  it('does not hijack modifier combos (Cmd/Ctrl/Alt + digit)', () => {
    expect(
      resolveDigitNavPath(
        { key: '3', hasModifier: true, isTextEntry: false, isDialogOpen: false },
        SURFACES,
      ),
    ).toBeNull();
  });

  it('returns null for non-digit keys, 0, and digits without a surface', () => {
    expect(resolveDigitNavPath({ key: 'a', ...NEUTRAL }, SURFACES)).toBeNull();
    expect(resolveDigitNavPath({ key: '0', ...NEUTRAL }, SURFACES)).toBeNull();
    expect(resolveDigitNavPath({ key: '9', ...NEUTRAL }, SURFACES)).toBeNull(); // no surface at 9
    expect(resolveDigitNavPath({ key: 'Enter', ...NEUTRAL }, SURFACES)).toBeNull();
  });
});
