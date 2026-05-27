/**
 * Single source of truth for "which URL prefixes skip authentication".
 *
 * Used by both plugins/auth.ts (better-auth + actor preHandler) and
 * plugins/mtls.ts (device-cert preHandler). Adding a new public route
 * was a two-place edit pre-audit; this module collapses it to one.
 *
 * **Adding a new public path:** edit `PUBLIC_PREFIXES` here. Both plugins
 * pick it up automatically. Tests for the change live in
 * `tests/auth-public-routes.test.ts` (Phase 1.5 backlog #I-2 if missing).
 */

export const PUBLIC_PREFIXES = [
  '/health',
  '/metrics',
  '/docs',
  '/openapi.json',
  // better-auth mounts its own session endpoints under /api/auth/*
  '/api/auth/',
  // Day 19+ — storefront has its own auth surface (req.shopper) and webhooks
  // are unauthenticated callbacks. Both must bypass the staff auth preHandler
  // AND the mTLS preHandler (no device cert involved).
  '/api/storefront/',
  '/api/webhooks/',
] as const;

/**
 * Exceptions under a public prefix that nevertheless require `req.actor`
 * to be populated. Audit-driven catch (memory.md #76): the old prefix-only
 * match silently denied auth on step-up + sign-out + session probe even
 * though their handlers called `requireAuth(req)`.
 *
 * To add a new authenticated route under `/api/auth/*`, append its exact
 * path here. better-auth's `/api/auth/sign-in`, `/api/auth/sign-up`,
 * `/api/auth/forget-password` etc. stay public.
 */
export const AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX: ReadonlySet<string> = new Set([
  '/api/auth/session',
  '/api/auth/sign-out',
  '/api/auth/step-up',
]);

/**
 * Returns true when the path (URL minus querystring) is exempt from the
 * staff-auth + mTLS preHandlers.
 *
 * `/` (root) is treated as public so health-check probes land cleanly.
 * A path that matches a public prefix is still treated as authenticated
 * when it appears in `AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX`.
 */
export function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (path === '/' || path === '') return true;
  if (AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX.has(path)) return false;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}
