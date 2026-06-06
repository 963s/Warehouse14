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

export const closingsApi = {
  /** GET /api/closings — recent daily closings (ADMIN | READONLY). */
  list(client: ApiClient): Promise<ClosingListResponse> {
    return client.request<ClosingListResponse>('GET', '/api/closings');
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
};
