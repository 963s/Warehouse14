/**
 * Build the image remotePatterns from the runtime env so next/image is allowed
 * to load product photos from whichever host serves /api/photos/* — the api
 * origin (NEXT_PUBLIC_API_URL) and an optional media/CDN host. The https
 * wildcard covers production + absolute PHOTOS_PUBLIC_BASE_URL; localhost (http)
 * has to be listed explicitly because the wildcard is https-only.
 */
function imageRemotePatterns() {
  const patterns = [
    // Production + any absolute https photo/CDN host.
    { protocol: "https", hostname: "**" },
  ];
  const extraHosts = [process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_R2_PUBLIC_URL_BASE];
  for (const raw of extraHosts) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === "http:") {
        patterns.push({
          protocol: "http",
          hostname: u.hostname,
          port: u.port || undefined,
        });
      }
    } catch {
      // ignore malformed env values
    }
  }
  return patterns;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Product photos are PUBLIC images served by the api at /api/photos/<id>/{raw,thumb}
  // (relative, prefixed with NEXT_PUBLIC_API_URL by storefront-data.ts) or an
  // absolute PHOTOS_PUBLIC_BASE_URL / R2 CDN host.
  images: {
    remotePatterns: imageRemotePatterns(),
    // The api already serves sized renditions (/api/photos/<id>/{raw,thumb}), so
    // Next's optimizer is redundant — and behind the private SSH-tunnel port the
    // optimizer's same-origin fetch (it resolves against the request Host, which
    // the container doesn't listen on) would break. Passing the src through
    // un-optimized lets the browser load photos straight from the storefront's
    // own photo-proxy. Static /public assets are served directly either way.
    unoptimized: true,
  },
  // Standalone build → a minimal self-contained server for the private Docker
  // deployment (only the traced node_modules are bundled).
  output: "standalone",
};

export default nextConfig;
