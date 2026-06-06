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

describe('evaluateKycGate — §10 aggregation (linked sub-threshold buys require ID)', () => {
  const window7 = (priorEur: string) => ({
    priorWindowAnkaufCents: toCents(priorEur),
    windowDays: 7,
  });

  it('current buy UNDER €2.000 but the rolling window crosses → required (reason=aggregate)', () => {
    // €700 now, €1.500 already bought in the window → Σ €2.200 ≥ €2.000.
    const r = evaluateKycGate(toCents('700.00'), customer(null), window7('1500.00'));
    expect(r.thresholdReached).toBe(false); // the single buy alone is under
    expect(r.aggregateReached).toBe(true);
    expect(r.aggregateCents).toBe(toCents('2200.00'));
    expect(r.required).toBe(true);
    expect(r.reason).toBe('aggregate');
  });

  it('exactly at the line via aggregation (≥) → required', () => {
    const r = evaluateKycGate(toCents('500.00'), customer(null), window7('1500.00')); // Σ = 2000.00
    expect(r.aggregateCents).toBe(toCents('2000.00'));
    expect(r.aggregateReached).toBe(true);
    expect(r.required).toBe(true);
  });

  it('aggregate one cent under the line → not required', () => {
    const r = evaluateKycGate(toCents('499.99'), customer(null), window7('1500.00')); // Σ = 1999.99
    expect(r.aggregateReached).toBe(false);
    expect(r.required).toBe(false);
  });

  it('aggregate crosses but the customer is already KYC-verified → not required', () => {
    const r = evaluateKycGate(
      toCents('700.00'),
      customer('2026-01-01T00:00:00Z'),
      window7('1500.00'),
    );
    expect(r.aggregateReached).toBe(true);
    expect(r.kycVerified).toBe(true);
    expect(r.required).toBe(false);
  });

  it('aggregate crosses but no customer selected → not required (nothing to stamp)', () => {
    const r = evaluateKycGate(toCents('700.00'), null, window7('1500.00'));
    expect(r.aggregateReached).toBe(true);
    expect(r.required).toBe(false);
  });

  it('single-tx over the line still wins (reason=single) regardless of aggregate', () => {
    const r = evaluateKycGate(toCents('2500.00'), customer(null), window7('0.00'));
    expect(r.thresholdReached).toBe(true);
    expect(r.required).toBe(true);
    expect(r.reason).toBe('single');
  });

  it('no aggregate context supplied → behaves exactly like the single-tx gate', () => {
    const r = evaluateKycGate(toCents('700.00'), customer(null));
    expect(r.aggregateReached).toBe(false);
    expect(r.required).toBe(false);
  });
});
