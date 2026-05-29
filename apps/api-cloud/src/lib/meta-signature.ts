/**
 * Constant-time verification of Meta's `X-Hub-Signature-256` header against the
 * raw request body. Shared by both WhatsApp webhooks (chat + intake).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyMetaSignature(rawBody: string, header: string, secret: string): boolean {
  // Header format: `sha256=<hex>`.
  if (!header.startsWith('sha256=')) return false;
  const candidate = header.slice('sha256='.length).trim();
  if (!/^[0-9a-f]+$/i.test(candidate)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (expected.length !== candidate.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'));
  } catch {
    return false;
  }
}
