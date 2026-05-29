/**
 * storefront-session plugin — reads the `warehouse14.shopper_session` cookie
 * and populates `req.shopper` + `req.shopperSession` from the DB.
 *
 * Strict separation from staff auth (Day 12b):
 *   • Different cookie name (`warehouse14.shopper_session` vs `warehouse14.session`).
 *   • Different table (`shopper_sessions` vs `sessions`).
 *   • Independent middleware — neither plugin reads the other's cookie.
 *
 * Public storefront paths (no shopper required):
 *   `/api/storefront/auth/sign-up`     — creating an account
 *   `/api/storefront/auth/sign-in`     — getting an account
 *   `/api/storefront/catalog`          — browsing products
 *   `/api/webhooks/*`                  — provider-to-server callbacks
 *
 * Everything else under `/api/storefront/` requires `req.shopper`.
 */

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { loadShopperBySession } from '../lib/shopper.js';

export const STOREFRONT_COOKIE_NAME = 'warehouse14.shopper_session';

/** Routes under /api/storefront that DON'T require a shopper cookie. */
const STOREFRONT_PUBLIC_PREFIXES = [
  '/api/storefront/auth/sign-up',
  '/api/storefront/auth/sign-in',
  '/api/storefront/catalog',
] as const;

/**
 * Returns TRUE if this URL is a storefront route that needs shopper auth.
 * Storefront routes live under `/api/storefront/` exclusively — anything
 * else is staff or system.
 */
function isProtectedStorefrontRoute(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith('/api/storefront/')) return false;
  return !STOREFRONT_PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

const storefrontSessionPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req) => {
    // We only populate req.shopper for storefront routes — staff routes get
    // req.actor from the staff auth plugin instead.
    if (!req.url.startsWith('/api/storefront/')) return;

    // Read cookie (cookie plugin runs earlier in the registration order).
    const token = (req.cookies as Record<string, string | undefined>)?.[STOREFRONT_COOKIE_NAME];
    if (!token) {
      // Public storefront route → no requirement; protected route → requireShopper() will 401.
      return;
    }

    const resolved = await loadShopperBySession(app.db, token);
    if (!resolved) return; // bad/expired token treated as anonymous
    req.shopper = resolved.shopper;
    req.shopperSession = resolved.session;
  });

  // Defensive: log when a route under /api/storefront/ is reached without
  // req.shopper but isn't on the public list. Real refusal happens via
  // requireShopper() in the route handler itself.
  app.addHook('onResponse', async (req) => {
    if (
      isProtectedStorefrontRoute(req.url) &&
      !req.shopper &&
      req.routeOptions?.method !== 'OPTIONS'
    ) {
      // Soft observability — error-handler already responded.
      req.log.debug({ url: req.url }, 'storefront protected route without shopper');
    }
  });
};

export default fastifyPlugin(storefrontSessionPlugin, {
  name: 'warehouse14-storefront-session',
  fastify: '4.x',
  dependencies: ['warehouse14-db'],
});
