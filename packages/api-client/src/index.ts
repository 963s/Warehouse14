/**
 * @warehouse14/api-client
 *
 * Typed HTTP wrapper around the frozen Warehouse14 API surface.
 *
 * Design rules (memory.md #74):
 *   • One file per route domain (auth, products, customers, transactions,
 *     appraisals, photos, ebay, dashboard, …) — no monolithic god-client.
 *   • Methods are thin: `await client.products.list({ status: 'AVAILABLE' })`.
 *   • Request/response shapes are imported directly from the backend's
 *     TypeBox schemas where they exist, hand-mirrored where they don't.
 *   • Network errors surface as `ApiError` with the same `code` enum the
 *     backend emits (`STEP_UP_REQUIRED`, `DEVICE_NOT_AUTHORIZED`, etc.).
 *   • Auth: session cookie passed by the browser automatically; Tauri sets
 *     the cookie via `credentials: 'include'`.
 *
 * V1 ships the lowest-level primitives (`request()`, `ApiError`, `ApiClient`
 * constructor). Per-domain method clusters land alongside their corresponding
 * screens — adding a method is a 4-line PR.
 */

export * from './client.js';
export * from './errors.js';
export * from './types.js';

// Per-domain method clusters + their request/response types
export {
  authPin,
  type ActorRole,
  type AuthSessionResponse,
  type PinLoginRequest,
  type PinLoginResponse,
  type PinStepUpRequest,
  type PinStepUpResponse,
  type SessionActor,
  type SignOutResponse,
} from './domains/auth-pin.js';
export {
  dashboard,
  type DashboardSummary,
} from './domains/dashboard.js';
export {
  isAlertEvent,
  parseLedgerEvent,
  shouldInvalidateDashboard,
  type LedgerEvent,
  type LedgerEventType,
} from './domains/ledger.js';
export {
  appraisalsApi,
  type AppraisalCompleteBody,
  type AppraisalItemBody,
  type AppraisalItemView,
  type AppraisalOpenBody,
  type AppraisalRejectBody,
  type AppraisalStatus,
  type AppraisalView,
} from './domains/appraisals.js';
export {
  shifts,
  type CashMovementDirection,
  type CashMovementRequest,
  type CashMovementResponse,
  type CloseShiftRequest,
  type OpenShiftRequest,
  type ShiftStatus,
  type ShiftView,
} from './domains/shifts.js';
export {
  productsApi,
  type InventoryAdjustmentBody,
  type InventoryAdjustmentReason,
  type InventoryAdjustmentResponse,
  type Metal,
  // ─── Day-13 extensions ──────────────────────────────────────────────
  type PrimaryCategoryRef,
  type ProductCategoryAssignment,
  type ProductDetail,
  type ProductListQuery,
  type ProductListResponse,
  type ProductListRow,
  type ProductStatus,
  type ProductUpdateBody,
  type ProductUpdateResponse,
  // ────────────────────────────────────────────────────────────────────
  type ReleaseBody,
  type ReleaseReason,
  type ReleaseResponse,
  type ReservationChannel,
  type ReserveBody,
  type ReserveResponse,
  type TaxTreatmentCode,
} from './domains/products.js';
// ── Day 13 / Phase 2.B kick-off — commerce taxonomy ──────────────────
export {
  categoriesApi,
  type CategoryNode,
  type CategoryTreeResponse,
  type CreateCategoryBody,
  type CreateCategoryResponse,
  type DeleteCategoryResponse,
  type SetProductCategoriesBody,
  type SetProductCategoriesResponse,
  type UpdateCategoryBody,
  type UpdateCategoryResponse,
} from './domains/categories.js';
export {
  transactionsApi,
  type AnkaufBody,
  type AnkaufCondition,
  type AnkaufItemType,
  type AnkaufLineItem,
  type AnkaufMetal,
  type AnkaufPayoutMethod,
  type AnkaufResponse,
  type AnkaufResponseProduct,
  type FinalizeBody,
  type FinalizeLineItem,
  type FinalizePayment,
  type FinalizeResponse,
  type PaymentMethod,
  type TransactionDirection,
} from './domains/transactions.js';
export {
  customersApi,
  type CustomerCreateBody,
  type CustomerCreateResponse,
  type CustomerDetail,
  type CustomerKycDocumentBody,
  type CustomerKycDocumentResponse,
  type CustomerKycStampBody,
  type CustomerKycStampResponse,
  type CustomerKycStatus,
  type CustomerLanguage,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerListRow,
  type CustomerTrustChangeBody,
  type CustomerTrustChangeResponse,
  type CustomerTrustLevel,
  type CustomerUpdateBody,
  type CustomerUpdateResponse,
  type KycDocumentType,
} from './domains/customers.js';
export {
  photosApi,
  type PhotoRegisterBody,
  type PhotoRow,
  type PhotoSource,
  type PhotoUploadIntent,
  type PhotoUploadUrlBody,
  type PhotoUploadUrlResponse,
  type PhotoWorkflowState,
} from './domains/photos.js';

// ───────────────────────────────────────────────────────────────────────
// Phase 2.A — public storefront catalog (memory.md §20)
// ───────────────────────────────────────────────────────────────────────
export {
  storefrontApi,
  type StorefrontProduct,
  type StorefrontProductCategoryRef,
  type StorefrontProductsQuery,
  type StorefrontProductsResponse,
  type StorefrontCategoryNode,
  type StorefrontCategoriesResponse,
  type StorefrontBusinessLocation,
  type StorefrontLocationsResponse,
} from './domains/storefront-catalog.js';

// ───────────────────────────────────────────────────────────────────────
// Phase 2.A — Model Context Protocol client (memory.md §20.4)
// ───────────────────────────────────────────────────────────────────────
export {
  mcpApi,
  McpToolError,
  type McpToolManifest,
  type McpToolsListResult,
  type McpToolResult,
  type McpToolContentBlock,
  type GenerateSeoDescriptionArgs,
  type GenerateSeoDescriptionData,
  type AppraiseEstateItemArgs,
  type AppraiseEstateItemData,
} from './domains/mcp.js';
