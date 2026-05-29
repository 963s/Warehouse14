/**
 * Shipping domain client (Epic D).
 *
 *   dhlLabel(body) — POST /api/shipping/dhl-label (ADMIN + CASHIER)
 *
 * Generates a DHL label for a WEB order and returns the tracking number plus
 * the Base64 PDF label for download/printing.
 */

import type { ApiClient } from '../client.js';

export interface DhlLabelRequest {
  transactionId: string;
}

export interface DhlLabelResponse {
  trackingNumber: string;
  /** Base64-encoded PDF shipping label. */
  labelBase64: string;
  /** True when DHL credentials are absent and a mock label was produced. */
  mock: boolean;
}

export const shippingApi = {
  dhlLabel(client: ApiClient, body: DhlLabelRequest): Promise<DhlLabelResponse> {
    return client.request<DhlLabelResponse>('POST', '/api/shipping/dhl-label', body);
  },
};
