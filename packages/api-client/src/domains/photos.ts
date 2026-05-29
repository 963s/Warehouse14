/**
 * Photos domain client. Mirrors `apps/api-cloud/src/routes/photos.ts`
 * + the Day-12 additive `photo-upload-url.ts`.
 *
 *   requestUploadUrl(body) — POST /api/photos/upload-url     (Day 12; product-agnostic)
 *   register(body)         — POST /api/photos                (Day 24; bind r2_key → row)
 *   listUnassigned(query)  — GET  /api/photos/unassigned
 *   transitionState(id,…)  — PATCH /api/photos/:id/workflow-state
 *
 * Product-bound upload URL stays on the products domain:
 *   productsApi.requestPhotoUpload(productId, body) — POST /api/products/:id/photos
 */

import type { ApiClient } from '../client.js';

export type PhotoSource =
  | 'intake'
  | 'admin_upload'
  | 'storefront_user'
  | 'photographer'
  | 'phone_intake';
export type PhotoWorkflowState =
  | 'FOTOGRAFIERT'
  | 'BEARBEITET'
  | 'FREIGESTELLT'
  | 'ZUGEORDNET'
  | 'FUER_EBAY_BEREIT';

// ────────────────────────────────────────────────────────────────────────
// POST /api/photos/upload-url
// ────────────────────────────────────────────────────────────────────────

export type PhotoUploadIntent = 'product' | 'kyc' | 'orphan';

export interface PhotoUploadUrlBody {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  contentLength: number;
  intent?: PhotoUploadIntent;
}

export interface PhotoUploadUrlResponse {
  r2Key: string;
  uploadUrl: string;
  publicUrl: string;
  requiredHeaders: { 'content-type': string };
  expiresAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/photos
// ────────────────────────────────────────────────────────────────────────

export interface PhotoRegisterBody {
  r2Key: string;
  productId?: string;
  source?: PhotoSource;
  /** Optional initial display metadata. */
  isPrimary?: boolean;
  altTextDe?: string;
  altTextEn?: string;
}

export interface PhotoRow {
  id: string;
  productId: string | null;
  r2Key: string;
  r2KeyBgRemoved: string | null;
  displayOrder: number;
  isPrimary: boolean;
  source: PhotoSource;
  altTextDe: string | null;
  altTextEn: string | null;
  workflowState: PhotoWorkflowState;
  workflowChangedAt: string;
  workflowChangedByUserId: string | null;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export const photosApi = {
  requestUploadUrl(client: ApiClient, body: PhotoUploadUrlBody): Promise<PhotoUploadUrlResponse> {
    return client.request<PhotoUploadUrlResponse>('POST', '/api/photos/upload-url', body);
  },
  register(client: ApiClient, body: PhotoRegisterBody): Promise<PhotoRow> {
    return client.request<PhotoRow>('POST', '/api/photos', body);
  },
};
