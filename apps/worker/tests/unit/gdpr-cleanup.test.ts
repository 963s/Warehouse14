import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AnyDb } from '@warehouse14/db/client';

// Mock the non-fiscal audit emit so we can assert kyc_purged entries.
const { emitAuditMock } = vi.hoisted(() => ({ emitAuditMock: vi.fn() }));
vi.mock('@warehouse14/audit', () => ({ emitAudit: emitAuditMock }));
emitAuditMock.mockResolvedValue({ id: 1n, createdAt: new Date(0) });

import {
  type KycImageDeleter,
  anonymizeIp,
  createLocalKycDeleter,
  runGdprCleanup,
} from '../../src/jobs/gdpr-cleanup.js';

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
    const kycDelete: KycImageDeleter = vi.fn().mockResolvedValue(undefined);

    const summary = await runGdprCleanup({ db, log, kycDelete });

    expect(summary.ipAnonymized).toBe(2);
    expect(summary.kycPurged).toBe(0);
    expect(summary.kycReason).toBe('none_expired');
    expect(kycDelete).not.toHaveBeenCalled();
  });
});

describe('runGdprCleanup — Task B (KYC purge)', () => {
  it('deletes the local encrypted files, nulls PII, and audits each expired document', async () => {
    emitAuditMock.mockClear();
    const { db, execute } = makeDb([
      [], // Task A: nothing to mask
      [
        { id: 'k1', customer_id: 'c1', document_photo_storage_key: 'sk-c1-k1' },
        { id: 'k2', customer_id: 'c2', document_photo_storage_key: 'sk-c2-k2' },
      ], // expired
      [{ id: 'owner-1' }], // owner
      // then 2 purge UPDATEs → default []
    ]);
    const kycDelete = vi.fn<KycImageDeleter>().mockResolvedValue(undefined);

    const summary = await runGdprCleanup({ db, log, kycDelete });

    expect(summary.kycPurged).toBe(2);
    expect(summary.kycErrors).toBe(0);
    expect(kycDelete).toHaveBeenCalledTimes(2);
    expect(kycDelete).toHaveBeenCalledWith('sk-c1-k1');
    expect(kycDelete).toHaveBeenCalledWith('sk-c2-k2');
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

  it('leaves a document LIVE (no purge) when its file delete fails, and continues', async () => {
    emitAuditMock.mockClear();
    const { db } = makeDb([
      [],
      [
        { id: 'k1', customer_id: 'c1', document_photo_storage_key: 'sk-c1-k1' },
        { id: 'k2', customer_id: 'c2', document_photo_storage_key: 'sk-c2-k2' },
      ],
      [{ id: 'owner-1' }],
    ]);
    const kycDelete = vi
      .fn<KycImageDeleter>()
      .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' })) // k1 fails
      .mockResolvedValue(undefined); // k2 ok

    const summary = await runGdprCleanup({ db, log, kycDelete });

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
      [{ id: 'k1', customer_id: 'c1', document_photo_storage_key: 'sk-c1-k1' }],
      [], // no owner
    ]);
    const kycDelete = vi.fn<KycImageDeleter>().mockResolvedValue(undefined);

    const summary = await runGdprCleanup({ db, log, kycDelete });

    expect(summary.kycPurged).toBe(0);
    expect(summary.kycReason).toBe('no_owner');
    expect(kycDelete).not.toHaveBeenCalled();
    expect(emitAuditMock).not.toHaveBeenCalled();
  });
});

describe('createLocalKycDeleter — real on-disk erasure (GwG/DSGVO §35)', () => {
  it('removes the encrypted .enc file from its shard directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kyc-del-'));
    const storageKey = 'AB-1234-5678';
    const shard = storageKey.slice(0, 2).toLowerCase(); // 'ab'
    const file = join(dir, shard, `${storageKey}.enc`);
    await mkdir(join(dir, shard), { recursive: true });
    await writeFile(file, Buffer.from([0x01, 0x02, 0x03]));
    await expect(access(file)).resolves.toBeUndefined(); // exists before

    await createLocalKycDeleter(dir)(storageKey);

    await expect(access(file)).rejects.toThrow(); // gone after — erasure honoured
  });

  it('is a no-op when the file is already gone (force) — idempotent erasure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kyc-del-'));
    await expect(createLocalKycDeleter(dir)('NO-such-key')).resolves.toBeUndefined();
  });

  it('does nothing without a photos dir (doc-store-only deployment)', async () => {
    await expect(createLocalKycDeleter('')('AB-1234-5678')).resolves.toBeUndefined();
  });
});
