/**
 * mTLS plugin — extract the client cert identity and bind `req.deviceId`.
 *
 * Two environments, one contract:
 *
 *   • production (NODE_ENV=production) — Cloudflare Access enforces mTLS
 *     at the edge and forwards `Cf-Client-Cert-Sha256` (the SHA-256 hex of
 *     the verified leaf cert) + `Cf-Access-Jwt-Assertion` (a JWT we could
 *     additionally verify against the team's JWKS — V1.5 hardening).
 *
 *   • development (NODE_ENV=development) — there is no Cloudflare. The
 *     plugin reads `X-Dev-Device-Fingerprint` (sent by the local Tauri /
 *     curl client) and looks it up the same way. The dev-bootstrap script
 *     seeds a `devices` row matching the self-signed cert it generated.
 *
 *   • test (NODE_ENV=test) — header optional. Tests that want mTLS gating
 *     send the header explicitly; otherwise `req.deviceId` stays null.
 *
 * In all environments the lookup is the same: `devices.cert_serial = ?`
 * AND `status = 'ACTIVE'` AND `cert_expires_at > now()`. Refuse otherwise.
 *
 * Public routes (`/health`, `/metrics`, `/docs/*`, `/openapi.json`,
 * `/api/auth/*`) skip the check entirely.
 */

import fastifyPlugin from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';
import { devices } from '@warehouse14/db/schema';
import { and, eq, gt, sql as dsql } from 'drizzle-orm';

import { DomainError, type ApiErrorCode } from './error-handler.js';
import { isPublicRoute } from '../lib/public-routes.js';

export interface MtlsPluginOpts {
  env: Env;
}

class DeviceNotAuthorizedError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

/** Picks the cert-identifying header for the current environment. */
function extractCertFingerprint(req: FastifyRequest, env: Env): string | null {
  const headers = req.headers as Record<string, string | undefined>;
  if (env.NODE_ENV === 'production') {
    return headers['cf-client-cert-sha256'] ?? null;
  }
  return headers['x-dev-device-fingerprint'] ?? null;
}

const mtlsPlugin: FastifyPluginAsync<MtlsPluginOpts> = async (app, opts) => {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (isPublicRoute(req.url)) return;

    const fingerprint = extractCertFingerprint(req, opts.env);

    // In test mode, missing fingerprint is acceptable — leaves req.deviceId null.
    // In dev mode, missing fingerprint is acceptable — Tauri may not be the client.
    // In production mode, missing fingerprint is a hard refuse.
    if (!fingerprint) {
      if (opts.env.NODE_ENV === 'production') {
        throw new DeviceNotAuthorizedError('mTLS client cert missing (Cf-Client-Cert-Sha256)');
      }
      return;
    }

    // Look up the device. Refuse if absent, revoked, or cert expired.
    const rows = await app.db
      .select({ id: devices.id, status: devices.status, expiresAt: devices.certExpiresAt })
      .from(devices)
      .where(
        and(
          eq(devices.certSerial, fingerprint),
          eq(devices.status, dsql`'ACTIVE'::device_status`),
          gt(devices.certExpiresAt, dsql`now()`),
        ),
      )
      .limit(1);

    const dev = rows[0];
    if (!dev) {
      throw new DeviceNotAuthorizedError(
        `Device fingerprint ${fingerprint.slice(0, 16)}… is not authorized`,
      );
    }
    req.deviceId = dev.id;
  });
};

export default fastifyPlugin(mtlsPlugin, {
  name: 'warehouse14-mtls',
  fastify: '4.x',
  dependencies: ['warehouse14-db'],
});
