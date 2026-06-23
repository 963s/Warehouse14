/**
 * Storefront API client.
 *
 * Thin wrapper over @warehouse14/api-client's `createApiClient`, pointed at the
 * public catalog (https://api.warehouse14.de). All `/api/storefront/*` routes
 * are public by design, no auth, no device cert, no mTLS. The shopper cookie is
 * carried via credentials:'include' once the user signs in.
 *
 * The catalog methods (listProducts, getProductBySlug, listCategories,
 * listLocations) are safe to call anonymously. The cart, checkout, orders and
 * account methods require a shopper session, which is established by signUp /
 * signIn (the backend sets the `warehouse14.shopper_session` cookie).
 */

import Constants from "expo-constants"
import { createApiClient, type ApiClient } from "@warehouse14/api-client"
import type {
  AccountResponse,
  Address,
  CartView,
  CheckoutBody,
  CheckoutResponse,
  OrderDetail,
  OrderSummary,
  SignInBody,
  SignInResponse,
  SignUpBody,
  SignUpResponse,
  StorefrontCategoriesResponse,
  StorefrontLocationsResponse,
  StorefrontProduct,
  StorefrontProductsQuery,
  StorefrontProductsResponse,
} from "./types"

export const API_BASE_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "https://api.warehouse14.de"

/** The shared client. credentials:'include' carries the shopper cookie. */
export const api: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  credentials: "include",
  timeoutMs: 20_000,
})

// ────────────────────────────────────────────────────────────────────────
// Image URL resolution
//
// Photo URLs from the catalog are either api-relative ("/api/photos/<id>/raw")
// for local-store photos, or absolute for legacy R2 rows. Resolve relative
// ones against the API base so the native <Image> can fetch them.
// ────────────────────────────────────────────────────────────────────────

/** Resolve an api-relative photo URL to an absolute one. Passes absolute URLs
 *  through unchanged. Returns null for null/empty. */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`
  return `${API_BASE_URL}/${url}`
}

// ────────────────────────────────────────────────────────────────────────
// Catalog (anonymous, public)
// ────────────────────────────────────────────────────────────────────────

function buildProductsQuery(query: StorefrontProductsQuery): string {
  const params = new URLSearchParams()
  if (query.limit != null) params.set("limit", String(query.limit))
  if (query.offset != null) params.set("offset", String(query.offset))
  if (query.category) params.set("category", query.category)
  if (query.metal) params.set("metal", query.metal)
  if (query.erhaltung) params.set("erhaltung", query.erhaltung)
  if (query.minrVon != null) params.set("minrVon", String(query.minrVon))
  if (query.minrBis != null) params.set("minrBis", String(query.minrBis))
  if (query.q) params.set("q", query.q)
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export const catalog = {
  listProducts(query: StorefrontProductsQuery = {}): Promise<StorefrontProductsResponse> {
    return api.request<StorefrontProductsResponse>(
      "GET",
      `/api/storefront/products${buildProductsQuery(query)}`,
      undefined,
      { routeTemplate: "/api/storefront/products" },
    )
  },
  getProductBySlug(slug: string): Promise<StorefrontProduct> {
    return api.request<StorefrontProduct>(
      "GET",
      `/api/storefront/products/${encodeURIComponent(slug)}`,
      undefined,
      { routeTemplate: "/api/storefront/products/:slug" },
    )
  },
  listCategories(): Promise<StorefrontCategoriesResponse> {
    return api.request<StorefrontCategoriesResponse>("GET", "/api/storefront/categories")
  },
  listLocations(): Promise<StorefrontLocationsResponse> {
    return api.request<StorefrontLocationsResponse>("GET", "/api/storefront/locations")
  },
}

// ────────────────────────────────────────────────────────────────────────
// Auth (shopper session)
// ────────────────────────────────────────────────────────────────────────

export const auth = {
  signUp(body: SignUpBody): Promise<SignUpResponse> {
    return api.request<SignUpResponse>("POST", "/api/storefront/auth/sign-up", body, {
      routeTemplate: "/api/storefront/auth/sign-up",
    })
  },
  signIn(body: SignInBody): Promise<SignInResponse> {
    return api.request<SignInResponse>("POST", "/api/storefront/auth/sign-in", body, {
      routeTemplate: "/api/storefront/auth/sign-in",
    })
  },
  signOut(): Promise<{ ok: boolean }> {
    return api.request<{ ok: boolean }>("POST", "/api/storefront/auth/sign-out")
  },
}

// ────────────────────────────────────────────────────────────────────────
// Cart (requires shopper session)
// ────────────────────────────────────────────────────────────────────────

export const cart = {
  get(): Promise<CartView> {
    return api.request<CartView>("GET", "/api/storefront/cart")
  },
  addItem(productId: string): Promise<CartView> {
    return api.request<CartView>("POST", "/api/storefront/cart/items", { productId })
  },
  removeItem(itemId: string): Promise<CartView> {
    return api.request<CartView>(
      "DELETE",
      `/api/storefront/cart/items/${encodeURIComponent(itemId)}`,
    )
  },
  checkout(body: CheckoutBody): Promise<CheckoutResponse> {
    return api.request<CheckoutResponse>("POST", "/api/storefront/cart/checkout", body)
  },
}

// ────────────────────────────────────────────────────────────────────────
// Orders + account (require shopper session)
// ────────────────────────────────────────────────────────────────────────

export const account = {
  listOrders(): Promise<OrderSummary[]> {
    return api.request<{ items: OrderSummary[] } | OrderSummary[]>(
      "GET",
      "/api/storefront/orders",
    ).then((r) => (Array.isArray(r) ? r : r.items ?? []))
  },
  getOrder(id: string): Promise<OrderDetail> {
    return api.request<OrderDetail>(
      "GET",
      `/api/storefront/orders/${encodeURIComponent(id)}`,
    )
  },
  me(): Promise<AccountResponse> {
    return api.request<AccountResponse>("GET", "/api/storefront/account")
  },
  update(body: {
    fullName?: string
    preferredLanguage?: "de" | "en" | "ar"
    marketingConsent?: boolean
    address?: Address
  }): Promise<AccountResponse> {
    return api.request<AccountResponse>("PATCH", "/api/storefront/account", body)
  },
}
