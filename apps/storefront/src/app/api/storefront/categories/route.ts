/**
 * Same-origin proxy for the PUBLIC category tree — the header nav + side menu
 * run client-side, so in the private internal deploy the browser must stay on
 * the storefront origin (a direct cross-origin call to the api would be
 * CORS-blocked). Mirrors the appointments-proxy model: a TIGHT single-path
 * allowlist, read-only, nothing else of the api is exposed.
 *
 *   GET /api/storefront/categories → upstream GET (shape: { roots: [...] })
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function upstreamBase(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "https://api.warehouse14.de"
  ).replace(/\/+$/, "");
}

export async function GET(_req: NextRequest) {
  try {
    const upstream = await fetch(`${upstreamBase()}/api/storefront/categories`, {
      headers: { accept: "application/json" },
      // taxonomy changes rarely — let Next's fetch cache hold it briefly
      next: { revalidate: 300 },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
