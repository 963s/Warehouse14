/**
 * The single authenticated api-cloud client for the staff app.
 *
 * P0: switches the POC's anonymous client to a real session —
 *   • defaultHeaders injects the DEV device fingerprint past the mTLS wall
 *     (dev bypass; mtls.ts reads `x-dev-device-fingerprint` in NODE_ENV=dev).
 *     THIS IS A DEV SEED — it must retire for real per-phone mTLS at go-live.
 *   • getAuthToken carries the PIN-login session token as `Authorization:
 *     Bearer` (RN has no cookie jar).
 *   • stepUpMiddleware transparently re-auths + retries on 403 STEP_UP_REQUIRED
 *     via the native PIN Dialog (see step-up.ts).
 *
 * The data layer is the EXISTING @warehouse14/api-client package — only the
 * client is constructed here; the domain methods (authPin, productsApi) are
 * free functions taking the client first.
 */
import {
  ApiError,
  appraisalsApi,
  authPin,
  belegtextApi,
  bridgeApi,
  categoriesApi,
  closingsApi,
  createApiClient,
  customersApi,
  dashboard,
  documentsApi,
  ebayApi,
  expensesApi,
  financeApi,
  fixedCostsApi,
  ledgerQueryApi,
  metalPricesApi,
  photosApi,
  productsApi,
  shifts,
  supportApi,
  tasksApi,
  transactionsApi,
  whatsappApi,
  circuitBreakerMiddleware,
  inflightDedupMiddleware,
  retryMiddleware,
  stepUpMiddleware,
  type ApiClient,
  type AppraisalCompleteBody,
  type AppraisalItemBody,
  type AppraisalOpenBody,
  type AppraisalView,
  type BridgeSummary,
  type CategoryTreeResponse,
  type CreateCategoryBody,
  type CreateCategoryResponse,
  type DeleteCategoryResponse,
  type UpdateCategoryBody,
  type UpdateCategoryResponse,
  type ClosingListItem,
  type CreateProductBody,
  type CreateProductResponse,
  type ProductDeleteResponse,
  type ProductUpdateBody,
  type ProductUpdateResponse,
  type CreateTaskBody,
  type CurrentBelegtextQuery,
  type CurrentBelegtextResponse,
  type CurrentMetalPrice,
  type CurrentMetalPricesResponse,
  type MetalRatesResponse,
  type CustomerCreateBody,
  type CustomerCreateResponse,
  type CustomerDetail,
  type CustomerWebOrder,
  type CustomerKycDocumentBody,
  type CustomerKycDocumentResponse,
  type DashboardSummary,
  type ListDocumentsQuery,
  type ListDocumentsResponse,
  type EbayHistoryQuery,
  type EbayHistoryResponse,
  type EbayPublishResponse,
  type EbayTransitionBody,
  type EbayTransitionResponse,
  type CustomerKycStampBody,
  type CustomerKycStampResponse,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerTrustChangeBody,
  type CustomerTrustChangeResponse,
  type CustomerUpdateBody,
  type CustomerUpdateResponse,
  type CreateExpenseBody,
  type CreateFixedCostBody,
  type ExpenseRow,
  type FinancePeriod,
  type FixedCostRow,
  type InventoryValueResponse,
  type ListExpensesQuery,
  type ListExpensesResponse,
  type ListFixedCostsQuery,
  type ListFixedCostsResponse,
  type MetalWeightsResponse,
  type MonthRevenueResponse,
  type ProfitResponse,
  type UpdateExpenseBody,
  type UpdateFixedCostBody,
  type FinalizeBody,
  type FinalizeResponse,
  type InventoryAdjustmentBody,
  type LedgerEvent,
  type LedgerListQuery,
  type LedgerListResponse,
  type LedgerListRow,
  type ListBelegtextQuery,
  type ListBelegtextResponse,
  type PublishBelegtextBody,
  type PublishBelegtextResponse,
  type ListTasksQuery,
  type ListTasksResponse,
  type PhotoRow,
  type AuthSessionResponse,
  type ProductDetail,
  type ProductListQuery,
  type ProductListResponse,
  type RecentTransactionsResponse,
  type ReserveBody,
  type ReserveResponse,
  type ReleaseBody,
  type ReleaseResponse,
  type ReleaseBatchBody,
  type ReleaseBatchResponse,
  type RescheduleRequest,
  type SetProductCategoriesBody,
  type SetProductCategoriesResponse,
  type AnkaufBody,
  type AnkaufResponse,
  type OpenShiftRequest,
  type ShiftView,
  type SupportTicketDetail,
  type SupportTicketSummary,
  type TaskRow,
  type TicketStatus,
  type TransitionTaskBody,
  type UpdateMarginBody,
  type UpdateMarginResponse,
  type UpdateTaskBody,
  type WhatsAppAiStatusResponse,
  type WhatsAppLinkCustomerResponse,
  type WhatsAppMarkHandledResponse,
  type WhatsAppSendBody,
  type WhatsAppSendResponse,
  type WhatsAppThreadDetail,
  type WhatsAppThreadListResponse,
} from "@warehouse14/api-client"
import { Money } from "@warehouse14/domain/money"

import { classifyScanMatch, type ScanMatch } from "./scan-resolve"
import { clearSession, getSessionToken, setAuthTokenSilently, setSession } from "./session"
import { stepUpService } from "./step-up"
import { setConnectionProbe } from "./ui/data/connection"

/**
 * The API origin.
 *
 * PRODUCTION is the default — the live app MUST talk to https://api.warehouse14.de.
 * A stale Mac LAN IP here was the root cause of the login bug (HTTP 000 timeout →
 * "Keine Verbindung zum Server"): every device build fell back to a dead local IP
 * because EXPO_PUBLIC_API_BASE_URL was never set in any build profile. Production
 * is now the safe default; local dev OVERRIDES it explicitly.
 *
 * Local dev: set EXPO_PUBLIC_API_BASE_URL=http://localhost:3001 (or your Mac LAN
 * IP) in apps/mobile/.env before `pnpm start`. The iOS Simulator reaches
 * localhost directly; a physical device needs the Mac's LAN IP + adb reverse on
 * Android. NEVER commit a LAN IP as the fallback — it only works on one network.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.warehouse14.de"

// While the app is offline, the connection store pings /health every ~10s so
// the wifi coming back is NOTICED without any user gesture — the store flips
// online, focused screens revalidate, the banner clears (its promise of
// "Aktualisierung erfolgt automatisch" becomes true). Plain fetch, no auth,
// 5s cap; resolve = reachable, anything else = still offline.
setConnectionProbe(async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal })
    if (!res.ok) throw new Error(`health ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
})

/**
 * DEV device fingerprint = SHA-256 of the dev cert seeded by api-cloud's
 * dev-bootstrap (devices.cert_serial). Override via
 * EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT. DEV ONLY — retires at go-live.
 */
export const DEV_DEVICE_FINGERPRINT =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"

/**
 * The resilience stack — mirrors the production tauri-pos ordering (asserted by
 * its CI test) so the Owner phone gets the SAME 429/flap protection the counter
 * terminal has. Outermost → innermost:
 *
 *   step-up   replays a single attempt after a STEP_UP_REQUIRED PIN dialog.
 *   retry     idempotent reads only: full-jitter exponential backoff that
 *             HONORS the server's `Retry-After` on a 429 (the api-client lifts
 *             it onto `ApiError.details.retryAfterMs`). This is the core of the
 *             "Zu viele Versuche" fix — a rate-limited read now waits the budget
 *             window and silently recovers instead of throwing a red error.
 *   circuit   per-endpoint breaker: after repeated 429/5xx on one bucket it
 *             fast-fails for a cooldown so a struggling endpoint isn't hammered
 *             (and the retry budget isn't burnt) — degrades to a calm banner.
 *   dedup     coalesces concurrent identical GETs at the transport layer, a
 *             second line below the hook-level `dedupe` (different keys, same
 *             goal: never send the same read twice at once).
 *
 * The mobile app keeps its OWN offline model (the `offline/` module + the
 * read-cache), so the durable offline-queue middleware is intentionally absent
 * here — reads that can't reach the cloud surface as a calm offline state, not
 * a queued mutation.
 *
 * Retry budget — FAIL FAST over a slow LTE link. Only reads (GET/HEAD) are
 * retried; a write is never silently re-sent. We keep retries SHORT (2 attempts
 * = 1 retry, ≤4s cap) for two reasons the owner felt directly on his phone:
 *   1. a 4-attempt × up-to-8s backoff turned a single failing tap into a 6-14s
 *      silent freeze — a fast honest "offline, showing cached" beats a long stall.
 *   2. each retried read spends another request against the per-actor rate
 *      budget; 4× retries on a fan-out of polls is exactly what tripped the
 *      "Zu viele Versuche" 429. Halving the retries halves that burn.
 * The circuit breaker + the offline read-cache + the server's Retry-After carry
 * resilience; the retry layer no longer has to brute-force through a slow link.
 */
export const apiClient: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  credentials: "include",
  // Reads are small JSON cushioned by the stale-while-revalidate cache, so a
  // tight 10s per-attempt window surfaces the calm offline state fast instead
  // of a long spinner. Heavy payloads opt into their own budget per call
  // (photo + KYC uploads use 60s inside the api-client domain methods).
  timeoutMs: 10_000,
  defaultHeaders: { "x-dev-device-fingerprint": DEV_DEVICE_FINGERPRINT },
  getAuthToken: getSessionToken,
  middlewares: [
    stepUpMiddleware(stepUpService),
    retryMiddleware({ maxAttempts: 2, baseDelayMs: 300, maxDelayMs: 4_000 }),
    circuitBreakerMiddleware(),
    inflightDedupMiddleware(),
  ],
})

// ── Auth ────────────────────────────────────────────────────────────────────
/**
 * The Owner PIN login. Routed through the api-client's reliable `loginSafe`:
 * it runs DETACHED from any caller signal (a re-render can never abort a login
 * the owner committed to), coalesces a double-submit of the same PIN onto one
 * POST (so the backend's 10/min budget is never halved → no spurious
 * RATE_LIMITED), and silently re-issues once on a transient network/timeout
 * blip. A real answer (401 / PIN_LOCKED / …) is surfaced unchanged.
 */
/** PIN step-up — refreshes the session's step-up window (used by the Dialog). */
export function pinStepUp(pin: string): Promise<unknown> {
  return authPin.stepUp(apiClient, { pin })
}

/** Revoke the current session on the SERVER (POST /api/auth/sign-out) before the
 *  local wipe. Best-effort: the caller still clears the device session if this
 *  fails (offline / flap) so logout never blocks — but on success the token can
 *  never be replayed if the phone is later lost or stolen. */
export function signOut(): Promise<unknown> {
  return authPin.signOut(apiClient)
}

/** Revoke ALL of this owner's sessions on every device (lost-device kill switch,
 *  security review 2026-07-21). Returns the count revoked. */
export function signOutAllDevices(): Promise<{ ok: true; revoked: number }> {
  return authPin.signOutAll(apiClient)
}

/** Fetch the current session actor + profile (GET /api/auth/session). Used after
 *  the Google token handoff to resolve the actor the token-only redirect did not
 *  carry (the same second step the desktop window flow makes). */
export function authProbe(): Promise<AuthSessionResponse> {
  return authPin.sessionSafe(apiClient)
}

/**
 * Complete an owner Google sign-in. The server's `warehouse14://` redirect only
 * carried `token` + `expiresAt`, so: store the token (silently, so the auth gate
 * does not flip mid-handoff), probe `GET /api/auth/session` for the actor, then
 * flip the session store. Mirrors the desktop `setSessionToken` + `setFromProbe`.
 * On any failure the silent token is rolled back so the app never lands in a
 * half-authenticated state.
 */
export async function completeGoogleLogin(token: string, expiresAt: string): Promise<void> {
  setAuthTokenSilently(token)
  try {
    const probe = await authProbe()
    if (!probe.ok || !probe.actor) throw new Error("SESSION_PROBE_FAILED")
    setSession({ token, actor: probe.actor, expiresAt: probe.expiresAt ?? expiresAt })
  } catch (e) {
    // Best-effort: revoke the freshly minted server session before dropping the
    // token, so a failed handoff never strands a live 30-day session nobody
    // holds. The Bearer still resolves via the pending token at this point.
    try {
      await authPin.signOut(apiClient)
    } catch {
      // offline or already dead — the local wipe below is what matters.
    }
    clearSession()
    throw e
  }
}

// ── Staff products (the authenticated path — not the public storefront) ──────
export function listProducts(query: ProductListQuery = {}): Promise<ProductListResponse> {
  return productsApi.list(apiClient, query)
}

/**
 * Live availability counts — the REAL `total` per lifecycle status, read cheaply
 * (limit:1, we only want the count the server reports). Runs the three status
 * lists in parallel and honours an optional search `q` so the count can match a
 * filtered picker („3 verfügbar" for the current search). Every number is the
 * server's own `total`, never an estimate — if a request fails the whole read
 * fails honestly (no partial fabricated count). The hook layers `useQuery`
 * (loading/error/refetch-on-focus) on top of this.
 */
export async function countProductsByStatus(
  q?: string,
): Promise<{ available: number; reserved: number; sold: number }> {
  const at = (status: ProductListQuery["status"]) =>
    productsApi.list(apiClient, { status, q: q || undefined, limit: 1 }).then((r) => r.total)
  const [available, reserved, sold] = await Promise.all([
    at("AVAILABLE"),
    at("RESERVED"),
    at("SOLD"),
  ])
  return { available, reserved, sold }
}

export function getProduct(id: string): Promise<ProductDetail> {
  return productsApi.get(apiClient, id)
}

/** Owner-only full intake (POST /api/products). Step-up auto on high cost. */
export function createProduct(body: CreateProductBody): Promise<CreateProductResponse> {
  return productsApi.create(apiClient, body)
}

/**
 * PUT /api/products/:id — partial update of the PUT-allowed fields (name,
 * Listenpreis, Zustand, Beschreibung, status DRAFT→AVAILABLE, primary
 * category, …). Intake-locked fields (sku, Einkaufspreis, Metall, Gewicht)
 * are refused by the backend. ADMIN + step-up (auto via stepUpMiddleware).
 */
export function updateProduct(id: string, body: ProductUpdateBody): Promise<ProductUpdateResponse> {
  return productsApi.update(apiClient, id, body)
}

/**
 * DELETE /api/products/:id — hard-delete an unsold DRAFT (lifecycle clean-up).
 * The backend refuses AVAILABLE/RESERVED/SOLD, archived, or fiscally-referenced
 * rows. ADMIN + step-up (auto). SOLD rows are archived server-side via the
 * /archive route, which the api-client does not yet expose.
 */
export function removeProduct(id: string): Promise<ProductDeleteResponse> {
  return productsApi.remove(apiClient, id)
}

/** Relocate (LOCATION_CHANGE) — writes audit_log + requires step-up (auto). */
export function relocateProduct(
  id: string,
  body: InventoryAdjustmentBody,
): ReturnType<typeof productsApi.adjustInventory> {
  return productsApi.adjustInventory(apiClient, id, body)
}

// ── Kategorien (taxonomy tree — no step-up; operator-curated) ────────────────
/** GET /api/categories — the 2-level taxonomy tree (roots + children). */
export function categoryTree(): Promise<CategoryTreeResponse> {
  return categoriesApi.tree(apiClient)
}

/**
 * POST /api/products/:id/categories — REPLACE-ALL the product's category set.
 * Used by the Edit flow to change the primary Kategorie (the products PUT does
 * not accept categories). Pass `[]`/null to clear.
 */
export function setProductCategories(
  productId: string,
  body: SetProductCategoriesBody,
): Promise<SetProductCategoriesResponse> {
  return categoriesApi.setForProduct(apiClient, productId, body)
}

// Taxonomy CRUD: the Einstellungen „Sammlungen"-Editor. ADMIN, NO step-up
// (operator-curated; no PII / fiscal / inventory side effect). A delete that the
// FK refuses (a product or a child references the node) returns a themed 409 the
// surface shows verbatim; we never reimplement that guard client-side.
/** POST /api/categories: create a root or child Sammlung (ADMIN). */
export function createCategory(body: CreateCategoryBody): Promise<CreateCategoryResponse> {
  return categoriesApi.create(apiClient, body)
}

/** PUT /api/categories/:id: rename / re-parent / reorder a Sammlung (ADMIN). */
export function updateCategory(
  id: string,
  body: UpdateCategoryBody,
): Promise<UpdateCategoryResponse> {
  return categoriesApi.update(apiClient, id, body)
}

/** DELETE /api/categories/:id: remove a Sammlung (ADMIN). 409 when referenced. */
export function deleteCategory(id: string): Promise<DeleteCategoryResponse> {
  return categoriesApi.remove(apiClient, id)
}

// ── Product photos (server-side LOCAL store; raw/thumb GET is public) ─────────
export function listProductPhotos(productId: string): Promise<{ items: PhotoRow[] }> {
  return photosApi.listForProduct(apiClient, productId)
}

export function setPhotoPrimary(photoId: string): ReturnType<typeof photosApi.setPrimary> {
  return photosApi.setPrimary(apiClient, photoId)
}

/** Delete a product photo (row + stored files) — ADMIN. */
export function deleteProductPhoto(photoId: string): Promise<{ id: string; deleted: boolean }> {
  return photosApi.remove(apiClient, photoId)
}

// ── Customers (Kunden + KYC + Vertrauen) ─────────────────────────────────────
// The SERVER KYC store is the system of record. stampKyc / setTrust / the KYC
// document POST are ADMIN + step-up; a 403 STEP_UP_REQUIRED is handled
// transparently by stepUpMiddleware (the native PIN Dialog) and retried.
export function listCustomers(query: CustomerListQuery = {}): Promise<CustomerListResponse> {
  return customersApi.list(apiClient, query)
}

export function getCustomer(id: string): Promise<CustomerDetail> {
  return customersApi.get(apiClient, id)
}

/** The customer's web-shop orders (reservations, completed, cancelled), newest first. */
export function getCustomerWebOrders(id: string): Promise<{ items: CustomerWebOrder[] }> {
  return customersApi.webOrders(apiClient, id)
}

/** Create a new Kunde (ADMIN). Returns the new id + customerNumber. */
export function createCustomer(body: CustomerCreateBody): Promise<CustomerCreateResponse> {
  return customersApi.create(apiClient, body)
}

/** Update a Kunde's editable fields (ADMIN). */
export function updateCustomer(
  id: string,
  body: CustomerUpdateBody,
): Promise<CustomerUpdateResponse> {
  return customersApi.update(apiClient, id, body)
}

/**
 * DSGVO Art.17 (Recht auf Löschung) — anonymisiert den Kunden UNWIDERRUFLICH +
 * löscht seine Ausweis-Bilder. ADMIN + step-up (automatisch). Steuer-/GoBD-Belege
 * bleiben (PII geschwärzt); die Kundennummer bleibt als Pseudonym.
 */
export function eraseCustomer(id: string): Promise<{ ok: boolean; erasedAt: string }> {
  return customersApi.erase(apiClient, id)
}

/** Attach a KYC (GwG) identity document — ADMIN + step-up (auto). */
export function addCustomerKycDocument(
  customerId: string,
  body: CustomerKycDocumentBody,
): Promise<CustomerKycDocumentResponse> {
  return customersApi.addKycDocument(apiClient, customerId, body)
}

/** Delete (purge) all saved Ausweis documents — ADMIN + step-up (C4). */
export function deleteCustomerKycDocuments(customerId: string): Promise<{ purgedCount: number }> {
  return customersApi.deleteKycDocuments(apiClient, customerId)
}

/** Stamp the operator's KYC (GwG) verification — step-up required (auto).
 *  `body.documentType` is required by the backend audit enum. */
export function stampCustomerKyc(
  id: string,
  body: CustomerKycStampBody,
): Promise<CustomerKycStampResponse> {
  return customersApi.stampKyc(apiClient, id, body)
}

/** Change the customer's trust level — step-up required (auto). */
export function setCustomerTrust(
  id: string,
  body: CustomerTrustChangeBody,
): Promise<CustomerTrustChangeResponse> {
  return customersApi.setTrust(apiClient, id, body)
}

// ── Schatzkammer dashboard (owner KPI snapshot — all live, ADMIN) ────────────
// bridge/summary is the richest cents-based snapshot; dashboard/summary adds
// pendingAppraisals + metal prices; closings give finalized daily revenue for
// the "beat yesterday" quest + streak. No new backend — all already exist.
// ── Leitstand (Risiko + Edge-Schutz + Systemzustand) ────────────────────────
/** Alert rollup + customer watchlist (GET /api/risk/overview, ADMIN). */
export interface RiskOverview {
  windowDays: number
  totalAlerts: number
  alertCounts: Record<string, number>
  recentAlerts: Array<{ id: string; eventType: string; createdAt: string }>
  watchlist: { suspicious: number; banned: number; sanctions: number; pep: number }
}

/** Cloudflare edge rollup (GET /api/risk/edge) — env-gated, honest states. */
export type RiskEdge =
  | { configured: false }
  | { configured: true; available: false }
  | {
      configured: true
      available: true
      windowDays: number
      since: string
      totalThreats: number
      totalRequests: number
      daily: Array<{ date: string; threats: number; requests: number }>
      byCountry: Array<{ country: string; threats: number }>
    }

/** Owner system-health snapshot (GET /api/system/health) — mirrors the desktop
 *  Leitstand wire contract. */
export interface SystemHealth {
  status: "ok" | "watch" | "alert"
  computedAt: string
  components: {
    api: { status: "ok" | "watch" | "alert" }
    database: {
      status: "ok" | "watch" | "alert"
      migrationsApplied: number | null
      latestMigration: string | null
    }
    worker: {
      status: "ok" | "watch" | "alert"
      deadLetter: number
      oldestDeadLetterAt: string | null
      running: number
      chainLastVerifiedAt: string | null
    }
    fiscal: {
      status: "ok" | "watch" | "alert"
      tseCertDaysRemaining: number | null
      tseCertValidUntil: string | null
    }
    alerts: { status: "ok" | "watch" | "alert"; last24h: number; last7d: number }
    edge: { status: "ok" | "unconfigured"; configured: boolean }
  }
  problems: Array<{
    id: string
    severity: "watch" | "alert"
    title: string
    detail: string
    surface: string | null
  }>
}

export function riskOverview(): Promise<RiskOverview> {
  return apiClient.request<RiskOverview>("GET", "/api/risk/overview")
}

export function riskEdge(): Promise<RiskEdge> {
  return apiClient.request<RiskEdge>("GET", "/api/risk/edge")
}

/**
 * System health, tolerant of an OLDER server: the endpoint ships with the next
 * server update, so a 404 (or a 403 from a not-yet-owner session) resolves to
 * `null` and the Leitstand shows an honest "kommt mit dem Server-Update" line
 * instead of a red error. Every other failure still throws (real error state).
 */
export async function systemHealthSafe(): Promise<SystemHealth | null> {
  try {
    return await apiClient.request<SystemHealth>("GET", "/api/system/health")
  } catch (e) {
    if (e instanceof ApiError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) {
      return null
    }
    throw e
  }
}

// ── Fotoeingang (photo bridge to Vierzehn at the register) ──────────────────
/** One unassigned photo waiting in the inbox (server truth). */
export interface InboxPhoto {
  id: string
  thumbUrl?: string
  publicUrl: string
  createdAt: string
  sizeBytes: number | null
}

/** The photo inbox: shelf photos not yet attached to any product. */
export function listInboxPhotos(): Promise<{ items: InboxPhoto[]; total: number }> {
  return apiClient.request<{ items: InboxPhoto[]; total: number }>(
    "GET",
    "/api/photos/unassigned?limit=24",
  )
}

/** Send one compressed JPEG (base64) into the inbox — no product yet. */
export function sendInboxPhoto(dataBase64: string): Promise<{ id: string }> {
  return photosApi.uploadDirect(apiClient, {
    dataBase64,
    contentType: "image/jpeg",
  }) as Promise<{ id: string }>
}

export function bridgeSummary(): Promise<BridgeSummary> {
  return bridgeApi.summary(apiClient)
}

export function dashboardSummary(): Promise<DashboardSummary> {
  return dashboard.summary(apiClient)
}

/** GET /api/closings — recent finalized daily closings (newest first is NOT
 *  guaranteed; the caller sorts by businessDay). */
export function listClosings(): Promise<{ items: ClosingListItem[] }> {
  return closingsApi.list(apiClient)
}

/** POST /api/closings/finalize — write the legal Z-Bon (ADMIN + step-up).
 *  Omit `businessDay` for the current day. */
export function finalizeClosing(businessDay?: string): ReturnType<typeof closingsApi.finalize> {
  return closingsApi.finalize(apiClient, businessDay)
}

/** GET /api/closings/:id/export/datev — DATEV EXTF CSV text (ADMIN + step-up). */
export function closingDatevCsv(id: string): Promise<string> {
  return closingsApi.datevCsv(apiClient, id)
}

/** GET /api/closings/:id/export/kassenbericht — Kassenbericht CSV text. */
export function closingKassenberichtCsv(id: string): Promise<string> {
  return closingsApi.kassenberichtCsv(apiClient, id)
}

// ── Finanzen (P&L, Lagerwert, Metallbestand — the Finanz-Modul) ──────────────
// All money fields are INTEGER CENTS (format with formatCents). The read
// aggregates are ADMIN; the expense/fixed-cost mutations are ADMIN + step-up and
// audit-logged — a 403 STEP_UP_REQUIRED is handled transparently by
// stepUpMiddleware. Each read is called independently so the Schatzkammer can
// light a gauge ONLY when its own endpoint returns real data (honesty rule).

/** GET /api/finance/profit?period=day|month — gross/Ankauf/expenses → netProfit. */
export function financeProfit(period: FinancePeriod): Promise<ProfitResponse> {
  return financeApi.profit(apiClient, { period })
}

/** GET /api/finance/revenue?period=month — month-to-date revenue in cents. */
export function financeMonthRevenue(): Promise<MonthRevenueResponse> {
  return financeApi.monthRevenue(apiClient)
}

/** GET /api/inventory/value — Listenwert + Einkaufswert + verfügbare Artikel. */
export function inventoryValue(): Promise<InventoryValueResponse> {
  return financeApi.inventoryValue(apiClient)
}

/** GET /api/inventory/metal-weights — Edelmetallbestand in Gramm je Metall. */
export function metalWeights(): Promise<MetalWeightsResponse> {
  return financeApi.metalWeights(apiClient)
}

/** GET /api/expenses — one-off operating expenses (paged). */
export function listExpenses(query: ListExpensesQuery = {}): Promise<ListExpensesResponse> {
  return expensesApi.list(apiClient, query)
}

/** POST /api/expenses — book a one-off Ausgabe (ADMIN + step-up, audit-logged). */
export function createExpense(body: CreateExpenseBody): Promise<ExpenseRow> {
  return expensesApi.create(apiClient, body)
}

/** PATCH /api/expenses/:id — edit a one-off Ausgabe (ADMIN + step-up). */
export function updateExpense(id: string, body: UpdateExpenseBody): Promise<ExpenseRow> {
  return expensesApi.update(apiClient, id, body)
}

/** GET /api/fixed-costs — recurring monthly Fixkosten (paged). */
export function listFixedCosts(query: ListFixedCostsQuery = {}): Promise<ListFixedCostsResponse> {
  return fixedCostsApi.list(apiClient, query)
}

/** POST /api/fixed-costs — add a recurring Fixkostenposten (ADMIN + step-up). */
export function createFixedCost(body: CreateFixedCostBody): Promise<FixedCostRow> {
  return fixedCostsApi.create(apiClient, body)
}

/** PATCH /api/fixed-costs/:id — edit a recurring Fixkostenposten (ADMIN + step-up). */
export function updateFixedCost(id: string, body: UpdateFixedCostBody): Promise<FixedCostRow> {
  return fixedCostsApi.update(apiClient, id, body)
}

// ── Aufgaben (tasks — Owner to-dos) ──────────────────────────────────────────
// transition is the lifecycle move (OPEN → IN_PROGRESS → DONE/…); update is a
// field patch. ALLOWED_TASK_TRANSITIONS lives in the api-client for guarding.
export function listTasks(query: ListTasksQuery = {}): Promise<ListTasksResponse> {
  return tasksApi.list(apiClient, query)
}

export function getTask(id: string): Promise<TaskRow> {
  return tasksApi.get(apiClient, id)
}

export function createTask(body: CreateTaskBody): Promise<TaskRow> {
  return tasksApi.create(apiClient, body)
}

export function updateTask(id: string, body: UpdateTaskBody): Promise<TaskRow> {
  return tasksApi.update(apiClient, id, body)
}

export function transitionTask(id: string, body: TransitionTaskBody): Promise<TaskRow> {
  return tasksApi.transition(apiClient, id, body)
}

// ── Schicht (shift — the open till for the cash/closing context) ─────────────
/** GET the current open shift, or null when the till is closed. */
export function getCurrentShift(): Promise<ShiftView | null> {
  return shifts.getCurrent(apiClient)
}

/**
 * POST /api/shifts/open — open THIS device's register session (Zweitkasse).
 *
 * The one genuine cashier-session mutation a paired device may perform: it opens
 * a shift over the shared fiscal record with a counted opening float. The server
 * enforces one OPEN shift per device (a second open answers 409 CONFLICT), so the
 * Team surface only offers this when no shift is open here. `openingFloatEur` is a
 * wire DECIMAL STRING (cents-safe). NOT a fiscal write — opening a drawer signs no
 * Beleg — so it needs no step-up; the Blindsturz CLOSE (which does) lives in Kasse.
 */
export function openShift(body: OpenShiftRequest): Promise<ShiftView> {
  return shifts.open(apiClient, body)
}

// ── Transaktionen (the physical POS moment + late-storno feed) ───────────────
// finalize/ankauf are the fiscal mutations (TSE + step-up); recent is the
// read-only last-24h VERKAUF feed for a late storno.
export function recentTransactions(): Promise<RecentTransactionsResponse> {
  return transactionsApi.recent(apiClient)
}

export function finalizeTransaction(body: FinalizeBody): Promise<FinalizeResponse> {
  return transactionsApi.finalize(apiClient, body)
}

/** POST /api/transactions/ankauf — buy items in (creates products + fiscal row). */
export function ankaufTransaction(body: AnkaufBody): Promise<AnkaufResponse> {
  return transactionsApi.ankauf(apiClient, body)
}

// ── Schätzung (Ankauf appraisal — the pre-payout valuation lot) ───────────────
// The appraisal is the DRAFT valuation a buy-in is built on: open a lot for a
// customer, add each item with its individual appraised value, then complete it
// with the offer. The legal payout that CREATES the products is the SEPARATE
// transactionsApi.ankauf call (the fiscal moment); the appraisal is the audited
// estimate that precedes it. These are thin pass-throughs to the already-typed
// appraisalsApi — no new endpoint, no math (the valuation hint is client-side).
export function openAppraisal(body: AppraisalOpenBody): Promise<AppraisalView> {
  return appraisalsApi.open(apiClient, body)
}

export function getAppraisal(id: string): Promise<AppraisalView> {
  return appraisalsApi.get(apiClient, id)
}

/** POST /api/appraisals/:id/items — append one valued item to an open lot. */
export function addAppraisalItem(id: string, body: AppraisalItemBody): Promise<AppraisalView> {
  return appraisalsApi.addItem(apiClient, id, body)
}

/** DELETE /api/appraisals/:id/items/:itemId — remove a line from an open lot. */
export function removeAppraisalItem(id: string, itemId: string): Promise<AppraisalView> {
  return appraisalsApi.removeItem(apiClient, id, itemId)
}

/** POST /api/appraisals/:id/complete — lock the lot at the offered total. */
export function completeAppraisal(id: string, body: AppraisalCompleteBody): Promise<AppraisalView> {
  return appraisalsApi.complete(apiClient, id, body)
}

// ── Inventar-Reservierung (RESERVED↔AVAILABLE, der Verkauf-Vorlauf) ───────────
// A Verkauf line cannot be finalized straight from AVAILABLE: the server's
// finalize moves each line RESERVED → SOLD and refuses a product that is not
// reserved by THIS cashier's session (transactions-finalize.ts §3a binds
// `(sessionId, userId)`). So the sell screen reserves on add and releases on
// remove/abandon. The session id is one client-generated UUID per cart; the
// channel is POS. These are thin pass-throughs to the already-typed
// productsApi.reserve/release — no new endpoint, no math.
export function reserveProduct(body: ReserveBody): Promise<ReserveResponse> {
  return productsApi.reserve(apiClient, body)
}

/** Release ONE reservation back to AVAILABLE (a single line removed from the cart). */
export function releaseProduct(body: ReleaseBody): Promise<ReleaseResponse> {
  return productsApi.release(apiClient, body)
}

/** Release MANY reservations in one call — the cart-cleared / screen-left coalesce. */
export function releaseProductsBatch(body: ReleaseBatchBody): Promise<ReleaseBatchResponse> {
  return productsApi.releaseBatch(apiClient, body)
}

// ── Belegtext (receipt legal text per Steuerschlüssel) ───────────────────────
export function listBelegtext(query: ListBelegtextQuery = {}): Promise<ListBelegtextResponse> {
  return belegtextApi.list(apiClient, query)
}

/** Resolve the current body text for a given Belegtext kind + language. */
export function currentBelegtext(query: CurrentBelegtextQuery): Promise<CurrentBelegtextResponse> {
  return belegtextApi.current(apiClient, query)
}

/**
 * POST /api/belegtext-templates: publish a NEW current version of a receipt
 * legal text. The backend closes the previous CURRENT row (validTo = now()) and
 * inserts the new one in ONE transaction, then audit-logs `belegtext.published`.
 * This is a fiscal-relevant write (the text prints on every GoBD-relevant Beleg);
 * Owner + step-up, transparent via stepUpMiddleware. The surface gates it
 * behind the explicit FiscalConfirmSheet; we never reimplement the close-out.
 */
export function publishBelegtext(body: PublishBelegtextBody): Promise<PublishBelegtextResponse> {
  return belegtextApi.publish(apiClient, body)
}

// ── eBay-Kanal (the 9-stage listing state machine + marketplace push) ─────────
// The eBay surface is CLIENT-ONLY over the server state machine: the trigger
// from migration 0022 owns the inventory side effect (auto-RESERVE on VERKAUFT,
// the local-reservation/local-sold CONFLICT alert), the publish route owns the
// real marketplace push (createOffer → publishOffer) and returns `configured=
// false` when EBAY_OAUTH_TOKEN is unset — so the app shows an honest "Token
// ausstehend" state instead of faking a live listing. We never reimplement the
// state machine or the tax/fiscal weight; these are thin pass-throughs to the
// already-typed `ebayApi`. transition + publish are Owner + step-up (transparent
// via stepUpMiddleware); history is a read.

/**
 * PATCH /api/products/:id/ebay-state — move a product one legal step through the
 * 9-stage lifecycle. The response echoes `inventorySideEffect` so the UI can
 * surface an auto-reservation or a local-stock CONFLICT without a second read.
 * An illegal step is a 409 CONFLICT (themed German). ADMIN + step-up (auto).
 */
export function transitionEbayState(
  productId: string,
  body: EbayTransitionBody,
): Promise<EbayTransitionResponse> {
  return ebayApi.transition(apiClient, productId, body)
}

/** GET /api/products/:id/ebay-history — the append-only listing event log. */
export function ebayHistory(
  productId: string,
  query: EbayHistoryQuery = {},
): Promise<EbayHistoryResponse> {
  return ebayApi.history(apiClient, productId, query)
}

/**
 * POST /api/products/:id/ebay-publish — push the product to the eBay
 * marketplace. Resolves with `configured=false` (no HTTP, no live listing) when
 * the eBay OAuth token is pending — the surface reads that and shows the honest
 * "Token ausstehend" note rather than claiming a listing. ADMIN + step-up (auto).
 */
export function publishToEbay(productId: string): Promise<EbayPublishResponse> {
  return ebayApi.publish(apiClient, productId)
}

// ── WhatsApp-Posteingang (the inbound/outbound conversation surface) ──────────
// CLIENT-ONLY over the server inbox: the server owns the Meta provider, the
// message store, and the lifecycle (queued → sent → delivered → read → failed).
// These are thin pass-throughs to the already-typed `whatsappApi`. The reads
// (threads, thread) are plain GETs; `send` is the one MUTATION here and rides
// the same transparent step-up middleware as every other Owner write. `send`
// resolves with `status: 'queued'` when no Meta credentials are configured (the
// row is stored regardless) and rejects with `EXTERNAL_SERVICE_FAILED` on a
// provider reject — the surface reads both honestly instead of faking a "sent".

/** GET /api/whatsapp/threads — the conversation list (unread counts + preview). */
export function listWhatsappThreads(): Promise<WhatsAppThreadListResponse> {
  return whatsappApi.listThreads(apiClient)
}

/** GET /api/whatsapp/threads/:phone — one conversation with its full message log. */
export function getWhatsappThread(phone: string): Promise<WhatsAppThreadDetail> {
  return whatsappApi.getThread(apiClient, phone)
}

/**
 * POST /api/whatsapp/send — send an outbound message. The ONLY mutation in this
 * surface; Owner + step-up is transparent via stepUpMiddleware. Resolves
 * `status: 'queued'` when Meta is not yet configured (stored, not delivered).
 */
export function sendWhatsapp(body: WhatsAppSendBody): Promise<WhatsAppSendResponse> {
  return whatsappApi.send(apiClient, body)
}

/** PATCH /api/whatsapp/messages/:id/handled — mark an inbound message triaged. */
export function markWhatsappHandled(messageId: string): Promise<WhatsAppMarkHandledResponse> {
  return whatsappApi.markHandled(apiClient, messageId)
}

/** PATCH /api/whatsapp/messages/:id/link-customer — attach a known customer. */
export function linkWhatsappCustomer(
  messageId: string,
  customerId: string,
): Promise<WhatsAppLinkCustomerResponse> {
  return whatsappApi.linkCustomer(apiClient, messageId, customerId)
}

/**
 * PATCH /api/whatsapp/threads/:phone/ai-status — hand the thread to the AI
 * assistant or take it over as a human. Owner + step-up (transparent).
 */
export function setWhatsappAiStatus(
  phone: string,
  aiActive: boolean,
): Promise<WhatsAppAiStatusResponse> {
  return whatsappApi.updateAiStatus(apiClient, phone, aiActive)
}

// ── Anfragen (customer support tickets — the e-mail side of the counter) ─────
// The shop's mail was outbound only until 0097: a customer who replied to a
// reservation letter was writing into a mailbox nobody opened. The worker's
// inbox poller files those replies as tickets; these four wrappers are the
// staff side. `reply` is the one MUTATION and rides the same transparent
// step-up middleware as every other Owner write.
//
// Nothing here sends mail inline. A reply is QUEUED into the same outbox the
// reservation letters use, so the honest word for a completed call is
// "übernommen" and never "gesendet".

/** GET /api/support/tickets — open tickets, or one status bucket. */
export function listSupportTickets(status?: TicketStatus): Promise<SupportTicketSummary[]> {
  return supportApi.list(apiClient, status)
}

/** GET /api/support/tickets/:id — one conversation with its full message log. */
export function getSupportTicket(id: string): Promise<SupportTicketDetail> {
  return supportApi.get(apiClient, id)
}

/**
 * POST /api/support/tickets/:id/reply — answer. The letter leaves from the
 * address the customer wrote TO, and the ticket moves to WARTET rather than
 * GESCHLOSSEN: we have replied, they have not yet said whether that settled it.
 */
export function replySupportTicket(id: string, body: string): Promise<{ ok: boolean; ticketNumber: string }> {
  return supportApi.reply(apiClient, id, body)
}

/** POST /api/support/tickets/:id/status — close a settled thread, or reopen it. */
export function setSupportTicketStatus(
  id: string,
  status: TicketStatus,
): Promise<{ ok: boolean; status: string }> {
  return supportApi.setStatus(apiClient, id, status)
}

// ── Ledger (the GoBD audit feed — read-only history) ─────────────────────────
export function listLedger(query: LedgerListQuery = {}): Promise<LedgerListResponse> {
  return ledgerQueryApi.list(apiClient, query)
}

/**
 * Normalize a paged `LedgerListRow` (camelCase, the REST read shape) into the
 * `LedgerEvent` wire shape (snake_case, what the live SSE stream emits). Doing
 * this here means the notification classifier — and any future EventSource path
 * — consume ONE shape, regardless of whether an event arrived by poll or push.
 */
function ledgerRowToEvent(r: LedgerListRow): LedgerEvent {
  return {
    id: r.id,
    event_type: r.eventType,
    entity_table: r.entityTable,
    entity_id: r.entityId,
    actor_user_id: r.actorUserId,
    device_id: r.deviceId,
    payload: r.payload,
    created_at: r.createdAt,
  }
}

/**
 * The live-update read for the Notifications spine: the most recent ledger
 * events, newest first, normalized to the `LedgerEvent` wire shape. The live
 * store polls this with a cursor (drops anything it has already seen by id) — so
 * it is the dependency-free, honest companion to the `/api/sse/ledger` push
 * stream (RN ships no native EventSource; the SSE transport is a documented seam
 * in `notifications/live-store.ts`). `sinceId` lets the store ask only for what
 * is new; the server has no "since" filter, so we page from the top and the
 * store de-dupes — `sinceId` is reserved for when the backend gains that filter.
 */
export async function listLedgerEvents(
  opts: { limit?: number; sinceId?: number } = {},
): Promise<LedgerEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const res = await ledgerQueryApi.list(apiClient, { limit, offset: 0 })
  // The query returns newest-first already (id DESC); keep that order and map.
  return res.items.map(ledgerRowToEvent)
}

// ── Belege / Dokumente (the GoBD attachment register — read-only) ────────────
// The documents domain is the typed attachment store: every Rechnung,
// Ankaufbeleg, Versandbeleg, Expertise, Zertifikat or Ausweis-Scan a sale or
// buy-in produced is registered here as a row pointing at an immutable object
// (r2Key + sha256 for GoBD integrity). The OWNER app reads this register; it
// does NOT upload bytes (the byte PUT is the Kassensystem's signed-URL flow) and
// the server exposes no in-reach download URL for the stored object — so the
// surface shows honest metadata + integrity and keeps the byte-open locked
// rather than fabricating a link. `archive` is the only mutation (Owner-only,
// audited) and is intentionally NOT wrapped here: this surface stays read-first.

/** GET /api/documents — the paged, filterable GoBD attachment register (read). */
export function listDocuments(query: ListDocumentsQuery = {}): Promise<ListDocumentsResponse> {
  return documentsApi.list(apiClient, query)
}

// ── Scan → product (the real cashier flow) ───────────────────────────────────
export async function resolveScannedCode(code: string): Promise<ScanMatch> {
  const res = await productsApi.list(apiClient, { q: code, limit: 10 })
  return classifyScanMatch(code, res.items)
}

// ── Schmelzwert (melt value) + Marge (Ankauf safety margin) ──────────────────
export function currentMetalPrices(): Promise<CurrentMetalPricesResponse> {
  return metalPricesApi.current(apiClient)
}

/**
 * GET /api/metal-prices/rates — the per-metal pricing rows the Ankauf valuation
 * leans on: the current spot (melt), the time-weighted 10-day average, the
 * margin-baked Ankauf buy rate (`ankaufRatePerGramEur`), and the safety margin
 * in effect. The intake screen reads this to SUGGEST a buy price (the operator
 * stays in control — it pre-fills, never auto-commits). When a rate is null the
 * suggestion is simply omitted (honesty: no fabricated valuation). ADMIN read.
 */
export function metalRates(): Promise<MetalRatesResponse> {
  return metalPricesApi.rates(apiClient)
}

/** PATCH the Ankauf safety margin (global, or per-metal). ADMIN + step-up. */
export function updateMetalMargin(body: UpdateMarginBody): Promise<UpdateMarginResponse> {
  return metalPricesApi.updateMargin(apiClient, body)
}

/** Schmelzwert = Feingewicht (g) × aktueller Kurs (€/g) for the product's metal. */
export function schmelzwertEur(
  feingewichtGrams: string | null,
  metal: string | null,
  prices: readonly CurrentMetalPrice[],
): string | null {
  if (!feingewichtGrams || !metal) return null
  const row = prices.find((p) => String(p.metal) === String(metal))
  if (!row?.pricePerGramEur) return null
  const value = Number(feingewichtGrams) * Number(row.pricePerGramEur)
  if (!Number.isFinite(value)) return null
  return Money.of(value.toFixed(2), "EUR").format()
}

// ── Formatting / helpers ─────────────────────────────────────────────────────
export function formatEur(eur: string): string {
  return Money.of(eur, "EUR").format()
}

/** Format integer CENTS as de-DE EUR (199999 → "1.999,99 €"). Bridge KPIs are
 *  cents on the wire; never print raw cents. */
export function formatCents(cents: number): string {
  return Money.of((cents / 100).toFixed(2), "EUR").format()
}

/** Prefix a relative api photo path with the base URL for <Image>. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${API_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`
}

/**
 * Fehlertexte. The error→German mapping (every `ApiErrorCode`, the CONFLICT
 * constraint tokens, the ajv 400 field paths) lives in the central German text
 * spine. Re-exported here so the 60+ existing `import { describeError } from
 * "@/warehouse14/api"` call sites keep working — there is one implementation.
 */
export { describeError } from "./german-text"
