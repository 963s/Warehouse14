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
  authPin,
  createApiClient,
  metalPricesApi,
  photosApi,
  productsApi,
  stepUpMiddleware,
  type ApiClient,
  type CurrentMetalPrice,
  type InventoryAdjustmentBody,
  type PhotoRow,
  type PinLoginResponse,
  type ProductDetail,
  type ProductListQuery,
  type ProductListResponse,
} from "@warehouse14/api-client"
import { Money } from "@warehouse14/domain/money"

import { getSessionToken } from "./session"
import { classifyScanMatch, type ScanMatch } from "./scan-resolve"
import { stepUpService } from "./step-up"

/**
 * LOCAL dev api-cloud only — the Mac LAN IP. NEVER production
 * (https://api.warehouse14.de). Override via EXPO_PUBLIC_API_BASE_URL.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://192.168.179.93:3001"

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

/** Relocate (LOCATION_CHANGE) — writes audit_log + requires step-up (auto). */
export function relocateProduct(
  id: string,
  body: InventoryAdjustmentBody,
): ReturnType<typeof productsApi.adjustInventory> {
  return productsApi.adjustInventory(apiClient, id, body)
}

// ── Product photos (server-side LOCAL store; raw/thumb GET is public) ─────────
export function listProductPhotos(productId: string): Promise<{ items: PhotoRow[] }> {
  return photosApi.listForProduct(apiClient, productId)
}

export function setPhotoPrimary(photoId: string): ReturnType<typeof photosApi.setPrimary> {
  return photosApi.setPrimary(apiClient, photoId)
}

// ── Scan → product (the real cashier flow) ───────────────────────────────────
export async function resolveScannedCode(code: string): Promise<ScanMatch> {
  const res = await productsApi.list(apiClient, { q: code, limit: 10 })
  return classifyScanMatch(code, res.items)
}

// ── Schmelzwert (melt value) ─────────────────────────────────────────────────
export function currentMetalPrices(): ReturnType<typeof metalPricesApi.current> {
  return metalPricesApi.current(apiClient)
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
