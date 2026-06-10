/**
 * Same-origin proxy for the PUBLIC appointment-booking endpoints — the /termin
 * page runs client-side, so in the private internal deploy the browser must
 * stay on the storefront origin (a direct cross-origin call to the api would
 * be CORS-blocked). Mirrors the photo-proxy model: a TIGHT allowlist, nothing
 * else of the api is exposed.
 *
 *   GET  /api/storefront/appointments/slots?date=…&type=…  → upstream GET
 *   POST /api/storefront/appointments/book                 → upstream POST
 *
 * The client IP is forwarded (nginx already sets X-Real-IP/X-Forwarded-For on
 * the way in) so the api's 5/h/IP booking rate limit sees the real visitor,
 * not the storefront container.
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

function clientIpHeaders(req: NextRequest): Record<string, string> {
  const fwd = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  return fwd ? { "x-forwarded-for": fwd } : {};
}

async function passThrough(upstream: Response): Promise<Response> {
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { action: string } },
) {
  if (params.action !== "slots") return new Response("Not found", { status: 404 });
  const qs = req.nextUrl.searchParams.toString();
  try {
    const upstream = await fetch(
      `${upstreamBase()}/api/storefront/appointments/slots${qs ? `?${qs}` : ""}`,
      { cache: "no-store", headers: { accept: "application/json", ...clientIpHeaders(req) } },
    );
    return await passThrough(upstream);
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { action: string } },
) {
  if (params.action !== "book") return new Response("Not found", { status: 404 });
  let body: string;
  try {
    body = await req.text();
    if (body.length > 4096) return new Response("Payload too large", { status: 413 });
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const upstream = await fetch(`${upstreamBase()}/api/storefront/appointments/book`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...clientIpHeaders(req),
      },
      body,
    });
    // 201 / 400 / 409 / 429 all pass through untouched — the page maps them.
    return await passThrough(upstream);
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
