/**
 * Intake Drafts domain client. Mirrors
 * `apps/api-cloud/src/routes/intake-drafts.ts` exactly (ADR-0015 Control Desktop).
 */

import type { ApiClient } from '../client.js';

export interface IntakeDraftSummary {
  session_id: string;
  status: string;
  tax_treatment_code: string | null;
  classifier_explanation: string | null;
  german_description: string | null;
  vision_classification: unknown;
  pipeline_errors: unknown;
  created_at: string;
}

export interface IntakeDraftDetail extends IntakeDraftSummary {
  vision_hallmark_detection: unknown;
  marketing_angles: unknown;
  final_data: unknown;
  bg_removed_photo_keys: string[] | null;
}

export interface IntakeDraftPatch {
  finalData?: Record<string, unknown>;
  adminVerificationNote?: string;
}

export interface PublishTargets {
  storefront: boolean;
  ebay: boolean;
  socialFlyer: boolean;
  printSticker: boolean;
}

export interface IntakeLabelData {
  sku: string;
  productName: string;
  weightGrams: string | null;
  karat: string | null;
  storageLocation: string | null;
}

export interface IntakePublishRequest {
  name: string;
  sku: string;
  itemType: string;
  taxTreatmentCode: string;
  acquisitionCostEur: string;
  listPriceEur: string;
  weightGrams?: string;
  karat?: string;
  storageLocation?: string;
  adminVerificationNote: string;
  targets?: PublishTargets;
}

export interface IntakePublishResponse {
  productId: string;
  sessionId: string;
  targets: PublishTargets;
  labelData?: IntakeLabelData;
}

export const intakeDrafts = {
  list(client: ApiClient): Promise<{ items: IntakeDraftSummary[] }> {
    return client.request<{ items: IntakeDraftSummary[] }>('GET', '/api/intake/drafts');
  },
  get(client: ApiClient, sessionId: string): Promise<IntakeDraftDetail> {
    return client.request<IntakeDraftDetail>('GET', `/api/intake/drafts/${sessionId}`);
  },
  patch(
    client: ApiClient,
    sessionId: string,
    body: IntakeDraftPatch,
  ): Promise<{ sessionId: string; finalData: Record<string, unknown> }> {
    return client.request('PATCH', `/api/intake/drafts/${sessionId}`, body);
  },
  publish(
    client: ApiClient,
    sessionId: string,
    body: IntakePublishRequest,
  ): Promise<IntakePublishResponse> {
    return client.request('POST', `/api/intake/drafts/${sessionId}/publish`, body);
  },
};
