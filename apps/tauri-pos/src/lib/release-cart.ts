/**
 * release-cart — best-effort batch release for cart-line reservations.
 *
 * Three callers share this helper to keep the release semantics identical:
 *   • CartPanel "Karte leeren"           (operator-explicit clear)
 *   • AppShell sign-out cascade          (must not leak inventory)
 *   • Verkauf cold-start cleanup edge    (Phase 1.5 #I-35 candidate)
 *
 * Semantics: fire `inventoryApi.release` in parallel for every line; never
 * throw. Network / server errors are swallowed because the operator
 * decision (clear-cart, sign-out) must complete regardless. If a release
 * silently fails, the reservation will remain held server-side; for POS
 * channel that means a single item is temporarily out of catalog until
 * the Owner manually un-reserves OR the next operator who tries to use
 * it gets a 409 and refreshes (the reserve route will then re-grab the
 * row if it was actually un-held in the meantime).
 *
 * Returns the number of attempted releases — handy for log lines / future
 * telemetry. Does NOT return per-line outcomes (callers don't need them;
 * the operator UX has already moved on).
 */

import { type ReleaseReason, productsApi } from '@warehouse14/api-client';

import type { ApiClient } from '@warehouse14/api-client';
import type { CartLine } from '../state/cart-store.js';

export interface ReleaseCartInput {
  api: ApiClient;
  lines: readonly CartLine[];
  reason: ReleaseReason;
}

export async function releaseCart(input: ReleaseCartInput): Promise<number> {
  const { api, lines, reason } = input;
  if (lines.length === 0) return 0;

  // `allSettled` so a single network failure doesn't take down the batch.
  await Promise.allSettled(
    lines.map((line) =>
      productsApi.release(api, {
        productId: line.productId,
        sessionId: line.reservationSessionId,
        reason,
      }),
    ),
  );

  return lines.length;
}
