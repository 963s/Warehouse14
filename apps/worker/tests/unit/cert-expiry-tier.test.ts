/**
 * cert-expiry-tier — pure KassenSichV TSE certificate-expiry classifier.
 *
 * The TSE cert's `valid_to` is REAL Fiskaly data (read at the HIL boundary). This
 * module is the pure decision that turns "days until expiry" into an escalation
 * tier, so the cert-checker job alerts ONCE per escalation (T-30 → T-7 → T-1 →
 * expired) without spamming the same tier. Heavily fixtured — it gates a
 * compliance alert.
 */
import { describe, expect, it } from 'vitest';

import { certExpiryTier, tierRank } from '../../src/lib/cert-expiry-tier.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const inDays = (d: number): Date => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);
const inHours = (h: number): Date => new Date(NOW.getTime() + h * 60 * 60 * 1000);

describe('certExpiryTier — boundaries', () => {
  it('far from expiry (> 30 days) → null', () => {
    expect(certExpiryTier(inDays(60), NOW)).toBeNull();
    expect(certExpiryTier(inDays(31), NOW)).toBeNull();
  });

  it('the T-30 band: 30 days down to just over 7', () => {
    expect(certExpiryTier(inDays(30), NOW)).toBe('T-30');
    expect(certExpiryTier(inDays(8), NOW)).toBe('T-30');
    // 30.9 days → floor 30 → still T-30.
    expect(certExpiryTier(inHours(30 * 24 + 12), NOW)).toBe('T-30');
  });

  it('the T-7 band: 7 days down to just over 1', () => {
    expect(certExpiryTier(inDays(7), NOW)).toBe('T-7');
    expect(certExpiryTier(inDays(2), NOW)).toBe('T-7');
  });

  it('the T-1 band: 1 day or less, still in the future', () => {
    expect(certExpiryTier(inDays(1), NOW)).toBe('T-1');
    expect(certExpiryTier(inHours(12), NOW)).toBe('T-1'); // half a day
    expect(certExpiryTier(inHours(1), NOW)).toBe('T-1');
  });

  it('at or past expiry → expired', () => {
    expect(certExpiryTier(NOW, NOW)).toBe('expired'); // exactly now
    expect(certExpiryTier(new Date(NOW.getTime() - 1), NOW)).toBe('expired'); // 1 ms past
    expect(certExpiryTier(inDays(-1), NOW)).toBe('expired'); // a day past
  });
});

describe('tierRank — escalation ordering', () => {
  it('null < T-30 < T-7 < T-1 < expired', () => {
    expect(tierRank(null)).toBe(0);
    expect(tierRank('T-30')).toBe(1);
    expect(tierRank('T-7')).toBe(2);
    expect(tierRank('T-1')).toBe(3);
    expect(tierRank('expired')).toBe(4);
  });

  it('escalation is detectable: a more urgent tier ranks higher', () => {
    expect(tierRank('T-7') > tierRank('T-30')).toBe(true);
    expect(tierRank('expired') > tierRank('T-1')).toBe(true);
    expect(tierRank('T-30') > tierRank(null)).toBe(true);
    // same tier does NOT escalate (equal ranks → the job's `>` gate is false).
    expect(tierRank('T-7')).toBe(tierRank('T-30') + 1);
  });
});
