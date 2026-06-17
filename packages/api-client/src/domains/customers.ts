/**
 * Customers domain client — Day 8 additive.
 *
 * Wraps the Day-17 customer surface (create + by-id detail) PLUS the
 * Day-8 additive list/search endpoint. Trust + KYC PATCH routes from
 * Day-26 are exposed here so the Ankauf surface can stamp inline.
 *
 *   list(q?)          — GET    /api/customers              (Day 8)
 *   get(id)           — GET    /api/customers/:id          (Day 17)
 *   create(body)      — POST   /api/customers              (Day 17)
 *   stampKyc(id, ...) — PATCH  /api/customers/:id/kyc      (Day 26, step-up required)
 *   setTrust(id, ...) — PATCH  /api/customers/:id/trust    (Day 26, step-up required)
 *
 * The list endpoint returns a minimal projection (no DOB, no address).
 * Decrypted full_name is included for the matched rows so the operator can
 * visually confirm "yes that's the person standing at the counter".
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// Common types
// ────────────────────────────────────────────────────────────────────────

export type CustomerKycStatus = 'NOT_REQUIRED' | 'PENDING' | 'COMPLETED' | 'EXPIRED' | 'FAILED';
export type CustomerTrustLevel = 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED';
export type CustomerLanguage = 'de' | 'en' | 'ar';

/** German display labels for the KYC (GwG) status. Operator-facing surfaces
 *  MUST render these — never the raw SCREAMING_CASE enum value. */
export const CUSTOMER_KYC_STATUS_LABELS: Readonly<Record<CustomerKycStatus, string>> = {
  NOT_REQUIRED: 'Nicht erforderlich',
  PENDING: 'Ausstehend',
  COMPLETED: 'Abgeschlossen',
  EXPIRED: 'Abgelaufen',
  FAILED: 'Fehlgeschlagen',
};

/** German display labels for the customer trust level. */
export const CUSTOMER_TRUST_LEVEL_LABELS: Readonly<Record<CustomerTrustLevel, string>> = {
  NEW: 'Neu',
  VERIFIED: 'Verifiziert',
  VIP: 'VIP',
  SUSPICIOUS: 'Beobachten',
  BANNED: 'Gesperrt',
};

// ────────────────────────────────────────────────────────────────────────
// GET /api/customers
// ────────────────────────────────────────────────────────────────────────

export interface CustomerListQuery {
  q?: string;
  kycVerifiedOnly?: boolean;
  excludeBlocked?: boolean;
  limit?: number;
  offset?: number;
}

export interface CustomerListRow {
  id: string;
  customerNumber: string;
  fullName: string;
  kycStatus: CustomerKycStatus;
  kycVerifiedAt: string | null;
  trustLevel: CustomerTrustLevel;
  sanctionsMatch: boolean;
  cumulativeAnkaufEur: string;
  cumulativeSpendEur: string;
  createdAt: string;
}

export interface CustomerListResponse {
  items: CustomerListRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/customers
// ────────────────────────────────────────────────────────────────────────

export interface CustomerCreateBody {
  fullName: string;
  dateOfBirth?: string; // ISO date or readable string — server stores encrypted
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  vatId?: string | null;
  preferredLanguage?: CustomerLanguage;
  customerTags?: string[];
  retentionYears?: number;
}

export interface CustomerCreateResponse {
  id: string;
  customerNumber: string;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/customers/:id
// ────────────────────────────────────────────────────────────────────────

export interface CustomerDetail {
  id: string;
  customerNumber: string;
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  vatId: string | null;
  preferredLanguage: CustomerLanguage;
  customerTags: string[];
  kycStatus: CustomerKycStatus;
  kycCompletedAt: string | null;
  /** Day-26 column. Operator's eyeball-verification stamp. */
  kycVerifiedAt: string | null;
  trustLevel: CustomerTrustLevel;
  sanctionsMatch: boolean;
  pepMatch: boolean;
  cumulativeSpendEur: string;
  cumulativeAnkaufEur: string;
  cumulativeDebtEur: string;
  /**
   * §10 GwG aggregation context — the sum of this customer's ANKAUF buys inside
   * the configured rolling window (prior buys only, excluding the cart being
   * built now). The POS KYC gate adds the current cart and requires ID when the
   * running window crosses the threshold even if the current buy is under it.
   */
  gwgRollingAnkauf: {
    windowDays: number;
    priorAnkaufEur: string;
  };
  retentionUntil: string;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// PUT /api/customers/:id (Day 10) — update PII; step-up when kyc_verified
// ────────────────────────────────────────────────────────────────────────

export interface CustomerUpdateBody {
  fullName?: string;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  vatId?: string | null;
  preferredLanguage?: CustomerLanguage;
  customerTags?: string[];
}

export interface CustomerUpdateResponse {
  id: string;
  changedFields: string[];
  stepUpEnforced: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/customers/:id/kyc-documents (Day 12 — closes #I-47, step-up)
// ────────────────────────────────────────────────────────────────────────

export type KycDocumentType =
  | 'PERSONALAUSWEIS'
  | 'REISEPASS'
  | 'ID_CARD_EU'
  | 'PASSPORT_EU'
  | 'PASSPORT_NON_EU';

export interface CustomerKycDocumentBody {
  documentType: KycDocumentType;
  /** ISO 3166-1 alpha-2, uppercase. */
  issuingCountryIso2: string;
  issuingAuthority?: string;
  documentNumber: string;
  issuedOn?: string;
  expiresOn: string;
  /**
   * Image payload, base64-encoded (no `data:` prefix). The server compresses,
   * EXIF-strips, AES-256-GCM-encrypts to a LOCAL file (migration 0074) and
   * computes the sha256 — the client no longer supplies an r2Key or hash.
   */
  dataBase64: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  retentionYears?: number;
}

export interface CustomerKycDocumentResponse {
  id: string;
  customerId: string;
  documentType: KycDocumentType;
  capturedAt: string;
  expiresOn: string;
  retentionUntil: string;
}

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/customers/:id/kyc + /trust  (Day 26 — step-up required)
// ────────────────────────────────────────────────────────────────────────

export interface CustomerKycStampBody {
  promoteTrustLevelTo?: 'VERIFIED' | 'VIP';
  notes?: string;
}

export interface CustomerKycStampResponse {
  id: string;
  kycVerifiedAt: string;
  trustLevel: CustomerTrustLevel;
}

export interface CustomerTrustChangeBody {
  trustLevel: CustomerTrustLevel;
  /** Required when trustLevel ∈ {SUSPICIOUS, BANNED}. */
  priceExpectationNotes?: string;
}

export interface CustomerTrustChangeResponse {
  id: string;
  trustLevel: CustomerTrustLevel;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/customers/:id/check-sanctions  (Epic J — GwG PEP/EU/OFAC)
// ────────────────────────────────────────────────────────────────────────

export interface SanctionsCheckResult {
  customerId: string;
  /** Best match score in [0, 1]. */
  score: number;
  /** True iff a real watchlist hit at/above the configured threshold. */
  matched: boolean;
  /** True when the OpenSanctions API was unreachable (fail-safe, not a hit). */
  apiUnavailable?: boolean;
  /** True when no API key is configured and screening was skipped. */
  skipped?: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Querystring helper
// ────────────────────────────────────────────────────────────────────────

function buildQuery(query: CustomerListQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export interface CustomerVatLookupResult {
  id: string;
  customerNumber: string;
  fullName: string;
  vatId: string | null;
}

export const customersApi = {
  list(client: ApiClient, query: CustomerListQuery = {}): Promise<CustomerListResponse> {
    return client.request<CustomerListResponse>('GET', `/api/customers${buildQuery(query)}`);
  },
  get(client: ApiClient, id: string): Promise<CustomerDetail> {
    return client.request<CustomerDetail>('GET', `/api/customers/${encodeURIComponent(id)}`);
  },
  /**
   * Resolve at most ONE customer by VAT id in a single bounded request (the POS
   * B2B checkout). Returns null when no customer matches. CASHIER-allowed (the
   * by-id `get` is ADMIN-only), so this is safe to call from a cashier till.
   */
  findByVatId(client: ApiClient, vatId: string): Promise<CustomerVatLookupResult | null> {
    return client
      .request<{ customer: CustomerVatLookupResult | null }>(
        'GET',
        `/api/customers/by-vat-id?vatId=${encodeURIComponent(vatId)}`,
      )
      .then((r) => r.customer);
  },
  create(client: ApiClient, body: CustomerCreateBody): Promise<CustomerCreateResponse> {
    return client.request<CustomerCreateResponse>('POST', '/api/customers', body);
  },
  update(client: ApiClient, id: string, body: CustomerUpdateBody): Promise<CustomerUpdateResponse> {
    return client.request<CustomerUpdateResponse>(
      'PUT',
      `/api/customers/${encodeURIComponent(id)}`,
      body,
    );
  },
  stampKyc(
    client: ApiClient,
    id: string,
    body: CustomerKycStampBody = {},
  ): Promise<CustomerKycStampResponse> {
    return client.request<CustomerKycStampResponse>(
      'PATCH',
      `/api/customers/${encodeURIComponent(id)}/kyc`,
      body,
    );
  },
  addKycDocument(
    client: ApiClient,
    customerId: string,
    body: CustomerKycDocumentBody,
  ): Promise<CustomerKycDocumentResponse> {
    return client.request<CustomerKycDocumentResponse>(
      'POST',
      `/api/customers/${encodeURIComponent(customerId)}/kyc-documents`,
      body,
    );
  },
  /**
   * Fetch the private KYC ID-document image bytes (WebP). The route is ADMIN +
   * step-up + `Cache-Control: no-store` and is NEVER public, so this goes
   * through the authenticated client (a 403 STEP_UP_REQUIRED triggers the
   * step-up middleware). The cashier/mobile render is a FOLLOW-UP and MUST show
   * the bytes WITHOUT persisting them (e.g. an in-memory data URI, then drop) —
   * inheriting the no-persist contract.
   */
  getKycDocumentImage(client: ApiClient, customerId: string, docId: string): Promise<ArrayBuffer> {
    return client.request<ArrayBuffer>(
      'GET',
      `/api/customers/${encodeURIComponent(customerId)}/kyc-documents/${encodeURIComponent(docId)}/image`,
      undefined,
      { responseType: 'arraybuffer' },
    );
  },
  setTrust(
    client: ApiClient,
    id: string,
    body: CustomerTrustChangeBody,
  ): Promise<CustomerTrustChangeResponse> {
    return client.request<CustomerTrustChangeResponse>(
      'PATCH',
      `/api/customers/${encodeURIComponent(id)}/trust`,
      body,
    );
  },
  checkSanctions(client: ApiClient, customerId: string): Promise<SanctionsCheckResult> {
    return client.request<SanctionsCheckResult>(
      'POST',
      `/api/customers/${encodeURIComponent(customerId)}/check-sanctions`,
    );
  },
};
