/**
 * MockProvider — the default, zero-config provider. Deterministic base prices
 * (in €/g) plus a seeded, reproducible jitter so demos look live while tests
 * stay assertable. No network, no API key.
 *
 * NOT for production: every row it writes is stamped `source: 'mock'`, and the
 * job logs a warning if a mock provider runs under NODE_ENV=production.
 */

import { toDecimalString } from './convert.js';
import {
  METAL_KEYS,
  type MetalKey,
  type MetalPriceProvider,
  type NormalizedMetalPrice,
} from './types.js';

/** Plausible €/g anchors (≈ mid-2026 levels) — only used to look realistic. */
const DEFAULT_BASE_PER_GRAM_EUR: Record<MetalKey, number> = {
  gold: 62.3,
  silver: 0.75,
  platinum: 28.15,
  palladium: 40.0,
};

/** ± fraction applied as jitter around the base (0.005 = ±0.5%). */
const DEFAULT_JITTER = 0.005;

export interface MockProviderOptions {
  /** Per-metal base €/g. Defaults to plausible mid-2026 anchors. */
  basePerGramEur?: Record<MetalKey, number>;
  /** Jitter amplitude as a fraction of base (default 0.5%). */
  jitter?: number;
  /** Deterministic seed. Defaults to the current hour bucket (slow drift). */
  seed?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

/** mulberry32 — tiny, fast, fully deterministic PRNG. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockProvider implements MetalPriceProvider {
  public readonly name = 'mock';
  private readonly base: Record<MetalKey, number>;
  private readonly jitter: number;
  private readonly seed: number | undefined;
  private readonly now: () => number;

  public constructor(opts: MockProviderOptions = {}) {
    this.base = opts.basePerGramEur ?? DEFAULT_BASE_PER_GRAM_EUR;
    this.jitter = opts.jitter ?? DEFAULT_JITTER;
    this.seed = opts.seed;
    this.now = opts.now ?? Date.now;
  }

  public fetch(): Promise<NormalizedMetalPrice[]> {
    const nowMs = this.now();
    // Default seed = hour bucket → prices drift slowly but are stable per hour.
    const seed = this.seed ?? Math.floor(nowMs / (60 * 60 * 1000));
    const rand = mulberry32(seed);
    const fetchedAt = new Date(nowMs).toISOString();

    const prices = METAL_KEYS.map((metal) => {
      const base = this.base[metal];
      // rand() ∈ [0,1) → factor ∈ [1 - jitter, 1 + jitter).
      const factor = 1 + (rand() * 2 - 1) * this.jitter;
      return {
        metal,
        pricePerGramEur: toDecimalString(base * factor, 4),
        fetchedAt,
        source: 'mock',
      } satisfies NormalizedMetalPrice;
    });

    return Promise.resolve(prices);
  }
}
