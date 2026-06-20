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
  appointments,
  authPin,
  belegtextApi,
  bridgeApi,
  categoriesApi,
  closingsApi,
  createApiClient,
  customersApi,
  dashboard,
  expensesApi,
  financeApi,
  fixedCostsApi,
  ledgerQueryApi,
  metalPricesApi,
  photosApi,
  productsApi,
  shifts,
  tasksApi,
  transactionsApi,
  stepUpMiddleware,
  type ApiClient,
  type AppointmentListQuery,
  type AppointmentListItem,
  type AppointmentPatchStatus,
  type AvailableSlot,
  type AvailableSlotsQuery,
  type BookAppointmentRequest,
  type BridgeSummary,
  type CategoryTreeResponse,
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
  type CustomerCreateBody,
  type CustomerCreateResponse,
  type CustomerDetail,
  type CustomerKycDocumentBody,
  type CustomerKycDocumentResponse,
  type DashboardSummary,
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
  type LedgerListQuery,
  type LedgerListResponse,
  type ListBelegtextQuery,
  type ListBelegtextResponse,
  type ListTasksQuery,
  type ListTasksResponse,
  type PhotoRow,
  type PinLoginResponse,
  type ProductDetail,
  type ProductListQuery,
  type ProductListResponse,
  type RecentTransactionsResponse,
  type RescheduleRequest,
  type SetProductCategoriesBody,
  type SetProductCategoriesResponse,
  type AnkaufBody,
  type AnkaufResponse,
  type ShiftView,
  type TaskRow,
  type TransitionTaskBody,
  type UpdateMarginBody,
  type UpdateMarginResponse,
  type UpdateTaskBody,
} from "@warehouse14/api-client"
import { Money } from "@warehouse14/domain/money"

import { classifyScanMatch, type ScanMatch } from "./scan-resolve"
import { getSessionToken } from "./session"
import { stepUpService } from "./step-up"

/**
 * LOCAL dev api-cloud only — the Mac LAN IP. NEVER production
 * (https://api.warehouse14.de). Override via EXPO_PUBLIC_API_BASE_URL.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://192.168.179.93:3001"

/**
 * DEV device fingerprint = SHA-256 of the dev cert seeded by api-cloud's
 * dev-bootstrap (devices.cert_serial). Override via
 * EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT. DEV ONLY — retires at go-live.
 */
export const DEV_DEVICE_FINGERPRINT =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"

export const apiClient: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  credentials: "include",
  defaultHeaders: { "x-dev-device-fingerprint": DEV_DEVICE_FINGERPRINT },
  getAuthToken: getSessionToken,
  middlewares: [stepUpMiddleware(stepUpService)],
})

// ── Auth ────────────────────────────────────────────────────────────────────
export function pinLogin(pin: string): Promise<PinLoginResponse> {
  return authPin.login(apiClient, { pin })
}

/** PIN step-up — refreshes the session's step-up window (used by the Dialog). */
export function pinStepUp(pin: string): Promise<unknown> {
  return authPin.stepUp(apiClient, { pin })
}

// ── Staff products (the authenticated path — not the public storefront) ──────
export function listProducts(query: ProductListQuery = {}): Promise<ProductListResponse> {
  return productsApi.list(apiClient, query)
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

// ── Product photos (server-side LOCAL store; raw/thumb GET is public) ─────────
export function listProductPhotos(productId: string): Promise<{ items: PhotoRow[] }> {
  return photosApi.listForProduct(apiClient, productId)
}

export function setPhotoPrimary(photoId: string): ReturnType<typeof photosApi.setPrimary> {
  return photosApi.setPrimary(apiClient, photoId)
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

/** Attach a KYC (GwG) identity document — ADMIN + step-up (auto). */
export function addCustomerKycDocument(
  customerId: string,
  body: CustomerKycDocumentBody,
): Promise<CustomerKycDocumentResponse> {
  return customersApi.addKycDocument(apiClient, customerId, body)
}

/** Stamp the operator's KYC (GwG) verification — step-up required (auto). */
export function stampCustomerKyc(
  id: string,
  body: CustomerKycStampBody = {},
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
export function finalizeClosing(
  businessDay?: string,
): ReturnType<typeof closingsApi.finalize> {
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

// ── Termine (appointments — Owner calendar) ──────────────────────────────────
// list is a bounded from/to window; availableSlots powers the booking picker;
// book/setStatus/reschedule are the mutations. PATCH status carries an optional
// cancellationReason + staffNotes.
export function listAppointments(
  query: AppointmentListQuery,
): Promise<{ appointments: AppointmentListItem[] }> {
  return appointments.list(apiClient, query)
}

export function availableSlots(
  query: AvailableSlotsQuery,
): Promise<{ slots: AvailableSlot[] }> {
  return appointments.availableSlots(apiClient, query)
}

export function bookAppointment(
  body: BookAppointmentRequest,
): Promise<{ id: string; status: string }> {
  return appointments.book(apiClient, body)
}

export function setAppointmentStatus(
  id: string,
  body: { status: AppointmentPatchStatus; cancellationReason?: string; staffNotes?: string },
): Promise<{ id: string; status: string }> {
  return appointments.setStatus(apiClient, id, body)
}

export function rescheduleAppointment(
  id: string,
  body: RescheduleRequest,
): Promise<{ id: string; rescheduledFrom: string }> {
  return appointments.reschedule(apiClient, id, body)
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

// ── Belegtext (receipt legal text per Steuerschlüssel) ───────────────────────
export function listBelegtext(query: ListBelegtextQuery = {}): Promise<ListBelegtextResponse> {
  return belegtextApi.list(apiClient, query)
}

/** Resolve the current body text for a given Belegtext kind + language. */
export function currentBelegtext(
  query: CurrentBelegtextQuery,
): Promise<CurrentBelegtextResponse> {
  return belegtextApi.current(apiClient, query)
}

// ── Ledger (the GoBD audit feed — read-only history) ─────────────────────────
export function listLedger(query: LedgerListQuery = {}): Promise<LedgerListResponse> {
  return ledgerQueryApi.list(apiClient, query)
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

/** Map an ApiError to a themed German message (PIN lockout, device, etc.). */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "PIN_LOCKED": {
        const ms = (err.details as { retryAfterMs?: number } | undefined)?.retryAfterMs
        const mins = ms ? Math.ceil(ms / 60000) : null
        return mins
          ? `PIN gesperrt — in ${mins} Min. erneut versuchen.`
          : "PIN gesperrt — bitte später erneut versuchen."
      }
      case "UNAUTHORIZED":
        return err.message || "Falsche PIN."
      case "DEVICE_NOT_AUTHORIZED":
        return "Gerät nicht autorisiert (dev: Fingerprint prüfen)."
      case "FORBIDDEN":
        return "Keine Berechtigung für diese Aktion."
      case "STEP_UP_REQUIRED":
        return "PIN-Bestätigung erforderlich."
      case "VALIDATION_ERROR":
        return err.message || "Eingabe ungültig."
      default:
        return err.message || `Fehler (${err.code}).`
    }
  }
  return err instanceof Error ? err.message : String(err)
}
