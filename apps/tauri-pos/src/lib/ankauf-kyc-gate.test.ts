import { describe, expect, it } from 'vitest';

import { evaluateKycGate } from './ankauf-kyc-gate.js';
import { toCents } from './intake-math.js';

/** Minimal customer shape the gate reads. */
const customer = (kycVerifiedAt: string | null) => ({ kycVerifiedAt });

describe('evaluateKycGate (GwG §10 identity threshold = €2.000, ≥)', () => {
  it('below the threshold → nothing required', () => {
    const r = evaluateKycGate(toCents('1999.99'), customer(null));
    expect(r.thresholdReached).toBe(false);
    expect(r.required).toBe(false);
  });

  it('exactly at the €2.000 boundary counts as reached (≥), un-verified → required', () => {
    const r = evaluateKycGate(toCents('2000.00'), customer(null));
    expect(r.thresholdReached).toBe(true);
    expect(r.kycVerified).toBe(false);
    expect(r.required).toBe(true);
  });

  it('one cent under the boundary is NOT reached', () => {
    expect(evaluateKycGate(toCents('1999.99'), customer(null)).thresholdReached).toBe(false);
    expect(evaluateKycGate(toCents('2000.00'), customer(null)).thresholdReached).toBe(true);
  });

  it('above the threshold but the customer is already KYC-verified → not required', () => {
    const r = evaluateKycGate(toCents('5000.00'), customer('2026-01-01T10:00:00Z'));
    expect(r.thresholdReached).toBe(true);
    expect(r.kycVerified).toBe(true);
    expect(r.required).toBe(false);
  });

  it('no customer selected → never required (nothing to stamp yet), but threshold still reflected', () => {
    const r = evaluateKycGate(toCents('9999.00'), null);
    expect(r.thresholdReached).toBe(true);
    expect(r.kycVerified).toBe(false);
    expect(r.required).toBe(false);
  });

  it('empty cart (0) with a customer → not required', () => {
    expect(evaluateKycGate(0n, customer(null)).required).toBe(false);
  });
});
