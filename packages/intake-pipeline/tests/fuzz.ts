/**
 * Tiny seeded PRNG + generators for property-based tests. Deterministic (fixed
 * seed) so failures reproduce exactly — no fast-check dependency needed.
 */

/** Mulberry32 — fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length);
  // arr is non-empty by contract at all call sites.
  return arr[Math.min(idx, arr.length - 1)] as T;
}

export function intBetween(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function maybe<T>(rng: () => number, value: T, p = 0.5): T | null {
  return rng() < p ? value : null;
}
