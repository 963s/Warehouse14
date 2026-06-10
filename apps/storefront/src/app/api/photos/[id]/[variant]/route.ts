/**
 * Private photo proxy — keeps the browser entirely on the storefront origin.
 *
 * Product photos are PUBLIC (public-by-UUID) but in the private internal
 * deployment we never want the page to reach out to api.warehouse14.de from
 * the browser. So next/image points at a same-origin path
 * (`/api/photos/<id>/<variant>`) and this handler streams the bytes from the
 * internal api (INTERNAL_API_URL, e.g. http://api:3001 on the Docker network).
 *
 * Tight by construction: only a UUID id + the two public renditions
 * (raw|thumb) are ever forwarded. Nothing else about the api is exposed.
 *
 * In local dev (no INTERNAL_API_URL) it falls back to NEXT_PUBLIC_API_URL, so
 * the same relative URLs work against the local backend on :3001.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANTS = new Set(["raw", "thumb"]);

function upstreamBase(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "https://api.warehouse14.de"
  ).replace(/\/+$/, "");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; variant: string } },
) {
  const { id, variant } = params;
  if (!UUID_RE.test(id) || !VARIANTS.has(variant)) {
    return new Response("Not found", { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase()}/api/photos/${id}/${variant}`, {
      cache: "no-store",
      // Never forward cookies/credentials — these are public assets.
      headers: { accept: "image/*" },
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", { status: upstream.status === 404 ? 404 : 502 });
  }

  const headers = new Headers();
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? "application/octet-stream",
  );
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  // Public, content-addressed by UUID → safe to cache hard in the browser.
  headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");

  return new Response(upstream.body, { status: 200, headers });
}
