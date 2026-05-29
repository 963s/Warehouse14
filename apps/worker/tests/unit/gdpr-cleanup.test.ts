import { describe, expect, it, vi } from 'vitest';

import type { AnyDb } from '@warehouse14/db/client';

// Mock the non-fiscal audit emit so we can assert kyc_purged entries.
const { emitAuditMock } = vi.hoisted(() => ({ emitAuditMock: vi.fn() }));
vi.mock('@warehouse14/audit', () => ({ emitAudit: emitAuditMock }));
emitAuditMock.mockResolvedValue({ id: 1n, createdAt: new Date(0) });

import { type R2Deleter, anonymizeIp, runGdprCleanup } from '../../src/jobs/gdpr-cleanup.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function makeDb(responses: unknown[][]): { db: AnyDb; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn();
  for (const r of responses) execute.mockResolvedValueOnce(r);
  execute.mockResolvedValue([]);
  return { db: { execute } as unknown as AnyDb, execute };
}

describe('anonymizeIp — masking correctness', () => {
  it('zeroes the last octet of an IPv4 address', () => {
    expect(anonymizeIp('203.0.113.45')).toBe('203.0.113.0');
    expect(anonymizeIp('10.20.30.40')).toBe('10.20.30.0');
  });

  it('zeroes the last 80 bits of an IPv6 address (keeps first 48)', () => {
    expect(anonymizeIp('2001:db8:1234:5678:9abc:def0:1234:5678')).toBe('2001:db8:1234::');
    expect(anonymizeIp('2001:0db8:1234::1')).toBe('2001:db8:1234::');
  });

  it('is idempotent — re-masking an already-masked IP is a no-op', () => {
    expect(anonymizeIp('203.0.113.0')).toBe('203.0.113.0');
    expect(anonymizeIp('2001:db8:1234::')).toBe('2001:db8:1234::');
    expect(anonymizeIp('::1')).toBe('::'); // loopback collapses entirely
  });
});

describe('runGdprCleanup — Task A (IP minimization)', () => {
  it('reports the count of audit rows the native UPDATE masked', async () => {
    emitAuditMock.mockClear();
    // Task A UPDATE…RETURNING → 2 old rows masked; Task B SELECT expired → none.
    const { db } = makeDb([[{ id: 'a1' }, { id: 'a2' }], []]);
    const r2Delete: R2Deleter = vi.fn().mockResolvedValue(undefined);

    const summary = await runGdprCleanup({ db, log, r2Delete });

    expect(summary.ipAnonymized).toBe(2);
    expect(summary.kycPurged).toBe(0);
    expect(summary.kycReason).toBe('none_expired');
    expect(r2Delete).not.toHaveBeenCalled();
  });
});

describe('runGdprCleanup — Task B (KYC purge)', () => {
  it('deletes R2 photos, nulls PII, and audits each expired document', async () => {
    emitAuditMock.mockClear();
    const { db, execute } = makeDb([
      [], // Task A: nothing to mask
      [
        { id: 'k1', customer_id: 'c1', document_photo_r2_key: 'kyc/c1/k1.jpg' },
        { id: 'k2', customer_id: 'c2', document_photo_r2_key: 'kyc/c2/k2.jpg' },
      ], // expired
      [{ id: 'owner-1' }], // owner
      // then 2 purge UPDATEs → default []
    ]);
    const r2Delete = vi.fn<R2Deleter>().mockResolvedValue(undefined);

    const summary = await runGdprCleanup({ db, log, r2Delete });

    expect(summary.kycPurged).toBe(2);
    expect(summary.kycErrors).toBe(0);
    expect(r2Delete).toHaveBeenCalledTimes(2);
    expect(r2Delete).toHaveBeenCalledWith('kyc/c1/k1.jpg');
    expect(r2Delete).toHaveBeenCalledWith('kyc/c2/k2.jpg');
    expect(emitAuditMock).toHaveBeenCalledTimes(2);
    const firstAudit = emitAuditMock.mock.calls[0]?.[1] as {
      eventType: string;
      payload: { kycDocumentId: string };
    };
    expect(firstAudit.eventType).toBe('customer.kyc_purged');
    expect(firstAudit.payload.kycDocumentId).toBe('k1');
    // Task A UPDATE + SELECT(expired) + SELECT(owner) + 2 purge UPDATEs = 5.
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('leaves a document LIVE (no purge) when its R2 delete fails, and continues', async () => {
    emitAuditMock.mockClear();
    const { db } = makeDb([
      [],
      [
        { id: 'k1', customer_id: 'c1', document_photo_r2_key: 'kyc/c1/k1.jpg' },
        { id: 'k2', customer_id: 'c2', document_photo_r2_key: 'kyc/c2/k2.jpg' },
      ],
      [{ id: 'owner-1' }],
    ]);
    const r2Delete = vi
      .fn<R2Deleter>()
      .mockRejectedValueOnce(new Error('R2 unreachable')) // k1 fails
      .mockResolvedValue(undefined); // k2 ok

    const summary = await runGdprCleanup({ db, log, r2Delete });

    expect(summary.kycPurged).toBe(1);
    expect(summary.kycErrors).toBe(1);
    // Only the successful document was audited.
    expect(emitAuditMock).toHaveBeenCalledTimes(1);
    expect(
      (emitAuditMock.mock.calls[0]?.[1] as { payload: { kycDocumentId: string } }).payload
        .kycDocumentId,
    ).toBe('k2');
  });

  it('skips the purge when no Owner exists (cannot stamp purged_by_user_id)', async () => {
    emitAuditMock.mockClear();
    const { db } = makeDb([
      [],
      [{ id: 'k1', customer_id: 'c1', document_photo_r2_key: 'kyc/c1/k1.jpg' }],
      [], // no owner
    ]);
    const r2Delete = vi.fn<R2Deleter>().mockResolvedValue(undefined);

    const summary = await runGdprCleanup({ db, log, r2Delete });

    expect(summary.kycPurged).toBe(0);
    expect(summary.kycReason).toBe('no_owner');
    expect(r2Delete).not.toHaveBeenCalled();
    expect(emitAuditMock).not.toHaveBeenCalled();
  });
});
