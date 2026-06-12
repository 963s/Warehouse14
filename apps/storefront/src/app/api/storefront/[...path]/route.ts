/**
 * Same-origin catch-all proxy for the CLIENT-side public storefront API.
 *
 * Pages render server-side (RSC → internal api directly), but interactive
 * calls run in the BROWSER and must stay on the storefront origin — otherwise
 * a cross-origin call to the api is CORS-blocked (and in the private deploy the
 * api host is internal-only). The cart/items POST was hitting the storefront
 * origin with no matching route → 404 ("add to cart does nothing"). This fixes
 * it for every public storefront path the browser calls.
 *
 * More-specific sibling routes (appointments/[action], categories) take
 * precedence; this handles cart, products, metal-prices, etc.
 *
 * TIGHT: only an allowlisted first segment is forwarded. COOKIES round-trip
 * (the cart is session-cookie based) and the real client IP is forwarded for
 * the api's rate limits.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// First-path-segment allowlist — public storefront surface only.
const ALLOWED = new Set([
  "cart",
  "products",
  "metal-prices",
  "shop-info",
  "locations",
  "newsletter",
  "contact",
  "goldankauf-lead",
]);

function upstreamBase(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "https://api.warehouse14.de"
  ).replace(/\/+$/, "");
}

function fwdHeaders(req: NextRequest, withBody: boolean): Headers {
  const h = new Headers();
  h.set("accept", "application/json");
  const cookie = req.headers.get("cookie");
  if (cookie) h.set("cookie", cookie); // session cart cookie round-trip
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (ip) h.set("x-forwarded-for", ip);
  if (withBody) h.set("content-type", req.headers.get("content-type") ?? "application/json");
  return h;
}

async function relay(req: NextRequest, path: string[]): Promise<Response> {
  if (path.length === 0 || !ALLOWED.has(path[0])) {
    return new Response("Not found", { status: 404 });
  }
  const qs = req.nextUrl.search;
  const url = `${upstreamBase()}/api/storefront/${path.map(encodeURIComponent).join("/")}${qs}`;
  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";

  let body: string | undefined;
  if (hasBody) {
    body = await req.text();
    if (body.length > 8192) return new Response("Payload too large", { status: 413 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers: fwdHeaders(req, hasBody),
      body,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const text = await upstream.text();
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/json");
  headers.set("cache-control", "no-store");
  // Round-trip the cart session cookie back to the browser.
  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(text, { status: upstream.status, headers });
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return relay(req, ctx.params.path);
}
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return relay(req, ctx.params.path);
}
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return relay(req, ctx.params.path);
}
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return relay(req, ctx.params.path);
}
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return relay(req, ctx.params.path);
}
