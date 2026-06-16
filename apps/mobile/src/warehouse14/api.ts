/**
 * The single api-cloud connection for the POC.
 *
 * This is the WHOLE point of goal 1: the data layer is the EXISTING
 * @warehouse14/api-client package — we only construct the client and call its
 * free functions. No fetch logic is reimplemented here.
 *
 * Endpoint choice: `storefrontApi.listProducts` is the PUBLIC catalog route
 * (no login, no device cert), so it works as the zero-auth first screen and
 * also backs the barcode lookup (it accepts `{ q }`). The staff path
 * (`productsApi.list`) needs a better-auth email session + ADMIN/CASHIER role
 * — that is the production path and is intentionally out of scope here.
 */
import {
  createApiClient,
  storefrontApi,
  type ApiClient,
  type StorefrontProduct,
  type StorefrontProductsResponse,
} from "@warehouse14/api-client"
import { Money } from "@warehouse14/domain/money"

/**
 * Dev api-cloud base URL.
 *
 * MUST be the Mac's LAN IP (or an Expo tunnel) — a physical phone cannot reach
 * `localhost`. NEVER point this at production (https://api.warehouse14.de).
 * Override without editing code via the `EXPO_PUBLIC_API_BASE_URL` env var.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://192.168.179.93:3001"

/**
 * The shared client. `getAuthToken` returns undefined for the POC — the
 * storefront routes are public. When the staff path is wired later, this is
 * where a Bearer token would be supplied (RN has no cookie jar).
 */
export const apiClient: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getAuthToken: () => undefined,
})

/** Prefix a relative api path (e.g. a photo URL) with the dev base URL. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${API_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`
}

/** Goal 1: pull the real catalog through the existing package. */
export function listProducts(limit = 20, offset = 0): Promise<StorefrontProductsResponse> {
  return storefrontApi.listProducts(apiClient, { limit, offset })
}

/** Format a storefront product's price using the shared Money type (de-DE). */
export function formatPrice(p: Pick<StorefrontProduct, "listPriceEur" | "currency">): string {
  return Money.of(p.listPriceEur, p.currency).format()
}

// ── Barcode → product, mirroring tauri-pos/src/lib/scan-resolve.ts ──────────
//
// The cashier flow is `productsApi.list(api, { q: code })` then
// `classifyScanMatch(code, res.items)`. That classifier is typed to
// ProductListRow (it reads `status`/`barcode`, which the PUBLIC storefront
// shape does not expose), so for the POC we run the SAME shape against the
// public catalog: query by `q`, then match the scanned code to a returned row.

export type StorefrontScanMatch =
  | { kind: "found"; product: StorefrontProduct }
  | { kind: "not-found" }

/** Normalise a raw scanner buffer (mirrors normalizeScan in scan-resolve.ts). */
export function normalizeScan(raw: string): string {
  return raw.trim().toUpperCase()
}

/** Match a scanned code to a storefront row by SKU first, then name. */
export function classifyStorefrontMatch(
  code: string,
  rows: readonly StorefrontProduct[],
): StorefrontScanMatch {
  const norm = normalizeScan(code)
  if (norm === "") return { kind: "not-found" }
  const product = rows.find(
    (r) => normalizeScan(r.sku) === norm || normalizeScan(r.name) === norm,
  )
  return product ? { kind: "found", product } : { kind: "not-found" }
}

/** Goal 2 follow-up: look a scanned code up through the same public endpoint. */
export async function lookupScannedCode(code: string): Promise<StorefrontScanMatch> {
  const res = await storefrontApi.listProducts(apiClient, { q: code, limit: 10 })
  return classifyStorefrontMatch(code, res.items)
}
