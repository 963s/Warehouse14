/**
 * Closings + tax-export domain client. Mirrors
 * `apps/api-cloud/src/routes/closing-export.ts` exactly.
 *
 * `list` is JSON; the two export methods return the raw CSV body (the route
 * streams a file download) via `responseType: 'text'` — without it the client
 * would try to JSON.parse the CSV and fail. Step-up on the downloads is
 * server-enforced; the POS api-client interceptor handles the 403 → PIN → retry.
 */

import type { ApiClient } from '../client.js';

export interface ClosingListItem {
  id: string;
  businessDay: string;
  state: 'COUNTING' | 'FINALIZED';
  verkaufCount: number;
  ankaufCount: number;
  stornoCount: number;
  netVerkaufEur: string;
  netAnkaufEur: string;
  cashVarianceEur: string | null;
  tseFailedCount: number;
  finalizedAt: string | null;
}

export interface ClosingListResponse {
  items: ClosingListItem[];
}

export interface ClosingFinalizeResult {
  id: string;
  businessDay: string;
  state: 'FINALIZED';
  verkaufCount: number;
  ankaufCount: number;
  stornoCount: number;
  grossVerkaufEur: string;
  netVerkaufEur: string;
  cashExpectedEur: string;
  cashCountedEur: string;
  cashVarianceEur: string;
  finalizedAt: string;
}

export const closingsApi = {
  /** GET /api/closings — recent daily closings (ADMIN | READONLY). */
  list(client: ApiClient): Promise<ClosingListResponse> {
    return client.request<ClosingListResponse>('GET', '/api/closings');
  },
  /**
   * POST /api/closings/finalize — write the legal Z-Bon (Tagesabschluss) for a
   * business day (ADMIN + step-up). Omit `businessDay` for the current day.
   */
  finalize(client: ApiClient, businessDay?: string): Promise<ClosingFinalizeResult> {
    return client.request<ClosingFinalizeResult>(
      'POST',
      '/api/closings/finalize',
      businessDay ? { businessDay } : {},
    );
  },
  /** GET /api/closings/:id/export/datev — DATEV EXTF CSV (ADMIN|READONLY + step-up). */
  datevCsv(client: ApiClient, id: string): Promise<string> {
    return client.request<string>(
      'GET',
      `/api/closings/${encodeURIComponent(id)}/export/datev`,
      undefined,
      { responseType: 'text' },
    );
  },
  /** GET /api/closings/:id/export/kassenbericht — Kassenbericht CSV (ADMIN|READONLY + step-up). */
  kassenberichtCsv(client: ApiClient, id: string): Promise<string> {
    return client.request<string>(
      'GET',
      `/api/closings/${encodeURIComponent(id)}/export/kassenbericht`,
      undefined,
      { responseType: 'text' },
    );
  },
  /**
   * GET /api/closings/:id/export/dsfinvk?encoding=base64 — local DSFinV-K
   * bundle ZIP (ADMIN|READONLY + step-up), returned base64-encoded in a text
   * body. The api-client file path is text-only (it can't carry binary), so the
   * caller decodes the base64 → Blob before triggering the download.
   */
  dsfinvkZipBase64(client: ApiClient, id: string): Promise<string> {
    return client.request<string>(
      'GET',
      `/api/closings/${encodeURIComponent(id)}/export/dsfinvk?encoding=base64`,
      undefined,
      { responseType: 'text' },
    );
  },
};
